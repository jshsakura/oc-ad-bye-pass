// The iPhone route, executed on Safari's engine.
//
// `webkitSetPresentationMode` is the only picture-in-picture entry an iPhone
// has, and Playwright's Linux WebKit implements none of the media stack — so
// this path has been argued about at length and never once run. A macOS runner's
// WebKit is Safari's (measured: Version/26.5 AppleWebKit/605.1.15) and carries
// the whole surface, including `disablePictureInPicture`.
//
// So the sequence src/isolated/pip.ts performs on a tap is performed here, in
// order, against that engine: clear the page's opt-out, ask whether this video
// can be floated, then ask for it — all inside a real click, because user
// activation is what the whole feature turns on.
//
// The tests skip where the API does not exist, so this file is quiet on Linux
// and speaks on macOS:
//
//   gh workflow run webkit-macos.yml
//
// What it cannot answer is whether Orion on iOS behaves as Safari on macOS does.
// It answers the half that is answerable: whether the call we make is the call
// that works.

import { expect, test as base, webkit } from '@playwright/test'
import { chooseEntry } from '../src/isolated/pip.ts'

const test = base.extend<{ wk: import('@playwright/test').Page }>({
  wk: async ({}, use) => {
    const browser = await webkit.launch()
    const page = await browser.newPage()
    await page.setContent(PAGE)
    await use(page)
    await browser.close()
  },
})

/**
 * A player shaped like YouTube's: inline, muted, and opted out of PiP.
 *
 * The opt-out matters. WebKit reads it when deciding whether the mode is
 * supported at all, so a page that sets it has closed the door this extension
 * exists to open, and a test on a video without it would prove nothing about
 * YouTube.
 *
 * A canvas stream supplies a real video track — an element with no track is
 * refused outright, and that refusal looks exactly like the one being measured.
 */
const PAGE = `
<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#111">
<video id="v" playsinline muted disablePictureInPicture style="width:320px;height:180px"></video>
<button id="tap" style="width:120px;height:44px">tap</button>
<script>
  const video = document.getElementById('v')
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')
  setInterval(() => {
    ctx.fillStyle = '#89b4fa'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, 100)
  video.srcObject = canvas.captureStream(30)
  video.play()
  window.__result = null
  document.getElementById('tap').addEventListener('click', () => {
    // src/isolated/pip.ts 의 enterPip() 과 같은 순서, 같은 탭 안에서.
    video.removeAttribute('disablePictureInPicture')
    video.disablePictureInPicture = false
    if (video.paused) video.play()
    const supported = typeof video.webkitSupportsPresentationMode === 'function'
      ? video.webkitSupportsPresentationMode('picture-in-picture')
      : undefined
    let threw = null
    try {
      video.webkitSetPresentationMode('picture-in-picture')
    } catch (e) {
      threw = String(e)
    }
    window.__result = { supported, threw }
  })
</script>
</body>`

/** Skip where the engine has no such API — that is Linux, and it is not a failure. */
async function hasWebkitPip(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(
    () =>
      typeof (document.getElementById('v') as HTMLVideoElement & Record<string, unknown>)
        .webkitSetPresentationMode === 'function',
  )
}

test('opt-out 을 걷어내면 WebKit 이 이 영상을 띄울 수 있다고 답한다', async ({ wk }) => {
  test.skip(!(await hasWebkitPip(wk)), '이 WebKit 에는 webkit PiP API 가 없다')

  // 걷어내기 전에는 거절이어야 한다 — 아니라면 유튜브의 opt-out 이 애초에
  // 문제가 아니었다는 뜻이고, 이 기능의 전제가 틀린 것이다.
  const before = await wk.evaluate(() => {
    const v = document.getElementById('v') as HTMLVideoElement & {
      webkitSupportsPresentationMode: (m: string) => boolean
    }
    return v.webkitSupportsPresentationMode('picture-in-picture')
  })
  expect(before, 'disablePictureInPicture 가 걸린 채로도 지원한다고 답한다').toBe(false)

  const after = await wk.evaluate(() => {
    const v = document.getElementById('v') as HTMLVideoElement & {
      webkitSupportsPresentationMode: (m: string) => boolean
      disablePictureInPicture: boolean
    }
    v.removeAttribute('disablePictureInPicture')
    v.disablePictureInPicture = false
    return v.webkitSupportsPresentationMode('picture-in-picture')
  })
  expect(after, 'opt-out 을 걷어냈는데도 못 띄운다고 한다 — 그러면 버튼은 무의미하다').toBe(true)
})

test('진짜 탭에서 webkit 경로를 부르면 표시 모드가 바뀐다', async ({ wk }) => {
  test.skip(!(await hasWebkitPip(wk)), '이 WebKit 에는 webkit PiP API 가 없다')

  await wk.locator('#tap').click()

  const called = await wk.evaluate(() => window.__result as { supported: boolean; threw: string | null })
  expect(called.threw, `호출이 예외를 냈다: ${called.threw}`).toBeNull()
  expect(called.supported, '탭 안에서 걷어낸 뒤에도 지원하지 않는다고 답했다').toBe(true)

  // 그리고 실제로 모드가 바뀌는지. WebKit 은 이 값을 비동기로 갱신하므로 기다린다 —
  // 즉시 읽으면 언제나 inline 이고, 그것을 믿고 전체화면으로 승격시키던 것이
  // 성공한 PiP 를 덮어쓰던 버그였다.
  await expect
    .poll(
      () =>
        wk.evaluate(
          () =>
            (document.getElementById('v') as HTMLVideoElement & { webkitPresentationMode?: string })
              .webkitPresentationMode,
        ),
      { message: 'webkit 이 호출을 받고도 표시 모드를 바꾸지 않았다', timeout: 5000 },
    )
    .toBe('picture-in-picture')
})

test('우리 판정 함수가 이 엔진의 실제 표면에서 webkit 을 고른다', async ({ wk }) => {
  const surface = await wk.evaluate(() => {
    const v = document.getElementById('v') as HTMLVideoElement & Record<string, unknown>
    return {
      webkit: typeof v.webkitSetPresentationMode === 'function',
      standard: typeof v.requestPictureInPicture === 'function',
      fullscreen: typeof v.webkitEnterFullscreen === 'function',
    }
  })

  // 아이폰에는 webkit 쪽이 있고, 있으면 그쪽이 먼저여야 한다. 표준 API 는
  // 아이폰에서 믿을 수 없다는 것이 이 순서의 이유다.
  const route = chooseEntry({ preferFullscreen: false, supported: true, ...surface })
  const expected = surface.webkit
    ? 'webkit'
    : surface.standard
      ? 'standard'
      : surface.fullscreen
        ? 'fullscreen'
        : 'none'
  expect(route, `이 엔진의 표면: ${JSON.stringify(surface)}`).toBe(expected)
})

declare global {
  interface Window {
    __result: { supported: boolean; threw: string | null } | null
  }
}
