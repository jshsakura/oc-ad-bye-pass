// The PiP button — off by default, and it has to actually reach the API.
//
// YouTube's mobile web player marks its <video> with `disablePictureInPicture`
// and offers no control, so the feature is present in the browser and
// unreachable on the page. Two things therefore have to hold, and they fail
// independently: the opt-out has to be cleared, and the button has to call
// something.
//
// Chromium is not iOS, so the standard requestPictureInPicture is what is
// reachable here. It is stubbed rather than really opened — headless has no
// window to put it in — and the stub is what proves the click arrived.

import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const BUTTON = '#oc-abp-pip'

async function setPip(background: import('@playwright/test').Worker, on: boolean) {
  await background.evaluate(async (value) => {
    const got = await chrome.storage.local.get('settings')
    const settings = got.settings as { toggles: Record<string, boolean> }
    settings.toggles.pictureInPicture = value
    await chrome.storage.local.set({ settings })
  }, on)
}

test('기본값은 꺼짐 — 플레이어에 아무것도 붙이지 않는다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await page.waitForTimeout(700)
  await expect(page.locator(BUTTON)).toHaveCount(0)
})

test('켜면 버튼이 붙고, 유튜브가 걸어둔 차단이 풀린다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // 유튜브가 하는 그대로: 비디오에 PiP 금지를 걸어둔다
  await page.evaluate(() => {
    const video = document.querySelector('video')
    video?.setAttribute('disablePictureInPicture', '')
  })

  await setPip(background, true)

  await expect(page.locator(BUTTON)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.disablePictureInPicture))
    .toBe(false)
})

test('누르면 PiP 를 실제로 요청한다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()

  // 콘솔로 확인한다. 스텁을 심으려 해도 page.evaluate 는 MAIN world 에서 돌고
  // 버튼 핸들러는 ISOLATED 에서 도는데, 프로토타입은 컨텍스트마다 별개라
  // MAIN 에 심은 가짜는 애초에 호출되지 않는다.
  const warnings: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('oc-ad-bye-pass')) warnings.push(m.text())
  })

  await page.goto(YOUTUBE_URL)
  await setPip(background, true)
  await page.locator(BUTTON).click()

  // 헤드리스에는 띄울 창이 없으니 브라우저가 거절한다 — 그 거절이 곧 "API 까지
  // 갔다" 는 증거다. 어쩌다 열리는 환경이라면 pictureInPictureElement 가 선다.
  await expect
    .poll(
      async () => {
        const inPip = await page.evaluate(() => document.pictureInPictureElement !== null)
        return inPip || warnings.some((w) => w.includes('PiP'))
      },
      { message: '버튼을 눌렀는데 PiP API 까지 가지 않았다' },
    )
    .toBe(true)
})

test('다시 끄면 버튼이 사라진다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await setPip(background, true)
  await expect(page.locator(BUTTON)).toBeVisible()

  await setPip(background, false)
  await expect(page.locator(BUTTON)).toHaveCount(0)
})
