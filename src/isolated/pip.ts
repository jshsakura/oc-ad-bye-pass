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

const BUTTON_ID = 'oc-abp-pip'

/*
 * Standing down when something else owns the player.
 *
 * OC Easy Mode replaces YouTube's screen with its own and moves #movie_player
 * around with CSS. Our button anchors to the video's box and is parented to
 * <html> at the top of the stack, so it kept landing in the middle of that UI
 * and flickering as the box moved — and neither side could win by adjusting,
 * because the thing being measured is the thing the other extension is moving.
 *
 * The button is the wrong control to draw at all there: whoever replaced the
 * screen owns the controls on it, and Easy Mode offers its own PiP button from
 * inside a gesture, so nothing is lost by us not drawing one.
 *
 * `oc-easy-mode` names its stylesheet node by id and its shadow host by tag, and
 * both appear when it turns on and go when it turns off. The attribute is here
 * so the next such extension needs no release from us — set it on <html> and the
 * button stays off for as long as it is there.
 */
const EASY_MODE_STYLE_ID = 'oc-easy-mode'
const EASY_MODE_HOST = 'oc-easy-mode'
const YIELD_ATTR = 'data-oc-abp-no-pip'

/** Whether another extension has taken the player's screen over right now. */
export function playerOwnedByHost(doc: Document): boolean {
  return (
    doc.getElementById(EASY_MODE_STYLE_ID) !== null ||
    doc.querySelector(EASY_MODE_HOST) !== null ||
    doc.documentElement.hasAttribute(YIELD_ATTR)
  )
}

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


/**
 * The video actually being watched.
 *
 * Not the widest element: on a hidden page everything measures zero, so width
 * falls to whichever comes first, which can be an empty one held in reserve.
 * Scored by liveness — playing, positioned, loaded — with width only breaking
 * ties.
 */
/** What the scoring below needs, so it can be exercised without a page. */
export interface VideoState {
  playing: boolean
  started: boolean
  ready: boolean
  /** How much of it the viewer can actually see, in pixels of height. */
  visibleHeight: number
  width: number
}

/**
 * How much this video looks like the one being watched.
 *
 * **Visibility outweighs everything.** It was not in the score at all, and on a
 * page with several videos — a search result list, where previews autoplay —
 * the winner could be one scrolled off the screen. The button then anchored to
 * a box nobody could see, which is how it ended up over the search field. A
 * single video on the page always scored right, which is exactly what was
 * reported: fine with one, wrong with several.
 */
export function videoScore(v: VideoState): number {
  return (
    (v.visibleHeight >= MIN_VIDEO_HEIGHT ? 16 : 0) +
    (v.playing ? 4 : 0) +
    (v.started ? 2 : 0) +
    (v.ready ? 1 : 0)
  )
}

/** Pick the best of them; ties go to the wider box. Pure, for the tests. */
export function pickVideo<T>(items: T[], state: (item: T) => VideoState): T | null {
  if (items.length === 0) return null
  return items.reduce((best, item) => {
    const gap = videoScore(state(item)) - videoScore(state(best))
    if (gap !== 0) return gap > 0 ? item : best
    return state(item).width > state(best).width ? item : best
  })
}

function stateOf(v: WebkitVideo): VideoState {
  const box = v.getBoundingClientRect()
  const view = window.visualViewport
  const top = view?.offsetTop ?? 0
  const bottom = top + (view?.height ?? window.innerHeight)
  return {
    playing: !v.paused && !v.ended,
    started: v.currentTime > 0,
    ready: v.readyState >= 2,
    visibleHeight: Math.max(0, Math.min(box.bottom, bottom) - Math.max(box.top, top)),
    width: v.clientWidth,
  }
}

export function playerVideo(): WebkitVideo | null {
  return pickVideo([...document.querySelectorAll<WebkitVideo>('video')], stateOf)
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

/** The rectangles `placeButton` reasons about, so it can be tested without a page. */
export interface Rect {
  top: number
  bottom: number
  left: number
  right: number
  height: number
}

/**
 * Margin from the video's edge. Small, to tuck into the very corner: floated
 * inward it sits on top of YouTube's own bottom-right controls. The glyph is
 * centred in a 36px tap target, so the visible gap is this + ~7px.
 */
const INSET = 3

/** Below this the box is a thumbnail or a stray element, not the picture. */
const MIN_VIDEO_HEIGHT = 80

/**
 * Where the button goes, or null when it must not be shown at all.
 *
 * **The button belongs to the video, and it is never moved off it.** It used to
 * be clamped into the viewport instead — `Math.max(visibleTop + inset, top)` —
 * which meant a video scrolled almost out of sight still passed the visibility
 * test, and the clamp then parked a fixed 36px button at the top of the screen.
 * On m.youtube that is the search field, and on the way there it crosses
 * YouTube's own mute control: reported as "the sound cannot be turned on",
 * because the tap was landing on our button.
 *
 * So there is no clamping. The corner is where it is, and if the whole button
 * does not fit on the video **and** inside what the viewer can see, it is
 * hidden. A button parked away from its video is worse than no button: it
 * covers controls that belong to somebody else.
 */
export function placeButton(
  box: Rect | null,
  view: { top: number; bottom: number; left: number; right: number },
  size = BUTTON_SIZE,
): { top: number; left: number } | null {
  if (!box || box.height < MIN_VIDEO_HEIGHT) return null

  const top = box.bottom - size - INSET
  const left = box.right - size - INSET

  // On the video.
  if (top < box.top || left < box.left) return null
  // And wholly within what the viewer can actually see. On iOS the visible
  // viewport is not the layout viewport, which is why this is passed in.
  if (top < view.top || top + size > view.bottom) return null
  if (left < view.left || left + size > view.right) return null

  return { top, left }
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

  const spot = placeButton(box ?? null, {
    top: visibleTop,
    bottom: visibleBottom,
    left: view?.offsetLeft ?? 0,
    right: visibleRight,
  })
  if (!spot) {
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

  button.style.display = 'grid'
  button.style.top = `${spot.top}px`
  button.style.left = `${spot.left}px`
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

/**
 * Is this a page where one video is being watched?
 *
 * The button is for the thing you are watching. On a search page or a feed the
 * previews autoplay, and offering to pop one of those into a floating window is
 * not something anyone wants — it also put a fixed button on a screen full of
 * boxes that scroll, which is how it ended up over the search field and over
 * YouTube's own mute control.
 *
 * The path decides, not the number of `<video>` elements on the page: a watch
 * page can carry a second one held in reserve, and a feed can be down to one
 * after scrolling, so counting gets both cases wrong. Shorts is deliberately
 * out — it is a feed of videos wearing a player's clothes.
 */
export function isWatchPage(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url)
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(hostname)) return false
    return pathname === '/watch' || pathname.startsWith('/embed/')
  } catch {
    return false
  }
}

/**
 * One sweep per frame, however many mutations arrive.
 *
 * The observer below watches childList and the `src` attribute across the whole
 * document, and mobile YouTube changes those constantly — measured at about
 * seven callbacks a second while sitting still on a watch page, against 2.4 once
 * coalesced. Each uncoalesced one reached place(), which reads a bounding box
 * and then writes styles: the read-write-read shape that forces layout. This is
 * the same lesson src/isolated/index.ts already learned; pip.ts missed it.
 */
let scheduled = false

function scheduleSweep(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    sweep()
  })
}

function sweep(): void {
  const video = playerVideo()

  // Re-checked on every sweep rather than once at start: the site navigates
  // without reloading, so a button attached on a watch page has to come off
  // again when the same document becomes a search result list — and the same
  // is true of another extension taking the screen over, which happens and
  // un-happens while the page stays put.
  //
  // Decided before the video check, and removal happens whenever the answer is
  // no *or there is nothing to anchor to*. The early return used to sit above
  // this, so a page that lost its <video> in the same instant it lost the right
  // to a button — Easy Mode rebuilding the player as it took the screen — kept
  // a stale button fixed at its last position until some later mutation.
  const wanted = wantButton && isWatchPage(location.href) && !playerOwnedByHost(document)
  if (!wanted || !video) {
    document.getElementById(BUTTON_ID)?.remove()
    if (!video) return
  }
  allowPip(video)
  if (wanted) {
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
  //
  // This already covers another extension arriving or leaving: its nodes are
  // added and removed under documentElement, and childList+subtree is what sees
  // that. Only the yield attribute needed adding, because attribute changes are
  // filtered and an unlisted name is not reported.
  observer = new MutationObserver(scheduleSweep)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disablepictureinpicture', 'src', YIELD_ATTR],
  })
}

export function disablePictureInPicture(): void {
  observer?.disconnect()
  observer = null
  for (const [target, event] of placementSignals()) target.removeEventListener(event, place)
  document.getElementById(BUTTON_ID)?.remove()
}
