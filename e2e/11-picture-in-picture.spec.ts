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

/**
 * The behaviour and the button are separate settings — wanting to leave with the
 * video is not the same as wanting a control on the player — so a test that is
 * about the button has to ask for the button.
 */
async function setPip(background: import('@playwright/test').Worker, on: boolean) {
  await background.evaluate(async (value) => {
    const got = await chrome.storage.local.get('settings')
    const settings = got.settings as { toggles: Record<string, boolean> }
    settings.toggles.pictureInPicture = value
    settings.toggles.pipButton = value
    await chrome.storage.local.set({ settings })
  }, on)
}

test('기본값에서는 버튼을 얹지 않는다 — 동작은 켜져 있어도', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  // 나갈 때 이어보는 것은 기본이다. 남의 플레이어에 컨트롤을 다는 것은 아니다.
  await expect(page.locator(BUTTON)).toHaveCount(0)
})

test('켜면 나타나고, 다시 끄면 사라진다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator(BUTTON)).toHaveCount(0)

  await setPip(background, true)
  await expect(page.locator(BUTTON)).toBeVisible()

  await setPip(background, false)
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

// 눌렀을 때 무슨 일이 있었는지는 이제 기록으로 남는다.
//
// 예전에는 화면에 토스트로 띄웠다 — 폰에 아무것도 물어볼 수 없던 시절의 방편이고,
// 버튼을 누를 때마다 남의 영상 위로 배너가 지나가는 값을 치르고 있었다.
// 진단 패널의 기록이 같은 것을 더 자세히 들고 있다.
test('누르면 무엇을 했는지 기록에 남는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await setPip(background, true)
  await page.locator(BUTTON).click()

  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-oc-abp-log')), {
      message: '탭이 기록되지 않았다',
    })
    .toContain('탭: 경로=')
})

// 스텁이 아니라 진짜 창.
//
// 위의 시험들은 API 가 불렸는지까지만 본다. 그것으로는 이 기능이 폰에서 실패해온
// 방식들이 하나도 안 잡힌다 — 탭 안에서 불렀는지, 그 순간에 유튜브의 차단이
// 걷혀 있었는지, 창이 열리자마자 도로 닫히지는 않는지.
//
// 크로미움에는 진짜 PiP 가 있으므로 여기서는 끝까지 간다. 픽스처의 <video> 에는
// 비디오 트랙이 없어서 브라우저가 요청 자체를 거절하니(측정된 문구:
// "The video element has no video track"), 캔버스 스트림으로 진짜 트랙을 물린다.
test('누르면 진짜로 작은 창이 열린다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await setPip(background, true)
  await expect(page.locator(BUTTON)).toBeVisible()

  await page.evaluate(async () => {
    const video = document.querySelector('video')
    if (!video) throw new Error('픽스처에 video 가 없다')
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    setInterval(() => {
      ctx.fillStyle = '#89b4fa'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }, 100)
    video.srcObject = canvas.captureStream(30)
    video.muted = true
    await video.play()
  })

  // 유튜브가 차단을 되붙인 상태에서 시작한다. 이 시험이 증명하는 것은 "되붙어도
  // 창이 열린다" 까지고, 그것을 누가 걷어냈는지는 가르지 않는다 — 속성 관찰자가
  // 클릭보다 먼저 걷어내기 때문이다(핸들러 안의 걷어내기를 빼고 돌려도 통과한다).
  // 핸들러 쪽은 관찰자가 놓치는 순간을 위한 것이고, 그 순간은 여기서 만들 수 없다.
  await page.evaluate(() => {
    document.querySelector('video')!.setAttribute('disablePictureInPicture', '')
  })

  await page.locator(BUTTON).click()

  await expect
    .poll(() => page.evaluate(() => document.pictureInPictureElement !== null), {
      message: '버튼을 눌렀는데 작은 창이 열리지 않았다',
    })
    .toBe(true)

  // 그리고 열린 채로 있어야 한다. 유튜브는 표시 모드가 바뀌면 영상을 도로
  // 인라인으로 끌어내리는데, 그 방어는 우리가 연 창일 때만 도는 것이라
  // 버튼 경로에서 켜지지 않으면 창이 열렸다가 사라진다.
  await page.waitForTimeout(600)
  expect(
    await page.evaluate(() => document.pictureInPictureElement !== null),
    '열린 작은 창이 곧바로 닫혔다',
  ).toBe(true)

  // 그리고 같은 버튼으로 접힌다. 없을 때 폰에서는 되돌릴 방법이 시스템 창이
  // 주는 것뿐이었고, 그것을 못 찾으면 영상은 계속 떠 있는다.
  await page.locator(BUTTON).click()
  await expect
    .poll(() => page.evaluate(() => document.pictureInPictureElement !== null), {
      message: '한 번 더 눌렀는데 작은 창이 그대로다',
    })
    .toBe(false)
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
      chip: (() => {
        const chip = el.firstElementChild?.getBoundingClientRect()
        return chip ? [chip.width, chip.height] : null
      })(),
    }
  })

  // 플레이어 안에 있으면 유튜브가 그 위에 자기 컨트롤을 쌓고, 자식은 부모의
  // 쌓임 맥락 밖으로 못 나간다 — 보이는데 안 눌리는 상태가 정확히 그것이었다.
  expect(where?.insidePlayer, '플레이어 안에 있으면 탭을 뺏긴다').toBe(false)
  expect(where?.parent).toBe('HTML')
  expect(where?.position).toBe('fixed')
  // 엄지가 닿는 면적은 44 — 아이폰 16(393pt, 3x)에서 8.8mm, 애플이 말하는 최소치다.
  // 보이는 칩은 그보다 작다. 그 둘은 다른 질문이라 다른 크기를 갖는다.
  expect(where?.size?.[0], '엄지가 닿을 면적이 줄었다').toBeGreaterThanOrEqual(44)
  expect(where?.chip?.[0], '보이는 칩이 아이콘보다 한참 크다').toBeLessThanOrEqual(34)
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
test('배경 재생을 켜도 나가는 신호가 PiP 까지 온다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await setPip(background, true)
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

  // 기록 쪽을 본다. 숨겨지지 않은 상태의 신호는 패널의 헤드라인을 차지하지 않게
  // 됐지만(그 자리는 실제로 나갔던 마지막 순간의 것이어야 한다), 도착했다는 사실은
  // 남는다 — 그리고 이 시험이 지키려는 것이 바로 그 도착이다.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-oc-abp-log')), {
      message: '나가는 신호가 PiP 핸들러까지 오지 않았다',
    })
    .toContain('oc-ad-bye-pass:leaving')
})

// 나갈 때 작은 창으로 — 여기서는 못 돌린다.
//
// 미리 걸어두는 쪽이 부르는 것은 webkit 접두 API 라 크로미움은 그 줄에 닿지 않고,
// 테스트 페이지에서 스텁을 심어도 소용없다 — DOM 요소에 붙인 확장 속성은 확장의
// 세계로 넘어가지 않는다(실제로 이 시험을 그렇게 썼다가 배웠다).
// 판단은 tests/auto-pip.test.ts 의 shouldArm 이 덮는다.
