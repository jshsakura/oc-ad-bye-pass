// Picture-in-picture on YouTube's mobile web player — ISOLATED world.
//
// The browser supports it; the page ships no control. YouTube marks its <video>
// with `disablePictureInPicture` and offers no button of its own on mobile web,
// so there is no way in even though everything underneath works. Both are
// answered here: clear the opt-out, and put a button where a thumb can reach it.
//
// How much the opt-out actually costs depends on the route, which was measured
// rather than assumed (scripts/safari-pip-probe.mjs, on a macOS runner, 2026-08-11):
// Safari's `webkitSetPresentationMode` floated a video that still carried the
// attribute, and `webkitSupportsPresentationMode` answered true while it was set.
// So on that route the opt-out is not the lock. It is on the standard API, which
// is the one Chromium takes and where the attribute is honoured — and iOS is not
// macOS. Clearing costs nothing and covers both, so it stays.
//
// This lives in ISOLATED rather than MAIN because it needs nothing from the page
// context — the DOM is shared, so the video element and its methods are reachable
// from here, and being out of the page's reach is strictly better.
//
// Two ways in, because the native app has two: a button, and going away.
// Leaving the tab hands the video to a small window on its own, which is the
// behaviour people mean when they say "like the app".
//
// The visibilitychange listener here does not fight the one in
// src/main/backgroundPlay.ts, which swallows the event so the page never pauses.
// That runs in the page's world; this runs in the extension's. Events are
// dispatched to each world separately, so stopping it there does not stop it
// here — and document.hidden read from this side is the real value, not the
// spoofed one.
//
// Two APIs, because iOS is the target. `requestPictureInPicture` is the standard
// one and is what Chrome implements; WebKit has its own
// `webkitSetPresentationMode`, and on iPhone that is the only one there is.

import { LEAVING_EVENT, RETURNED_EVENT } from '../shared/messages.ts'
import { log } from '../shared/log.ts'
import { reportDiagnostics } from './diagnostics.ts'

const BUTTON_ID = 'oc-abp-pip'

/**
 * Two sizes, because they answer different questions.
 *
 * What it looks like is the chip: the icon plus a hairline. At 44 the control
 * read as a slab with a small picture floating in it, on somebody else's player,
 * where anything we add should be as quiet as it can be.
 *
 * What it is, to a thumb, is the button around that chip — 44 CSS px, which on an
 * iPhone 16 (393pt wide, 3x) is about 8.8mm, Apple's own floor for a touch
 * target. Shrinking the picture is a design decision; shrinking what a moving
 * thumb has to hit is a different one, and not the one being asked for.
 */
const BUTTON_SIZE = 44
const CHIP_SIZE = 30

interface WebkitVideo extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  /** 'inline' | 'fullscreen' | 'picture-in-picture' — what actually happened. */
  webkitPresentationMode?: string
  /** iOS only. Its native player carries a PiP control of its own. */
  webkitEnterFullscreen?: () => void
}

/** How long to wait before deciding webkitSetPresentationMode did nothing. */
const PRESENTATION_SETTLE_MS = 900

let observer: MutationObserver | null = null

/** Whether the panel has ever been told about a page that had a player in it. */
let reportedWithVideo = false


/**
 * Everything that can mean "the user is leaving". They overlap on purpose.
 *
 * A function rather than a constant because this module is imported by a unit
 * test in node, where `document` does not exist — and a module that cannot be
 * imported outside a browser cannot have its logic tested outside one.
 */
function returningSignals(): [EventTarget, string][] {
  return [
    [document, 'visibilitychange'],
    [window, 'pageshow'],
    [window, 'focus'],
    [document, 'resume'],
  ]
}

function leavingSignals(): [EventTarget, string][] {
  return [
    [document, 'visibilitychange'],
    // The same news under our own name, sent by src/main/backgroundPlay.ts after
    // it swallows the real event. Without this the two features cancel out: the
    // swallow silences this world's listeners too, and both are on by default.
    [document, LEAVING_EVENT],
    [window, 'pagehide'],
    [window, 'blur'],
    [document, 'freeze'],
  ]
}

/**
 * The video actually being watched.
 *
 * Size alone was the test, and on a hidden page everything measures zero — so the
 * pick fell to whichever element came first, which on YouTube can be an empty one
 * held in reserve. The device log caught it: a hand-over reported against a
 * playing video, and the mode change that followed came from something at 0.0
 * seconds and paused, on the strength of which we concluded the user had closed
 * the window.
 *
 * What is being watched is what is playing. Size only decides between candidates
 * that are equally alive.
 */
function playerVideo(): WebkitVideo | null {
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
 * After a refusal, the next tap goes straight to fullscreen.
 *
 * Because there is no way to fall back within one tap. Everything that opens a
 * window or a fullscreen player on iOS needs user activation, and activation
 * does not survive the wait needed to find out whether the first call worked —
 * WebKit reports the new presentation mode asynchronously. A fallback issued
 * 900ms later is issued without a gesture and is refused, which is how the
 * button could report "전체화면으로 넘겼습니다" and leave the screen unchanged.
 *
 * So the second tap does what the first one learned.
 */
let preferFullscreen = false

/**
 * Which call this tap makes. Decided before anything is called, and only from
 * what is knowable at that instant — because after the first `await` the tap is
 * over and nothing privileged can be issued at all.
 *
 * `supported === false` is WebKit saying this video cannot be floated; asking
 * anyway wastes the one gesture the user gave us, so it goes straight to the
 * route that ends in a floating window on iOS by another road.
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
 * Put it back in the page.
 *
 * The other half of the button, and it was missing: every tap asked for a
 * window, so once one was open the control did nothing and the only way back was
 * whatever the system's own window offered. Undoing is the same gesture rule as
 * doing, so it happens here, synchronously.
 */
function leavePip(video: WebkitVideo): void {
  // Theirs now — the hold exists to protect a departure, not to trap a video.
  floatingAway = false
  preferFullscreen = false
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

/**
 * Everything here runs inside the tap. No awaits before a privileged call.
 */
function enterPip(video: WebkitVideo): void {
  if (isFloating(video)) return leavePip(video)

  // Right now, not at the last sweep. YouTube puts `disablePictureInPicture`
  // back on the element whenever it rebuilds the player, and WebKit reads it
  // when deciding whether the mode is supported at all — a stale clear is the
  // same as no clear.
  allowPip(video)

  // Ours from here, which is what makes guardPresentation do its job: YouTube
  // reacts to the mode change and puts the video back inline, and the guard only
  // holds the line for a window we opened. Set on the button path too — it was
  // set only on the automatic one, so a tap could open a window that YouTube
  // closed again a moment later.

  // WebKit refuses to float a video that is not playing, and on YouTube the tap
  // that reaches this button often happens while paused.
  if (video.paused) void video.play().catch(() => {})

  // The API that exists to answer this exact question. `false` is a real answer
  // — no amount of calling will work — while `undefined` only means this browser
  // has no opinion to give.
  const supported =
    typeof video.webkitSupportsPresentationMode === 'function'
      ? video.webkitSupportsPresentationMode('picture-in-picture')
      : undefined

  // No toast for the ordinary case any more. It was there when the phone could
  // not be asked anything; the log answers all of it now, and a banner across
  // somebody's video every time they press a button is a cost with no payer.
  log(`탭: 지원=${supported ?? '?'} 모드=${video.webkitPresentationMode ?? '?'} 재생=${!video.paused}`)
  const route = chooseEntry({
    preferFullscreen,
    supported,
    webkit: typeof video.webkitSetPresentationMode === 'function',
    standard: typeof video.requestPictureInPicture === 'function',
    fullscreen: typeof video.webkitEnterFullscreen === 'function',
  })

  log(`탭: 경로=${route}`)
  if (route === 'webkit' && typeof video.webkitSetPresentationMode === 'function') {
    try {
      video.webkitSetPresentationMode('picture-in-picture')
      void confirmOrOfferFullscreen(video)
      return
    } catch (e) {
      toast(`webkit 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (route === 'standard' && typeof video.requestPictureInPicture === 'function') {
    // The call is what needs the gesture; its promise settling later is fine.
    video.requestPictureInPicture().catch((e: unknown) => {
      toast(`표준 API 거절: ${e instanceof Error ? e.message : String(e)}`)
      preferFullscreen = true
    })
    return
  }

  // On iOS the system's own fullscreen player carries a PiP control, and leaving
  // the app from fullscreen is the one hand-over iOS does by itself. So this is
  // not a consolation prize — it is the route that actually ends in a floating
  // window on that device.
  if (typeof video.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen()
      preferFullscreen = false
      toast(
        '전체화면으로 넘겼습니다 — 이 상태로 홈으로 나가면 작은 창이 됩니다 ' +
          '(설정 → 일반 → 그림 속 그림이 켜져 있어야 합니다)',
      )
      return
    } catch (e) {
      toast(`전체화면도 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  toast('이 브라우저에서 PiP 진입점을 찾지 못했습니다')
}

/**
 * Did the window actually open? Answered late, acted on next tap.
 *
 * WebKit can take the call, fire webkitpresentationmodechanged and leave nothing
 * on screen. Reading the mode straight away always says `inline`, so the answer
 * has to be waited for — and by then nothing privileged can be called, which is
 * why this only tells the user what the next tap will do.
 */
async function confirmOrOfferFullscreen(video: WebkitVideo): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, PRESENTATION_SETTLE_MS))
  log(`탭 결과: 모드=${video.webkitPresentationMode ?? '?'}`)
  if (video.webkitPresentationMode === 'picture-in-picture') {
    preferFullscreen = false
    return
  }
  preferFullscreen = true
  toast(
    `작은 창이 열리지 않았습니다 (모드: ${video.webkitPresentationMode ?? '알 수 없음'}) — ` +
      '한 번 더 누르면 전체화면으로 넘깁니다',
  )
}

/**
 * Clear the page's opt-out. It is an attribute and a property; both count.
 *
 * Load-bearing for `requestPictureInPicture`, which honours it. Measured not to
 * matter for Safari's `webkitSetPresentationMode` — see the note at the top of
 * this file — but iOS is not macOS and the call is free.
 */
function allowPip(video: WebkitVideo): void {
  if (video.hasAttribute('disablePictureInPicture')) {
    video.removeAttribute('disablePictureInPicture')
  }
  if (video.disablePictureInPicture) video.disablePictureInPicture = false
}

function ensureButton(video: WebkitVideo): void {
  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
  if (button?.isConnected) {
    // Keep it pointing at whatever video is current — YouTube swaps the element
    // out on navigation without touching ours.
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      enterPip(video)
    }
    return
  }

  button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.title = '화면 속 화면으로 보기'
  button.setAttribute('aria-label', '화면 속 화면으로 보기')

  // Fixed to the viewport and parented to <html>, not to the player.
  //
  // Inside the player it was visible and unpressable: YouTube stacks its own
  // controls over that corner, and whichever of its layers owns the tap owns it
  // whatever z-index we ask for — a child cannot climb out of its parent's
  // stacking context. Out here there is nothing above it.
  //
  // Where it sits is decided by place(), against the player's own box. Pinned to
  // a corner of the viewport it landed in the middle of the recommendations on a
  // phone — a control belonging to nothing, over content it has nothing to do
  // with. 44px because that is the smallest thing a thumb reliably hits.
  button.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:104px',
    'z-index:2147483647',
    `width:${BUTTON_SIZE}px`,
    `height:${BUTTON_SIZE}px`,
    'display:grid',
    'place-items:center',
    'padding:0',
    'margin:0',
    'border:none',
    // The hit area is transparent; the chip inside is what is seen.
    'background:transparent',
    'cursor:pointer',
    'touch-action:manipulation',
    '-webkit-tap-highlight-color:transparent',
  ].join(';')
  button.innerHTML =
    `<span style="display:grid;place-items:center;width:${CHIP_SIZE}px;height:${CHIP_SIZE}px;` +
    // See-through: it sits on top of what someone is watching, so it should take
    // as little of it as it can and still be findable.
    'border-radius:9px;background:rgba(24,24,37,.42);' +
    'border:1px solid rgba(255,255,255,.16);box-shadow:0 4px 14px -6px rgba(0,0,0,.5)">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="#fab387" stroke="none"/></svg>' +
    '</span>'

  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    enterPip(video)
  }
  log('PiP 버튼 붙임')

  // Parented to <html> rather than <body>: YouTube rewrites body's children on
  // navigation, and a button that vanishes on every tap through the app is
  // worse than one that was never there.
  document.documentElement.appendChild(button)
  place()
  for (const [target, event] of placementSignals()) {
    target.addEventListener(event, place, { passive: true })
  }
}

/**
 * Where the button goes: the player's bottom-right corner, inset.
 *
 * The player is what this control acts on, so it sits on the player. When the
 * player has been scrolled away there is nothing to act on and the button hides
 * rather than hovering over whatever happened to scroll past.
 *
 * Positioned in visual-viewport coordinates. On iOS the layout viewport is not
 * the visible one — the browser's own bars overlay it — so a `bottom:` offset
 * lands somewhere that looks arbitrary, which is exactly how it looked.
 */
function place(): void {
  const button = document.getElementById(BUTTON_ID) as HTMLElement | null
  if (!button) return
  const player = document.querySelector('#movie_player') ?? playerVideo()
  const box = player?.getBoundingClientRect()
  const view = window.visualViewport

  const visibleTop = view?.offsetTop ?? 0
  const visibleBottom = visibleTop + (view?.height ?? window.innerHeight)
  const visibleRight = (view?.offsetLeft ?? 0) + (view?.width ?? window.innerWidth)

  if (!box || box.height < 80 || box.bottom < visibleTop + 40 || box.top > visibleBottom - 40) {
    button.style.display = 'none'
    return
  }

  // The label follows the state — the same control does both directions now, and
  // a button that still says "작은 화면으로" while the window is open is a lie.
  const video = playerVideo()
  const floating = video ? isFloating(video) : false
  const label = floating ? '작은 화면 접기' : '화면 속 화면으로 보기'
  button.title = label
  button.setAttribute('aria-label', label)
  const mark = button.querySelector('rect + rect') as SVGRectElement | null
  mark?.setAttribute('fill', floating ? '#a6e3a1' : '#fab387')

  // Tighter into the corner across than down: the player's own controls run along
  // the bottom, and the right edge is the one place nothing else wants.
  const inset = 12
  const insetX = 4
  const top = Math.min(box.bottom - BUTTON_SIZE - inset, visibleBottom - BUTTON_SIZE - inset)
  const left = Math.min(box.right - BUTTON_SIZE - insetX, visibleRight - BUTTON_SIZE - insetX)
  button.style.display = 'grid'
  button.style.top = `${Math.max(visibleTop + inset, top)}px`
  button.style.left = `${Math.max(inset, left)}px`
  button.style.right = 'auto'
  button.style.bottom = 'auto'
}

/** Everything that can move the player under the button. */
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
 * Stop the page pulling the video back out of the small window.
 *
 * YouTube reacts to presentation mode changes and can put the video back
 * inline — from its point of view a floating window is a state it did not ask
 * for. The event is stopped in the capture phase, before its listeners see it,
 * while the window is one we opened.
 *
 * Only while ours: the user closing the window themselves has to work, and it
 * arrives as the same event.
 */

function guardPresentation(video: WebkitVideo): void {
  if (video.dataset.ocAbpGuarded === '1') return
  video.dataset.ocAbpGuarded = '1'

  /*
   * A sensor, not a guard.
   *
   * It used to swallow these events to stop the player dragging the video back,
   * and to reopen the window when it did. Neither is needed: the player is refused
   * the listener it cancels with (src/main/deafenPlayer.ts), and both mechanisms
   * cost more than they saved — the swallow left the page one event out of phase,
   * and the reopen fought the restore.
   *
   * What is left is the only honest signal in the system. `webkitSetPresentationMode`
   * reports success whether or not a window was presented, so "we asked" proves
   * nothing; this event, with the mode actually reading picture-in-picture, is the
   * one thing that says a window exists.
   */
  video.addEventListener('webkitpresentationmodechanged', () => {
    const mode = video.webkitPresentationMode ?? '?'
    log(`모드 바뀜 → ${mode} (재생=${!video.paused} 시간=${video.currentTime.toFixed(1)})`)

    if (mode === 'picture-in-picture') {
      floatingAway = true
      floatedVideo = video
      return
    }

    // Back in the page, by whoever's doing. Nothing of the departure survives it.
    floatingAway = false
    floatedVideo = null
  })
}

/** Last state the stall watch reported, so it says it once rather than every sweep. */
let stalledSince = 0

/**
 * Playing with nothing to show.
 *
 * Reported from the phone: the spinner runs forever while the audio keeps going.
 * It is a state the page cannot be asked about after the fact, so it is written
 * down as it happens — readyState says whether there are frames to draw,
 * networkState whether it is still fetching, and the presentation mode whether
 * this followed a trip to a floating window.
 */
function watchForStall(video: WebkitVideo): void {
  const stalled = !video.paused && !video.ended && video.readyState < 3
  if (!stalled) {
    stalledSince = 0
    return
  }
  const now = Date.now()
  if (stalledSince === 0) {
    stalledSince = now
    return
  }
  if (now - stalledSince < 4000) return
  stalledSince = now
  log(
    `멈춤: readyState=${video.readyState} network=${video.networkState} ` +
      `모드=${video.webkitPresentationMode ?? '?'} 시간=${video.currentTime.toFixed(1)} ` +
      `버퍼=${video.buffered.length}`,
  )
}

function sweep(): void {
  /*
   * The hold stops background playback telling the page it is visible, so a hold
   * left up is background playback switched off for good — which is what happened:
   * every path that lowers it is a path through leaving and coming back, and a
   * departure that never completes leaves it standing.
   *
   * This runs on every sweep and costs an attribute read. Somebody is looking at
   * the page and nothing of ours is away: there is nothing to hold.
   */
  const video = playerVideo()
  if (!video) return

  /*
   * Say it again now there is something to say.
   *
   * The report is written when the filters are applied, which on YouTube is
   * before the player exists — so the panel answered "비디오 0개 · PiP 없음 · 표시
   * 모드 inline" for the rest of the page's life, describing a moment half a
   * second after navigation rather than anything the reader was asking about. It
   * reads as a broken extension and it is a stale snapshot.
   *
   * Once, on the first video to appear. Reporting on every sweep would write to
   * storage on every mutation YouTube makes, which is most of them.
   */
  // Metadata, not merely an element. `webkitSupportsPresentationMode` answers
  // "no" for a video it knows nothing about yet, and a panel that reports
  // `PiP 지원: 아니오` about a video that supports it perfectly well sends the
  // reader after a problem that is not there — it did, one release ago.
  if (!reportedWithVideo && video.readyState >= 1) {
    reportedWithVideo = true
    reportDiagnostics()
  }

  allowPip(video)
  guardPresentation(video)
  watchPlayback(video)
  keepFloatingAlive(video)
  watchForStall(video)
  // Drawn whenever there is a video, and only when asked for. Gating on a
  // capability check meant no button at all on the device this was written for —
  // webkitSupportsPresentationMode answers "not yet" before the video has
  // metadata — and a button that reports why it failed beats one that never
  // appears.
  if (wantButton) {
    ensureButton(video)
    place()
  }
}

/** Read back by src/isolated/diagnostics.ts, which has its own copy of the name. */
const AUTO_ATTR = 'data-oc-abp-autopip'


export function shouldAutoPip(state: {
  hidden: boolean
  video: { paused: boolean; ended: boolean } | null
}): boolean {
  // Nothing to hand over if the tab is still in front, if there is no video, or
  // if it was not playing — putting a paused video in a floating window is a
  // window nobody asked for, sitting over whatever they left to do.
  if (!state.hidden) return false
  if (!state.video) return false
  return !state.video.paused && !state.video.ended
}

/**
 * The synchronous attempt, made from inside the event handler.
 *
 * iOS stops running the page the moment the app goes to the background. Not
 * "slows"; stops. Anything after an `await` in a visibilitychange handler may
 * simply never run, so the call that matters has to happen on the same tick as
 * the event, before any promise, any timer, any lookup that can be deferred.
 * This is the whole reason automatic PiP is a separate path from the button.
 */
type Attempt = 'called' | 'threw' | 'no-entry'

function attemptSync(video: WebkitVideo): Attempt {
  try {
    if (typeof video.webkitSetPresentationMode === 'function') {
      // One call, and no reading back. `webkitPresentationMode` is updated
      // asynchronously — the button path waits PRESENTATION_SETTLE_MS before
      // trusting it — so a read on this tick always says `inline`, including
      // when the request was accepted. This used to read it anyway and
      // "escalate" to fullscreen on `inline`, which meant a granted PiP was
      // immediately overridden by a fullscreen request.
      video.webkitSetPresentationMode('picture-in-picture')
      return 'called'
    }
    if (typeof video.requestPictureInPicture === 'function') {
      // Fires the request now; its promise settles later, which is fine — the
      // browser has already been told.
      void video.requestPictureInPicture().catch(() => {})
      return 'called'
    }
  } catch {
    // Taken and refused, which is a different thing from there being nothing to
    // call. The panel keeps them apart because they need opposite fixes.
    return 'threw'
  }
  return 'no-entry'
}

/**
 * Everything that happened at the moment nobody can watch, written where it
 * survives.
 *
 * An attribute, synchronously, because iOS is about to stop running this page: a
 * storage write started here would never flush, while an attribute is still on
 * the element when the page comes back.
 *
 * Every path writes one, including the ones that decide to do nothing. Silence
 * used to mean four different things — the handler never ran, it ran on a signal
 * that fires before the page is hidden, there was no video, the video was
 * paused — and the first of those is a bug in this extension while the rest are
 * not. A panel that cannot tell them apart sends the reader after the wrong one.
 */
function record(signal: string, outcome: string): void {
  document.documentElement.setAttribute(AUTO_ATTR, `${signal}:${outcome}`)
  log(`나감 ${signal} → ${outcome}`)
}

/**
 * YouTube Music gets sound, not a window.
 *
 * The two cannot both be had — a floating window is the only way iOS keeps a web
 * page's media alive, and it is a window, on top of whatever you left to do. For a
 * video that is the point; for a song it is a black rectangle following you around.
 * So on Music nothing is floated and background playback carries it, which is
 * src/isolated/keepPlaying.ts and is on by default.
 */
/**
 * A function, not a constant: this module is imported by a unit test in node,
 * where `location` does not exist — the same reason the signal lists are functions.
 */
function isMusic(): boolean {
  return typeof location !== 'undefined' && location.hostname.startsWith('music.')
}

/** One hand-over per departure, however many signals announce it. */
let handedOver = false

/** And one re-request: the play promise and the `playing` event both arrive. */
let retried = false

/**
 * Did a departure actually happen?
 *
 * Opening the floating window makes the page look like it has just been come back
 * to — focus lands, visibility settles — and the restore path took that at face
 * value and put the video straight back inline, 58ms after floating it. Measured on
 * the device, and it is the whole of why leaving "did not work" while the log said
 * the window had opened.
 *
 * So coming back has to be the end of a going away, and the going away has to have
 * been real: the page hidden, or the early float still standing after its check.
 */
let wentAway = false


/**
 * Where the video was when we left it.
 *
 * Coming back it can be at zero with nothing buffered — the element has been reset
 * under us, which the stall watch caught on the device: readyState 1, time 0.00,
 * playing nothing. Pressing play on that plays the video from the start, which is
 * worse than not resuming at all. So the position goes with us.
 */
let leftAt = 0


/**
 * Floated for this departure, and still expecting to be floating.
 *
 * The guard against YouTube pulling the video back inline expires after a moment,
 * because holding it open indefinitely left the player believing the video was
 * somewhere it was not. But the pull can come later than that — measured on the
 * device at four and a half seconds, still playing, page still away:
 *
 *   17:39.017  모드 → picture-in-picture
 *   17:44.093  모드 바뀜 → inline (재생=true 시간=8.5)
 *
 * Nobody asked for that. The user is not looking at the page, so it is not theirs,
 * and it is not ours. So instead of holding the door shut, the window is opened
 * again — which is also what happens if the pull was the player rebuilding itself.
 */
let floatingAway = false

/** The element this departure handed over, so another one cannot answer for it. */
let floatedVideo: WebkitVideo | null = null


/**
 * Where the video was before we moved it, so coming back can put it there.
 *
 * Inline is not the only right answer. Someone watching fullscreen who leaves
 * and comes back expects fullscreen; dropping them into a small inline player
 * with the page around it is the extension deciding how they should watch.
 */
let modeBeforeLeaving: string | null = null

/**
 * Which presentation to put the video back into on return.
 *
 * `null` means leave it alone — either it is already there, or it is somewhere
 * we did not put it and therefore not ours to change.
 */
export function modeToRestore(state: {
  before: string | null
  current: string | undefined
}): 'inline' | 'fullscreen' | null {
  const target = state.before === 'fullscreen' ? 'fullscreen' : 'inline'
  const current = state.current ?? 'inline'
  if (current === target) return null
  // Only ever out of a floating window or a fullscreen we arranged. Anything
  // else on screen is the player's business.
  if (current !== 'picture-in-picture' && current !== 'fullscreen') return null
  return target
}

/**
 * When the video was last known to be playing.
 *
 * Because by the time we are told the user is leaving, it is not playing any
 * more. Measured on the device: every leaving signal arrives with
 * `paused === true`, since WebKit stops media at the engine level as the app
 * goes to the background — before the page hears about it. Bailing on "not
 * playing" therefore bailed every single time.
 *
 * A few seconds of memory separates that from a video the user paused and walked
 * away from, which nobody wants floating over what they went to do.
 */
let lastPlayingAt = 0

/** When it stopped, and whether the page was already gone when it did. */
let pausedAt = 0
let pausedWhileHidden = false

/**
 * Keep it playing while it is floating.
 *
 * A paused video is the commonest reason a picture-in-picture window closes by
 * itself, and while one is open iOS counts the page as visible — so the
 * background-playback resume, which waits for the page to be hidden, never runs.
 * YouTube pausing once in that window took the window with it.
 *
 * Separate from that resume on purpose: this one asks no questions about who
 * paused it. For the span of a departure the answer cannot be the user, because
 * the user is not here.
 */
function keepFloatingAlive(video: WebkitVideo): void {
  if (video.dataset.ocAbpFloatWatch === '1') return
  video.dataset.ocAbpFloatWatch = '1'
  video.addEventListener('pause', () => {
    if (!floatingAway || video.ended) return
    log('작은 창: 멈춰서 다시 재생')
    void video.play().catch((e: unknown) => {
      log(`작은 창: 재생 거절 — ${e instanceof Error ? e.message : String(e)}`)
    })
  })
}

function watchPlayback(video: WebkitVideo): void {
  if (video.dataset.ocAbpPlayWatch === '1') return
  video.dataset.ocAbpPlayWatch = '1'
  const playing = () => {
    lastPlayingAt = Date.now()
  }
  video.addEventListener('playing', playing)
  video.addEventListener('timeupdate', playing)
  video.addEventListener('pause', () => {
    pausedAt = Date.now()
    // The real value: this world does not see the spoof the page is given.
    pausedWhileHidden = document.hidden
  })
  if (!video.paused) playing()
}

/**
 * Who stopped this video?
 *
 * It matters, because one of them wants it back and the other does not. WebKit
 * stops media at the engine level as the app goes to the background, so by the
 * time anything hears about the leaving, the video is paused — resuming that is
 * restoring what the user had. Someone who pressed pause and then left wants it
 * to stay paused, and starting it again over whatever they went to do is the
 * extension helping itself to their phone.
 *
 * The two are told apart by when and where the pause happened: the engine's
 * lands with the page already hidden, or in the same breath as the departure.
 * A pause made while looking at the page, a moment earlier, is a person's.
 */
export function shouldResumeOnLeave(state: {
  now: number
  pausedAt: number
  pausedWhileHidden: boolean
  lastPlayingAt: number
}): boolean {
  // Never played, or not for a while — nothing here is being taken away.
  if (state.lastPlayingAt === 0) return false
  if (state.now - state.lastPlayingAt > 5000) return false
  if (state.pausedWhileHidden) return true
  // Same breath as the departure. A person's pause is separated from it by the
  // time it takes to then leave the app.
  return state.now - state.pausedAt < 400
}

/**
 * Hand the video over when the tab goes away.
 *
 * Several signals, not one, and they overlap on purpose — the cost of a second
 * attempt is nothing, the cost of missing the only one that fired is the
 * feature. What each is worth, measured rather than assumed:
 *
 *   visibilitychange  the documented route, and the only one that is reliably
 *                     hidden by the time it fires. Background playback swallows
 *                     the real one, so it also arrives under our own name.
 *   pagehide          not swallowed, and hidden by the time it lands
 *   blur              fires before the page is hidden, so the guard below turns
 *                     it away. Kept for the record it leaves, not for the work
 *                     it does — ungating it would float a window when someone
 *                     merely tapped the address bar.
 *   freeze            does not exist in WebKit. Harmless on Chromium, inert on
 *                     the phone this was written for.
 */
function onLeaving(event: Event): void {
  if (handedOver) return
  if (isMusic()) return
  const signal = event.type

  const video = playerVideo()
  if (!video) return record(signal, 'skip:no-video')
  if (!document.hidden) {
    log(`나감 ${signal} → 아직 안 숨겨짐 (기록 안 함)`)
    return
  }

  /*
   * A departure happened, whatever comes of it.
   *
   * This was set only on the home-swipe path, and everything that undoes a
   * departure lives behind it in onReturning — so an ordinary leave (lock screen,
   * app switcher, a swipe this file failed to recognise) latched `handedOver`
   * true and never lowered it. From then on the guard at the top of this function
   * turned away every further departure for the life of the page: the free shot
   * that works when a tap is still warm was gone after the first miss.
   *
   * It also took the diagnostics with it. The only report written after a
   * departure is the one at the end of onReturning, so the log of what happened
   * while the app was away never reached storage, and the panel kept answering
   * with a snapshot from before the video existed. The instrument was disabled by
   * the fault it was there to find.
   *
   * Safe here and nowhere earlier: the page is genuinely hidden at this line. A
   * floating window makes iOS call the page visible, so this cannot be raised by
   * our own window opening.
   */
  wentAway = true

  if (modeBeforeLeaving === null) modeBeforeLeaving = video.webkitPresentationMode ?? 'inline'

  // Paused is the normal state here: the engine stops the media before the page
  // is told anything. Whose pause it was decides whether to undo it.
  const resume =
    video.paused &&
    shouldResumeOnLeave({ now: Date.now(), pausedAt, pausedWhileHidden, lastPlayingAt })
  if (!shouldAutoPip({ hidden: document.hidden, video }) && !resume) {
    return record(signal, video.paused ? 'skip:사용자가-멈춤' : 'skip:paused')
  }

  handedOver = true
  leftAt = video.currentTime

  // On this path, now. A clear from the last sweep is not a clear: YouTube puts
  // the opt-out back whenever it rebuilds the player, and WebKit reads it when
  // deciding whether the mode is available at all.
  allowPip(video)

  /*
   * The free shot, and it is expected to be refused.
   *
   * WebKit grants a floating window only inside a live user activation — Apple's
   * own answer on this is that picture-in-picture may begin only in response to
   * user interaction and never programmatically — and a departure has none. The
   * call reports success either way, so nothing here treats it as proof.
   */
  if (resume) {
    log('나감: 엔진이 멈춘 영상 되살리기 시도')
    void video
      .play()
      .then(() => askAgain(video))
      .catch(() => {
        // The 'playing' listener below is the other half of this.
      })
    video.addEventListener('playing', () => askAgain(video), { once: true })
  }

  // The activation goes in the record because it is the difference between a call
  // that could have worked and one that never could, and the two are otherwise
  // indistinguishable afterwards — WebKit reports success either way.
  const gesture = activation()
  const attempt = attemptSync(video)
  record(signal, `${attempt}:from-${video.webkitPresentationMode ?? 'unknown'}:활성화=${gesture}`)
}

/**
 * Ask once more, now that it is really playing.
 *
 * Gated on our own confirmation rather than on `webkitPresentationMode`: the mode
 * can read picture-in-picture with nothing on screen, and trusting it there meant
 * the one call that could have worked — playing, then ask — was skipped as
 * unnecessary.
 */
function askAgain(video: WebkitVideo): void {
  if (retried || floatingAway) return
  retried = true
  if (!document.hidden || video.paused || video.ended) return
  allowPip(video)
  log(`나감: 재요청 → ${attemptSync(video)}`)
}

/**
 * Put it back the way it was.
 *
 * Coming back from the home screen with the video in a floating window, or
 * still fullscreen because iOS never floated it, the natural thing is the page
 * as you left it. So the video goes back inline — but only if we are the ones
 * who moved it.
 */
/**
 * Is the user actually here?
 *
 * Not `document.hidden`: with a floating window open iOS counts the page as
 * visible, so the window opening announces itself as a return — and the restore
 * that follows closed the window two seconds after opening it, every time, which
 * is what "자동 전환이 안 된다" looked like from the outside while the log said it
 * had worked.
 *
 * Focus is the one that knows. A page in an app that is in the background does
 * not have it, whatever it believes about being visible.
 */
function userIsHere(): boolean {
  try {
    return !document.hidden && document.hasFocus()
  } catch {
    return !document.hidden
  }
}

/**
 * Standing guard against this function calling itself.
 *
 * Clearing the state before announcing is what breaks the cycle; this is what
 * stops the next one being a live bug instead of a caught one. Anything that
 * dispatches an event from in here can come back through one of four signals,
 * and re-entering is never the right answer.
 */
let returning = false

function onReturning(): void {
  if (returning) return
  returning = true
  try {
    handleReturn()
  } finally {
    returning = false
  }
}

function handleReturn(): void {
  /*
   * One rule, one direction: the user is here, so the video belongs here.
   *
   * This grew four ways to decide the same thing — a visibility test, a grace
   * period that re-armed itself on a timer, a mode comparison against where the
   * video started, and a separate "always restore" branch — and they closed the
   * window between them about a quarter of a second after it opened, with no
   * evidence anyone had come back. With a floating window open iOS reports the
   * page visible, so only focus can answer this.
   */
  if (!userIsHere()) return

  /*
   * Flush before deciding anything, and unconditionally.
   *
   * The log lives in a DOM attribute because that is the only thing that survives
   * the page being suspended, and it reaches storage only through a report. With
   * the only report sitting after the `wentAway` test below, a departure that did
   * not restore was a departure nobody could read afterwards — including the one
   * that would have shown why it did not restore.
   */
  reportDiagnostics()

  if (!wentAway) return

  const video = floatedVideo ?? playerVideo()
  log(`돌아옴: 모드=${video?.webkitPresentationMode ?? '?'}`)

  // Close the record before anything changes the mode: what the system did while
  // the app was away is readable only in this instant.
  const mark = document.documentElement.getAttribute(AUTO_ATTR)
  if (mark && !mark.includes('|')) {
    document.documentElement.setAttribute(
      AUTO_ATTR,
      `${mark}|back:${video?.webkitPresentationMode ?? 'unknown'}`,
    )
  }

  /*
   * Everything cleared before the announcement, because the announcement comes
   * back here.
   *
   * RETURNED_EVENT makes backgroundPlay dispatch a visibilitychange so the player
   * redraws, and visibilitychange is one of this function's own signals — so the
   * announcement re-enters here, finds `wentAway` still standing, and announces
   * again. On the device that ran until the ring buffer was full: dozens of
   * `삼킴` / `나감` pairs inside a single millisecond, which flushed every line
   * before them and took the evidence with it.
   *
   * The loop was always here. It only became reachable when ordinary departures
   * started raising `wentAway` too, which until then only a home swipe did.
   */
  handedOver = false
  retried = false
  wentAway = false
  modeBeforeLeaving = null

  // One announcement, so the page draws itself again — the swallow eats the real
  // one and a player that never hears it leaves the frame blank.
  document.dispatchEvent(new CustomEvent(RETURNED_EVENT))

  if (video && video.webkitPresentationMode === 'picture-in-picture') {
    const wasPlaying = !video.paused && !video.ended
    log('돌아옴: 작은 창을 페이지로 되돌림')
    try {
      video.webkitSetPresentationMode?.('inline')
    } catch {
      // Leave it where it is rather than fight the browser for it.
    }
    if (wasPlaying) resumeAfterRestore(video)
  }

  floatingAway = false
  floatedVideo = null
  reportDiagnostics()
}

/**
 * Coming back out of the small window stopped the video.
 *
 * Reported from the phone, and it is the presentation change that does it —
 * either WebKit or YouTube reacting to it. Whatever pauses it, someone who left
 * a video playing and came back to it expects it playing, and there is no tap in
 * the way to make that happen.
 *
 * Resuming is allowed here: iOS gates the *first* play on a gesture, and this
 * media has long since been started by one. Two attempts, because the pause can
 * land after the mode has finished changing — and no more than two, because a
 * loop that fights the player is worse than a video that stays paused.
 */
/**
 * Make it draw a frame again.
 *
 * Coming back from the small window the video can play with nothing on screen —
 * audio running, picture black. The element is fine and its compositing is not:
 * nothing has asked it for a frame since the presentation changed. A seek of a
 * thousandth of a second is the smallest thing that forces one, and the style
 * touch either side of it makes the compositor rebuild the layer it dropped.
 */
function nudgeFrame(video: WebkitVideo): void {
  try {
    video.style.transform = 'translateZ(0)'
    if (video.readyState >= 2 && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(video.duration - 0.05, video.currentTime + 0.001)
    }
    requestAnimationFrame(() => {
      video.style.transform = ''
      log('복귀: 화면 한 장 다시 그리기')
    })
  } catch {
    // A black frame is better than an exception in somebody's player.
  }
}

function resumeAfterRestore(video: WebkitVideo): void {
  nudgeFrame(video)
  // Put it back where it was first. A reset element plays from the beginning, and
  // a video that restarts is a worse answer than one that stays paused.
  if (leftAt > 2 && video.currentTime < 1 && Number.isFinite(video.duration)) {
    try {
      video.currentTime = leftAt
      log(`복귀: 위치 되돌림 ${Math.round(leftAt)}초`)
    } catch {
      // The element may not be seekable yet; playing from where it is beats
      // fighting it.
    }
  }
  let tries = 0
  const tick = () => {
    tries += 1
    if (!video.paused || video.ended) {
      if (tries > 1) log(`복귀 후 재생 재개 (시도 ${tries})`)
      return
    }
    video.play().catch((e: unknown) => {
      log(`복귀 후 재생 거절: ${e instanceof Error ? e.message : String(e)}`)
    })
    if (tries < 2) setTimeout(tick, 400)
  }
  setTimeout(tick, 120)
}

// --- Catching the way out ----------------------------------------------------
//
// The button works because a tap carries user activation. Leaving does not — and
// the last thing a person does before leaving is a gesture: the swipe up from the
// bottom edge that goes home. That touch reaches the page before the system takes
// it, which makes it the one moment before the app goes away that can ask for a
// window and be granted it.
//
// So the swipe is watched for, and the request is made inside the handler, on the
// same tick, exactly as the button does it. Nothing is simulated and no gesture is
// taken from anyone: it is the user's own way out, used for the thing they asked
// for when they switched this on.
//
// Narrow on purpose. The press has to start within a thumb's width of the bottom
// edge, travel upwards, and travel further up than sideways — page scrolling does
// not begin down there, and a horizontal swipe is a different intention.

/**
 * How close to the bottom edge a press has to start to be the way out.
 *
 * Widened, because this is no longer a nicety — it is the mechanism. Apple's own
 * answer on this is that picture-in-picture may only begin in response to user
 * interaction and never programmatically, and WebKit enforces it by granting the
 * window only inside a live user activation. A call from a visibility handler
 * reports success, fires the change event, and presents nothing; that is the
 * "모드는 PiP 인데 창이 없다" exactly, and it is why the same code worked whenever a
 * tap happened to be a second or two old.
 *
 * The swipe up from the bottom is the gesture that leaves, and its touch reaches
 * the page before the system takes it. It is the one moment that can ask and be
 * granted.
 */
const HOME_EDGE = 60
/** How far up it has to travel before it counts. */
const HOME_TRAVEL = 16

let swipeFrom: { x: number; y: number } | null = null

export function isHomeSwipe(state: {
  fromBottom: number
  up: number
  sideways: number
}): boolean {
  if (state.fromBottom > HOME_EDGE) return false
  if (state.up < HOME_TRAVEL) return false
  return state.up > state.sideways
}

/**
 * The bottom of what a thumb can actually reach, in the coordinates touches
 * arrive in.
 *
 * Not `window.innerHeight`. On iOS the layout viewport is not the visible one —
 * the browser's own bars overlay it — so `innerHeight` runs on underneath the
 * bottom bar, and the lowest point of the page anyone can press still measures a
 * bar's height away from it. That is 50 to 90 px against a HOME_EDGE of 60: the
 * test passed or failed depending on whether the bar happened to be expanded,
 * which is one more reason the same swipe worked some of the time.
 *
 * place() has always measured this correctly, for exactly this reason. The swipe
 * was left on the wrong ruler.
 */
function visibleBottom(): number {
  const view = window.visualViewport
  if (!view) return window.innerHeight
  return view.offsetTop + view.height
}

/**
 * Is a user activation live at this instant?
 *
 * The single thing that decides whether a request for a window is granted, and
 * until Safari 17 there was no way to ask — which is why every answer about it so
 * far has been inferred from whether a window appeared. Recorded, not acted on:
 * which of these moments carries an activation is the question the last
 * twenty-three releases guessed at, and one reading from the device settles it.
 *
 * `?` means the browser has no such API, which is itself worth knowing.
 */
function activation(): string {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  if (!ua) return '?'
  return ua.isActive ? '활성' : '만료'
}

/** So the probe below cannot fill the ring buffer that holds the departure. */
let lastProbeAt = 0

function onTouchStart(event: Event): void {
  if (!(event instanceof TouchEvent)) return
  const touch = event.changedTouches[0]
  if (!touch) return
  const fromBottom = visibleBottom() - touch.clientY
  swipeFrom = fromBottom <= HOME_EDGE ? { x: touch.clientX, y: touch.clientY } : null

  // Near misses are the evidence. If the swipe is never recognised, the reason is
  // either that the press lands further from the edge than HOME_EDGE allows or
  // that the page never sees it at all, and only one of those leaves a line here.
  // Both rulers, so the gap between them is readable rather than argued about.
  const now = Date.now()
  if (fromBottom < 160 && now - lastProbeAt > 900) {
    lastProbeAt = now
    log(
      `터치 시작: 아래에서 ${Math.round(fromBottom)}px (구식자 ${Math.round(
        window.innerHeight - touch.clientY,
      )}px) 활성화=${activation()} ${swipeFrom ? '후보' : '무시'}`,
    )
  }
}

/** How the gesture ended, and only when it was a candidate. */
function onTouchDone(event: Event): void {
  if (!swipeFrom) return
  swipeFrom = null
  log(`터치 끝: ${event.type} 활성화=${activation()}`)
}

function onTouchMove(event: Event): void {
  if (!swipeFrom || !(event instanceof TouchEvent)) return
  const touch = event.changedTouches[0]
  if (!touch) return
  const up = swipeFrom.y - touch.clientY
  const sideways = Math.abs(touch.clientX - swipeFrom.x)
  if (!isHomeSwipe({ fromBottom: visibleBottom() - swipeFrom.y, up, sideways })) return
  swipeFrom = null
  log(`나가는 손짓: 위로 ${Math.round(up)}px 활성화=${activation()}`)

  const video = playerVideo()
  if (!video) return
  // Nothing to carry away if it was not playing.
  if (video.paused || video.ended) return
  if (document.pictureInPictureElement === video) return

  /*
   * A mode that says picture-in-picture with no window on screen is a state this
   * API can get stuck in — the call reports success whether or not anything is
   * presented, so a refused attempt leaves the property claiming a window that
   * does not exist, and the next attempt is skipped as unnecessary. Putting it
   * back inline first is the only reset the prefixed API offers.
   */
  if (video.webkitPresentationMode && video.webkitPresentationMode !== 'inline') {
    if (userIsHere()) {
      log(`나가는 손짓: 모드가 ${video.webkitPresentationMode} 인데 화면엔 없음 — 되돌리고 다시`)
      try {
        video.webkitSetPresentationMode?.('inline')
      } catch {
        return
      }
    } else {
      return
    }
  }

  allowPip(video)
  leftAt = video.currentTime
  const gesture = activation()
  const attempt = attemptSync(video)
  handedOver = true
  wentAway = true
  floatingAway = attempt === 'called'
  floatedVideo = attempt === 'called' ? video : null
  // Only when something was actually taken. Raised on a refused call it stayed up
  // with no window behind it and nothing on the way to lower it.
  record('home-swipe', `${attempt}:from-${video.webkitPresentationMode ?? 'unknown'}:활성화=${gesture}`)
  setTimeout(() => {
    log(`나가는 손짓: 결과 모드=${video.webkitPresentationMode ?? '?'}`)
  }, 700)
}

/**
 * Handlers travel with their events.
 *
 * They used to be picked back out with `event === 'touchstart' ? … : …`, which
 * silently binds everything that is not touchstart to the move handler — fine for
 * two events and wrong the moment there is a third.
 */
function swipeSignals(): [EventTarget, string, EventListener][] {
  return [
    [document, 'touchstart', onTouchStart],
    [document, 'touchmove', onTouchMove],
    // Not for the work they do — for what they say. A home swipe that the system
    // takes ends in touchcancel, not touchend, and which of the two arrives
    // decides whether there is any moment left to ask in.
    [document, 'touchend', onTouchDone],
    [document, 'touchcancel', onTouchDone],
  ]
}

// --- What used to be here ---------------------------------------------------
//
// A tap on the player was spent on fullscreen, because iOS floats a fullscreen
// video by itself when the app goes away and nothing can float one at that moment.
// It worked, and it was wrong twice over: it took a gesture the user was using for
// something else — every scroll ends in a `touchend`, so dragging the page threw
// the player into fullscreen — and even done perfectly it answers a request for a
// small window with a full-screen one.
//
// The leaving path asks for picture-in-picture directly, which is the same call the
// button makes. When that call is refused there is no clever way around it, and a
// wrong answer delivered smoothly is still a wrong answer.

/** Whether the on-screen control is wanted. The behaviour does not depend on it. */
let wantButton = false

/** Start offering PiP. Safe to call repeatedly. */
export function enablePictureInPicture(options: { button: boolean }): void {
  wantButton = options.button
  for (const [target, event, handler] of swipeSignals()) {
    target.removeEventListener(event, handler, true)
    // Passive: this never prevents the gesture. Taking the user's way out away
    // from them would be a far worse bug than not floating a video.
    target.addEventListener(event, handler, { capture: true, passive: true })
  }
  if (!wantButton) document.getElementById(BUTTON_ID)?.remove()
  sweep()
  for (const [target, event] of leavingSignals()) {
    target.removeEventListener(event, onLeaving, true)
    // Capture phase: the page's own handlers can call stopPropagation, and on
    // YouTube some of them do.
    target.addEventListener(event, onLeaving, true)
  }
  for (const [target, event] of returningSignals()) {
    target.removeEventListener(event, onReturning, true)
    target.addEventListener(event, onReturning, true)
  }
  if (observer) return
  // YouTube replaces the player wholesale on navigation, taking the button with
  // it, so this watches rather than running once.
  observer = new MutationObserver(() => sweep())
  // Attributes as well as nodes: YouTube can put disablePictureInPicture back on
  // the same element it was taken off, and watching only for new nodes misses
  // that entirely — the opt-out returns and nothing notices.
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disablepictureinpicture', 'src'],
  })
}

/** Stop, and leave no trace. */
/** Whether a departure is in flight, for the other resumer to keep out of. */
export function isFloatingAway(): boolean {
  return floatingAway
}

export function disablePictureInPicture(): void {
  // Switched off with the hold up would wedge the page for the rest of its life:
  // the page's own inline calls stay refused and nothing is left to release them.
  floatingAway = false
  for (const [target, event, handler] of swipeSignals()) {
    target.removeEventListener(event, handler, true)
  }
  swipeFrom = null
  observer?.disconnect()
  observer = null
  for (const [target, event] of leavingSignals()) target.removeEventListener(event, onLeaving, true)
  for (const [target, event] of returningSignals()) target.removeEventListener(event, onReturning, true)
  for (const [target, event] of placementSignals()) target.removeEventListener(event, place)
  document.documentElement.removeAttribute(AUTO_ATTR)
  document.getElementById(BUTTON_ID)?.remove()
}
