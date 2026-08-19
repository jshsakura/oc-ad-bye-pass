// A picture-in-picture button on the mobile web player — ISOLATED world.
//
// The browser supports it; the page ships no control. The site marks its <video>
// with `disablePictureInPicture` and offers no button of its own on mobile web,
// so there is no way in even though everything underneath works. Both are
// answered here: clear the opt-out, and put a button where a thumb can reach it.
//
// A button, and nothing more. Everything that tried to float the video
// automatically when the app went away was measured, over many releases and two
// independent second opinions, to be impossible here: WebKit grants the window
// only inside a live user gesture, and leaving has none. Those mechanisms are
// gone. A tap carries a gesture and opens the window every time; from a floating
// window (or the fullscreen one iOS offers) the OS keeps the media alive on its
// own. That is the whole of what an extension can do on this platform.

import { log } from '../shared/log.ts'
import { reportDiagnostics } from './diagnostics.ts'

const BUTTON_ID = 'oc-abp-pip'

/** The hit area a thumb needs (kept at the 36px floor the placement spec sets).
 *  The visible glyph is aligned to its bottom-right, so it jams into the corner
 *  while this transparent target spills up and left where a thumb has room. */
const BUTTON_SIZE = 36

/** How long to wait before reading back what a presentation call did. */
const PRESENTATION_SETTLE_MS = 900

interface WebkitVideo extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  /** 'inline' | 'fullscreen' | 'picture-in-picture' — what actually happened. */
  webkitPresentationMode?: string
  /** iOS only. Its native player carries a PiP control of its own. */
  webkitEnterFullscreen?: () => void
}

let observer: MutationObserver | null = null
let wantButton = false

/** Whether the panel has been told about a page that actually has a player. */
let reportedWithVideo = false

/**
 * The video actually being watched.
 *
 * Not the widest element: on a hidden page everything measures zero, so width
 * falls to whichever comes first, which can be an empty one held in reserve.
 * Scored by liveness — playing, positioned, loaded — with width only breaking
 * ties.
 */
export function playerVideo(): WebkitVideo | null {
  const videos = [...document.querySelectorAll<WebkitVideo>('video')]
  if (videos.length === 0) return null
  const score = (v: WebkitVideo) =>
    (!v.paused && !v.ended ? 4 : 0) + (v.currentTime > 0 ? 2 : 0) + (v.readyState >= 2 ? 1 : 0)
  return videos.reduce((best, v) => {
    const gap = score(v) - score(best)
    if (gap !== 0) return gap > 0 ? v : best
    return v.clientWidth > best.clientWidth ? v : best
  })
}

/** Say it on the screen. A phone has no console, and this has to be debuggable there. */
function toast(text: string): void {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:164px', 'transform:translateX(-50%)',
    'z-index:2147483647', 'max-width:88vw', 'padding:10px 14px',
    'border-radius:10px', 'background:rgba(24,24,37,.94)', 'color:#fff',
    'font:600 13px/1.5 -apple-system,system-ui,sans-serif', 'text-align:center',
    'pointer-events:none',
  ].join(';')
  document.documentElement.appendChild(el)
  setTimeout(() => el.remove(), 4200)
}

/**
 * Which call the tap makes. Decided before anything is called, from what is
 * knowable at that instant — after the first await the tap is over and nothing
 * privileged can be issued.
 *
 * `supported === false` is WebKit saying this video cannot be floated; asking
 * anyway wastes the one gesture the user gave us.
 */
export function chooseEntry(state: {
  preferFullscreen: boolean
  supported: boolean | undefined
  webkit: boolean
  standard: boolean
  fullscreen: boolean
}): 'webkit' | 'standard' | 'fullscreen' | 'none' {
  const wantPip = !state.preferFullscreen && state.supported !== false
  if (wantPip && state.webkit) return 'webkit'
  if (wantPip && state.standard) return 'standard'
  if (state.fullscreen) return 'fullscreen'
  return 'none'
}

/** Is this video floating right now, by either engine's reckoning? */
function isFloating(video: WebkitVideo): boolean {
  return (
    video.webkitPresentationMode === 'picture-in-picture' ||
    document.pictureInPictureElement === video
  )
}

/**
 * Clear the page's opt-out. It is an attribute and a property; both count.
 *
 * Load-bearing for `requestPictureInPicture`, which honours it. Cleared right
 * before the call because the site puts it back whenever it rebuilds the player.
 */
function allowPip(video: WebkitVideo): void {
  if (video.hasAttribute('disablePictureInPicture')) video.removeAttribute('disablePictureInPicture')
  if (video.disablePictureInPicture) video.disablePictureInPicture = false
}

/** Put it back in the page — the same gesture rule as opening, so done here. */
function leavePip(video: WebkitVideo): void {
  log('탭: 접기')
  try {
    if (video.webkitPresentationMode !== undefined && video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode('inline')
      return
    }
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture()
  } catch (e) {
    toast(`접기 거절: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Everything here runs inside the tap. No awaits before the privileged call. */
function enterPip(video: WebkitVideo): void {
  if (isFloating(video)) return leavePip(video)

  allowPip(video)
  // WebKit refuses to float a video that is not playing, and the tap often lands
  // while paused.
  if (video.paused) void video.play().catch(() => {})

  const supported =
    typeof video.webkitSupportsPresentationMode === 'function'
      ? video.webkitSupportsPresentationMode('picture-in-picture')
      : undefined

  const route = chooseEntry({
    preferFullscreen: false,
    supported,
    webkit: typeof video.webkitSetPresentationMode === 'function',
    standard: typeof video.requestPictureInPicture === 'function',
    fullscreen: typeof video.webkitEnterFullscreen === 'function',
  })
  log(`탭: 지원=${supported ?? '?'} 경로=${route}`)

  if (route === 'webkit' && typeof video.webkitSetPresentationMode === 'function') {
    try {
      video.webkitSetPresentationMode('picture-in-picture')
      setTimeout(() => log(`탭 결과: 모드=${video.webkitPresentationMode ?? '?'}`), PRESENTATION_SETTLE_MS)
      return
    } catch (e) {
      toast(`작은 창 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (route === 'standard' && typeof video.requestPictureInPicture === 'function') {
    video.requestPictureInPicture().catch((e: unknown) => {
      toast(`작은 창 거절: ${e instanceof Error ? e.message : String(e)}`)
    })
    return
  }

  // iOS's own fullscreen player carries a PiP control, and leaving from fullscreen
  // is the one hand-over iOS does by itself — the route that ends in a floating
  // window on that device.
  if (typeof video.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen()
      toast('이대로 홈으로 나가면 작은 창이 됩니다')
      return
    } catch (e) {
      toast(`전체화면 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  toast('이 브라우저에서 작은 화면 진입점을 찾지 못했습니다')
}

function ensureButton(video: WebkitVideo): void {
  // Resolve the current player video at *click* time, not mount time. YouTube
  // swaps the <video> element on navigation, and this button is only rebound
  // through recompute — which does not run on an SPA route change. So a
  // reference captured when the button was made goes stale on the second video,
  // and the tap reaches a detached element: the button "stops working" on 2회차.
  // Reading playerVideo() on each click sidesteps that entirely.
  const activate = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    enterPip(playerVideo() ?? video)
  }

  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
  if (button?.isConnected) {
    button.onclick = activate
    return
  }

  button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.title = '화면 속 화면으로 보기'
  button.setAttribute('aria-label', '화면 속 화면으로 보기')

  // Fixed to the viewport and parented to <html>, not the player: inside the
  // player the site's own controls own the tap whatever z-index we ask, and a
  // child cannot climb out of its parent's stacking context. Out here nothing is
  // above it. Where it sits is decided by place().
  button.style.cssText = [
    'position:fixed', 'right:14px', 'bottom:104px', 'z-index:2147483647',
    `width:${BUTTON_SIZE}px`, `height:${BUTTON_SIZE}px`,
    // Pin the glyph to the button's bottom-right so it jams into the corner,
    // with the tap area spilling up and left. This only reads evenly because the
    // svg viewBox below is cropped tight to the glyph — the earlier gap-at-the-
    // bottom was that box carrying empty space under the icon.
    'display:grid', 'place-items:end', 'padding:0', 'margin:0', 'border:none',
    'background:transparent', 'cursor:pointer', 'touch-action:manipulation',
    '-webkit-tap-highlight-color:transparent',
  ].join(';')
  // Just the glyph — no chip behind it. A drop-shadow carries the contrast the
  // chip's dark fill used to, so it stays legible on a bright frame without
  // drawing a box in the corner of someone's video.
  button.innerHTML =
    '<svg viewBox="0 2 24 19" width="22" height="17" fill="none" stroke="#fff" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
    ' style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))">' +
    '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="#fab387" stroke="none"/></svg>'

  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    enterPip(video)
  }
  log('PiP 버튼 붙임')

  // Parented to <html>, not <body>: the site rewrites body's children on
  // navigation, and a button that vanishes on every tap through the app is worse
  // than none.
  document.documentElement.appendChild(button)
  place()
  for (const [target, event] of placementSignals()) {
    target.addEventListener(event, place, { passive: true })
  }
}

/**
 * Keep the icon honest about PiP state.
 *
 * The icon's colour and corner are set in place(), which only runs on
 * scroll/resize — not the moment PiP is entered or left, which is exactly when
 * the state changes. So listen for those moments on the current video and route
 * them to place(). Re-bound when the site swaps the <video> on navigation.
 */
let presentationVideo: WebkitVideo | null = null
const PRESENTATION_EVENTS = [
  'enterpictureinpicture',
  'leavepictureinpicture',
  'webkitpresentationmodechanged',
]
function watchPresentation(video: WebkitVideo | null): void {
  if (video === presentationVideo) return
  if (presentationVideo) {
    for (const e of PRESENTATION_EVENTS) presentationVideo.removeEventListener(e, place)
  }
  presentationVideo = video
  if (video) {
    for (const e of PRESENTATION_EVENTS) video.addEventListener(e, place, { passive: true })
  }
}

/**
 * Where the button goes: the player's bottom-right corner, inset, in
 * visual-viewport coordinates (on iOS the layout viewport is not the visible
 * one). When the player is scrolled away there is nothing to act on, so it hides.
 */
function place(): void {
  const button = document.getElementById(BUTTON_ID) as HTMLElement | null
  if (!button) return
  const video = playerVideo()
  watchPresentation(video)
  // Anchor to the <video> element, not #movie_player. The player container runs
  // taller than the picture — a control strip and padding live below the video —
  // so anchoring to it floated the button that hidden height above the frame,
  // leaving the bottom gap roughly double the right one. The video box is the
  // frame the viewer actually sees.
  const anchor = video ?? document.querySelector<HTMLElement>('#movie_player')
  const box = anchor?.getBoundingClientRect()
  const view = window.visualViewport

  const visibleTop = view?.offsetTop ?? 0
  const visibleBottom = visibleTop + (view?.height ?? window.innerHeight)
  const visibleRight = (view?.offsetLeft ?? 0) + (view?.width ?? window.innerWidth)

  if (!box || box.height < 80 || box.bottom < visibleTop + 40 || box.top > visibleBottom - 40) {
    button.style.display = 'none'
    return
  }

  const floating = video ? isFloating(video) : false
  const label = floating ? '작은 화면 접기' : '화면 속 화면으로 보기'
  button.title = label
  button.setAttribute('aria-label', label)
  // The little inset moves as well as recolours, so the state reads at a glance
  // rather than by hue alone: peach in the bottom-right when it will pop out,
  // green in the top-left once it is floating.
  const mark = button.querySelector('rect + rect') as SVGRectElement | null
  if (mark) {
    mark.setAttribute('fill', floating ? '#a6e3a1' : '#fab387')
    mark.setAttribute('x', floating ? '4' : '12')
    mark.setAttribute('y', floating ? '6' : '11')
  }

  // Margin from the edge. Small, to tuck into the very corner: floated inward it
  // sits on top of YouTube's own bottom-right controls (the fullscreen button).
  // The glyph is centred in a 36px tap target, so the visible gap is this + ~7px.
  const inset = 3
  const top = Math.min(box.bottom - BUTTON_SIZE - inset, visibleBottom - BUTTON_SIZE - inset)
  const left = Math.min(box.right - BUTTON_SIZE - inset, visibleRight - BUTTON_SIZE - inset)
  button.style.display = 'grid'
  button.style.top = `${Math.max(visibleTop + inset, top)}px`
  button.style.left = `${Math.max(inset, left)}px`
  button.style.right = 'auto'
  button.style.bottom = 'auto'
}

function placementSignals(): [EventTarget, string][] {
  const signals: [EventTarget, string][] = [
    [window, 'scroll'],
    [window, 'resize'],
    [window, 'orientationchange'],
  ]
  if (window.visualViewport) {
    signals.push([window.visualViewport, 'resize'], [window.visualViewport, 'scroll'])
  }
  return signals
}

function sweep(): void {
  const video = playerVideo()
  if (!video) return
  allowPip(video)

  // Report once when a real video with metadata appears — the first report is
  // written before the player exists, so without this the panel says 비디오 0개
  // for the life of the page.
  if (!reportedWithVideo && video.readyState >= 1) {
    reportedWithVideo = true
    reportDiagnostics()
  }

  if (wantButton) {
    ensureButton(video)
    place()
  }
}

/** Start offering the button. Safe to call repeatedly. */
export function enablePictureInPicture(options: { button: boolean }): void {
  wantButton = options.button
  if (!wantButton) document.getElementById(BUTTON_ID)?.remove()
  sweep()
  if (observer) return
  // The site replaces the player wholesale on navigation, taking the button with
  // it, so this watches rather than running once — and watches the opt-out
  // attribute, which the site puts back on the same element.
  observer = new MutationObserver(() => sweep())
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disablepictureinpicture', 'src'],
  })
}

export function disablePictureInPicture(): void {
  observer?.disconnect()
  observer = null
  for (const [target, event] of placementSignals()) target.removeEventListener(event, place)
  document.getElementById(BUTTON_ID)?.remove()
}
