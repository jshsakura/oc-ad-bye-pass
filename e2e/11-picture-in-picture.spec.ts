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

test('기본값은 켜짐 — 유튜브를 열면 버튼이 있다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  // 이 확장을 폰에 까는 이유가 이것이라, 켜달라고 요구하지 않는다.
  await expect(page.locator(BUTTON)).toBeVisible()
})

test('끄면 사라지고, 다시 켜면 돌아온다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator(BUTTON)).toBeVisible()

  await setPip(background, false)
  await expect(page.locator(BUTTON)).toHaveCount(0)

  await setPip(background, true)
  await expect(page.locator(BUTTON)).toBeVisible()
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

test('누르면 어느 경로를 탔는지 화면에 말해준다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await setPip(background, true)
  await page.locator(BUTTON).click()

  // 폰에는 콘솔이 없다. 눌렀을 때 무슨 일이 일어났는지가 화면에 남아야
  // "진입점이 없다" 와 "진입점이 거절했다" 를 구분할 수 있고, 그 둘은 고치는
  // 방법이 정반대다.
  await expect(page.getByText(/PiP 진입점:/)).toBeVisible()

  // 그리고 실제로 API 까지 갔는지 — 크로미움에는 표준 API 가 있으니 그 이름이 뜬다.
  await expect(page.getByText(/standard/)).toBeVisible()
})

test('버튼이 플레이어 밖에, 화면에 고정돼 있다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await setPip(background, true)

  const where = await page.evaluate(() => {
    const el = document.getElementById('oc-abp-pip')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      parent: el.parentElement?.tagName,
      position: style.position,
      insidePlayer: !!el.closest('#movie_player'),
      size: [el.getBoundingClientRect().width, el.getBoundingClientRect().height],
    }
  })

  // 플레이어 안에 있으면 유튜브가 그 위에 자기 컨트롤을 쌓고, 자식은 부모의
  // 쌓임 맥락 밖으로 못 나간다 — 보이는데 안 눌리는 상태가 정확히 그것이었다.
  expect(where?.insidePlayer, '플레이어 안에 있으면 탭을 뺏긴다').toBe(false)
  expect(where?.parent).toBe('HTML')
  expect(where?.position).toBe('fixed')
  // 44px — 엄지가 확실히 닿는 최소 크기
  expect(where?.size?.[0]).toBeGreaterThanOrEqual(44)
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

// 자동 PiP 의 동작 자체는 여기서 못 돌린다. 헤드리스 크로미움은 모든 페이지를
// visible 로 유지하고, Page.setWebLifecycleState · Emulation.setPageVisibility ·
// setFocusEmulationEnabled 어느 것도 document.hidden 을 움직이지 못한다.
// 판단 부분은 tests/auto-pip.test.ts 가 함수로 덮는다.

// 배경 재생이 자동 PiP 를 죽이던 자리.
//
// MAIN 세계가 visibilitychange 를 stopImmediatePropagation 으로 삼키면 그 표시는
// 이벤트에 붙지 세계에 붙지 않는다. 두 세계가 대상마다 리스너 목록 하나를
// 공유하므로, 페이지를 막으려던 한 줄이 우리 쪽 리스너까지 같이 막았다.
// 둘 다 기본값이 켜짐이라, 기본 설정에서 자동 PiP 는 신호를 못 받고 있었다.
//
// 두 기능을 따로 시험하면 둘 다 통과한다. 이 시험만 둘을 같이 켠다.
//
// 이벤트는 페이지에서 직접 쏜다. 헤드리스 크로미움은 탭을 뒤로 보내도 문서를
// 숨김으로 만들지 않아서, 탭 전환으로는 visibilitychange 자체가 나지 않는다.
// 숨김이 아니니 핸들러는 넘어가겠지만, 넘어갔다는 기록이 남는다는 것이
// 곧 신호가 도착했다는 뜻이고 그것이 이 시험이 지키려는 것이다.
test('배경 재생을 켜도 나가는 신호가 PiP 까지 온다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator(BUTTON)).toBeVisible()

  await page.evaluate(() => {
    // 페이지가 이 이벤트를 못 보는 것도 함께 확인한다 — 삼키기를 없애는 것으로
    // 이 시험을 통과시키면 배경 재생이 죽는다.
    let pageSaw = false
    const spy = () => {
      pageSaw = true
    }
    document.addEventListener('visibilitychange', spy)
    document.dispatchEvent(new Event('visibilitychange'))
    document.removeEventListener('visibilitychange', spy)
    if (pageSaw) throw new Error('페이지가 visibilitychange 를 봤다 — 배경 재생이 안 걸렸다')
  })

  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.getAttribute('data-oc-abp-autopip')),
      { message: '나가는 신호가 PiP 핸들러까지 오지 않았다' },
    )
    .toContain('leaving')
})
