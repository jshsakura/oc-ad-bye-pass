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

import { PHONE_SCREEN, expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const BUTTON = '#oc-abp-pip'

// This whole file is the phone. The button exists for it — WebKit opens a
// floating window only inside a live gesture, and YouTube hides WebKit's own
// control — and on a desktop Chromium the same button would be a second copy of
// something the browser already has, so it is not drawn there at all. The
// desktop case is tested at the bottom, as the desktop.
test.use({ screen: PHONE_SCREEN })

/**
 * The behaviour and the button are separate settings — wanting to leave with the
 * video is not the same as wanting a control on the player — so a test that is
 * about the button has to ask for the button.
 */
async function setPip(background: import('@playwright/test').Worker, on: boolean) {
  await background.evaluate(async (value) => {
    const got = await chrome.storage.local.get('settings')
    const settings = got.settings as { toggles: Record<string, boolean> }
    settings.toggles.pipButton = value
    await chrome.storage.local.set({ settings })
  }, on)
}

// 기본으로 붙는다.
//
// 남의 플레이어에 컨트롤을 다는 일이라 오래 꺼둔 채였고, 나갈 때 알아서 작은 창이
// 된다는 전제에서는 그게 맞았다. 그 전제가 틀렸다 — WebKit 은 살아있는 사용자
// 제스처 안에서만 창을 열어주고 나가는 순간에는 그것이 없다. 실기기에서 하루치
// 릴리스로 확인한 결과, 자동 호출은 전부 조용히 무시됐고 진짜 탭은 매번 열렸다.
// 그러면 이 버튼은 부가물이 아니라 기능 그 자체다.
test('기본으로 버튼이 붙는다 — 아이폰에서 작은 창을 여는 유일한 길이다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
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
    .toContain('경로=')
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
  // 닿는 면적과 보이는 칩은 다른 질문이라 다른 크기를 갖는다. 면적은 36 —
  // 애플이 말하는 최소치 44보다 작고, 그건 요청에 따른 것이다. 남의 플레이어 위에
  // 있는 물건이라 작을수록 낫다는 판단이 최소치보다 앞섰다. 그 아래로는 안 간다.
  expect(where?.size?.[0], '엄지가 닿을 면적이 더 줄었다').toBeGreaterThanOrEqual(36)
  expect(where?.chip?.[0], '보이는 칩이 아이콘보다 한참 크다').toBeLessThanOrEqual(24)
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

/**
 * The button belongs to the thing you are watching.
 *
 * Reported from a phone: on a search result list, where previews autoplay, the
 * button attached to one of them and — being fixed, on a screen that scrolls —
 * ended up over the search field and over YouTube's own mute control. The
 * symptom was "the sound cannot be turned on", because the tap was landing on
 * our button.
 *
 * The site navigates without reloading, so this checks both directions on the
 * same document. Attaching correctly once is not enough; it has to come off.
 */
test('검색 화면에는 붙지 않고, 시청 화면으로 가면 붙는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  await setPip(background, true)

  const page = await context.newPage()
  await page.goto('https://www.youtube.com/results?search_query=test')
  // 미리보기가 자동재생되는 목록을 흉내낸다 — 붙일 만한 영상은 있는 상태다.
  await page.evaluate(() => {
    const video = document.createElement('video')
    video.style.cssText = 'width:360px;height:220px'
    document.body.appendChild(video)
  })

  await page.waitForTimeout(1500)
  expect(await page.locator(BUTTON).count(), '검색 화면에 붙으면 안 된다').toBe(0)

  // 같은 문서에서 시청 화면으로 이동 (SPA).
  await page.evaluate(() => history.pushState({}, '', '/watch?v=testvideo'))
  await page.evaluate(() => document.body.appendChild(document.createElement('div')))

  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(1)

  // 그리고 돌아가면 다시 떨어져야 한다.
  await page.evaluate(() => history.pushState({}, '', '/results?search_query=test'))
  await page.evaluate(() => document.body.appendChild(document.createElement('div')))
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(0)
})

// 남의 확장이 화면을 가져간 동안에는 그리지 않는다.
//
// OC Easy Mode 는 유튜브 화면을 자기 UI 로 덮고 #movie_player 를 CSS 로 옮겨
// 다닙니다. 우리 버튼은 <html> 에 붙어 최상단에 뜨고 영상의 상자에서 자리를
// 계산하므로, 그 UI 위 한가운데에 박히고 상자가 움직일 때마다 깜빡였습니다.
// 상대가 CSS 로 우리 버튼을 못 박아 봐도 우리가 remove/재삽입을 하는 동안에는
// 깜빡임이 남습니다. 애초에 그리지 않는 것이 유일한 해결입니다.
test('이지 모드가 켜져 있는 동안에는 버튼을 붙이지 않는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  await setPip(background, true)

  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator(BUTTON)).toBeVisible()

  // 스타일 노드 하나로 이지 모드가 켜진 상태를 흉내낸다.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'oc-easy-mode'
    document.head.appendChild(style)
  })
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(0)

  // 나가면 원래대로 돌아온다. 이지 모드는 켜고 끄는 것이라 한 방향만으로는 부족하다.
  await page.evaluate(() => document.getElementById('oc-easy-mode')?.remove())
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(1)
})

test('섀도우 호스트만 있어도, html 의 양보 속성만 있어도 물러난다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  await setPip(background, true)

  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator(BUTTON)).toBeVisible()

  // 이지 모드는 스타일 노드와 섀도우 호스트를 함께 만들지만, 한쪽만 보면
  // 상대가 구성을 바꿀 때 조용히 되살아난다. 각각 단독으로 확인한다.
  await page.evaluate(() => document.body.appendChild(document.createElement('oc-easy-mode')))
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(0)
  await page.evaluate(() => document.querySelector('oc-easy-mode')?.remove())
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(1)

  // 그리고 이름을 모르는 다음 확장을 위한 길.
  await page.evaluate(() => document.documentElement.setAttribute('data-oc-abp-no-pip', ''))
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(0)
  await page.evaluate(() => document.documentElement.removeAttribute('data-oc-abp-no-pip'))
  await expect.poll(() => page.locator(BUTTON).count(), { timeout: 8000 }).toBe(1)
})

// 데스크톱에서는 그리지 않는다.
//
// 데스크톱 크롬에는 우클릭 두 번과 주소창 미디어 컨트롤이, 파이어폭스에는 영상
// 위 자체 토글이 있다. 거기에 우리 버튼을 더 얹으면 플레이어 위에 뜬 중복이고,
// 그게 "버튼이 거슬린다" 의 정체였다. 스위치도 같이 없어야 한다 — 눌러도 아무
// 일이 없는 스위치는 고장으로 신고된다.
test.describe('데스크톱', () => {
  test.use({ screen: undefined })

  test('버튼을 그리지 않는다 — 켜 두었어도', async ({ context, background }) => {
    await installYouTubeFixture(context)
    await setPip(background, true)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    // 영상이 붙을 시간을 준 뒤에도 없어야 한다. "아직 안 붙은 것" 과 구분하기 위해
    // 다른 스펙이 버튼을 보는 데 쓰는 시간보다 길게 기다린다.
    await page.waitForTimeout(1500)
    expect(await page.locator(BUTTON).count()).toBe(0)
  })

  test('팝업에도 그 스위치가 없다 — 모든 항목을 펼쳐도', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/popup.html`)
    await page.locator('.foot button').first().click()
    await expect(page.getByRole('switch', { name: '동영상 광고 차단' })).toBeVisible()
    await expect(page.getByRole('switch', { name: '작은 화면(PiP) 버튼' })).toHaveCount(0)
  })
})

test('폰에서는 팝업에 스위치가 있다', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('.foot button').first().click()
  await expect(page.getByRole('switch', { name: '작은 화면(PiP) 버튼' })).toBeVisible()
})
