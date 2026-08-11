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

import { LEAVING_EVENT } from '../shared/messages.ts'
import { reportDiagnostics } from './diagnostics.ts'

const BUTTON_ID = 'oc-abp-pip'

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

/**
 * Whether the current fullscreen/PiP was our doing.
 *
 * It decides whether coming back should undo it. Someone who went fullscreen
 * themselves, left, and came back expects to still be in fullscreen — pulling
 * them out would be the extension overruling them.
 */
let engagedByUs = false

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

/** The video actually being watched — the largest one that has loaded metadata. */
function playerVideo(): WebkitVideo | null {
  const videos = [...document.querySelectorAll<WebkitVideo>('video')]
  if (videos.length === 0) return null
  return videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best))
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

/**
 * Everything here runs inside the tap. No awaits before a privileged call.
 */
function enterPip(video: WebkitVideo): void {
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
  engagedByUs = true

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

  const routes = [
    typeof video.webkitSetPresentationMode === 'function' ? 'webkit' : null,
    typeof video.requestPictureInPicture === 'function' ? 'standard' : null,
    typeof video.webkitEnterFullscreen === 'function' ? 'fullscreen' : null,
  ].filter(Boolean)
  toast(`PiP 진입점: ${routes.length ? routes.join(' · ') : '없음'} · 지원: ${supported ?? '알 수 없음'}`)

  const route = chooseEntry({
    preferFullscreen,
    supported,
    webkit: typeof video.webkitSetPresentationMode === 'function',
    standard: typeof video.requestPictureInPicture === 'function',
    fullscreen: typeof video.webkitEnterFullscreen === 'function',
  })

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
  if (video.webkitPresentationMode === 'picture-in-picture') {
    preferFullscreen = false
    return
  }
  preferFullscreen = true
  engagedByUs = false
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
  // Bottom right, clear of the player's controls and of the mobile navigation
  // bar. 44px because that is the smallest thing a thumb reliably hits.
  button.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:104px',
    'z-index:2147483647',
    'width:44px',
    'height:44px',
    'display:grid',
    'place-items:center',
    'padding:0',
    'margin:0',
    'border:none',
    'border-radius:12px',
    'background:rgba(24,24,37,.86)',
    'box-shadow:0 6px 20px -6px rgba(0,0,0,.6)',
    'cursor:pointer',
    'touch-action:manipulation',
    '-webkit-tap-highlight-color:transparent',
  ].join(';')
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="#fab387" stroke="none"/></svg>'

  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    enterPip(video)
  }

  // Parented to <html> rather than <body>: YouTube rewrites body's children on
  // navigation, and a button that vanishes on every tap through the app is
  // worse than one that was never there.
  document.documentElement.appendChild(button)
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
  video.addEventListener(
    'webkitpresentationmodechanged',
    (event) => {
      if (!engagedByUs) return
      if (video.webkitPresentationMode === 'inline') {
        // It came back inline on its own — that is either the user or YouTube,
        // and either way the window is gone, so stop guarding.
        engagedByUs = false
        return
      }
      event.stopPropagation()
    },
    true,
  )
}

function sweep(): void {
  const video = playerVideo()
  if (!video) return
  allowPip(video)
  guardPresentation(video)
  // Drawn whenever there is a video. Gating on a capability check meant no
  // button at all on the device this was written for — webkitSupportsPresentation
  // Mode answers "not yet" before the video has metadata — and a button that
  // reports why it failed beats one that never appears.
  ensureButton(video)
}

/** Read back by src/isolated/diagnostics.ts, which has its own copy of the name. */
const AUTO_ATTR = 'data-oc-abp-autopip'

export function shouldRestoreInline(state: {
  visible: boolean
  engagedByUs: boolean
  mode: string | undefined
}): boolean {
  // Only on the way back, only what we started, and only if it is still in the
  // mode we put it in.
  if (!state.visible) return false
  if (!state.engagedByUs) return false
  return state.mode === 'fullscreen' || state.mode === 'picture-in-picture'
}

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
      engagedByUs = true
      return 'called'
    }
    if (typeof video.requestPictureInPicture === 'function') {
      // Fires the request now; its promise settles later, which is fine — the
      // browser has already been told.
      void video.requestPictureInPicture().catch(() => {})
      engagedByUs = true
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
}

/** One hand-over per departure, however many signals announce it. */
let handedOver = false

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
  const signal = event.type

  const video = playerVideo()
  if (!video) return record(signal, 'skip:no-video')
  if (!document.hidden) return record(signal, 'skip:not-hidden')
  if (!shouldAutoPip({ hidden: document.hidden, video })) return record(signal, 'skip:paused')

  const attempt = attemptSync(video)
  handedOver = true
  // The mode read here is the one from before the call — WebKit updates it
  // later — so it says what we were leaving from, not what came of it. What came
  // of it is answered on the way back, by onReturning.
  record(signal, `${attempt}:from-${video.webkitPresentationMode ?? 'unknown'}`)

  // WebKit can accept the call, fire its event, and open nothing. If the page is
  // still running — a tab switch rather than a trip to the home screen — this
  // gets another go, and can fall back to the system's own fullscreen player,
  // which carries a PiP control. On a real home press none of it runs: iOS
  // suspends the page within a frame, which is why the synchronous attempt above
  // is the one that matters.
  let tries = 0
  const retry = setInterval(() => {
    tries += 1
    if (video.webkitPresentationMode === 'picture-in-picture' || tries > 4) {
      clearInterval(retry)
      return
    }
    if (!document.hidden) {
      clearInterval(retry)
      return
    }
    if (attemptSync(video) === 'called' && video.webkitPresentationMode === 'picture-in-picture') {
      clearInterval(retry)
      return
    }
    if (tries >= 2 && typeof video.webkitEnterFullscreen === 'function') {
      try {
        video.webkitEnterFullscreen()
        record(signal, `fullscreen-fallback:from-${video.webkitPresentationMode ?? 'unknown'}`)
      } catch {
        /* nothing left to try */
      }
      clearInterval(retry)
    }
  }, 350)
}

/**
 * Put it back the way it was.
 *
 * Coming back from the home screen with the video in a floating window, or
 * still fullscreen because iOS never floated it, the natural thing is the page
 * as you left it. So the video goes back inline — but only if we are the ones
 * who moved it.
 */
function onReturning(): void {
  handedOver = false
  const video = playerVideo()
  if (!video) return

  // Close the record before anything here changes the mode. What the system did
  // while the app was away is readable only in this instant: the next lines put
  // the video back inline, and then it looks like nothing ever happened.
  const record = document.documentElement.getAttribute(AUTO_ATTR)
  if (record && !record.includes('|')) {
    document.documentElement.setAttribute(
      AUTO_ATTR,
      `${record}|back:${video.webkitPresentationMode ?? 'unknown'}`,
    )
    // The page is running again, so this write survives — and the panel is about
    // to be opened by someone who just watched it not work.
    reportDiagnostics()
  }

  if (!shouldRestoreInline({
    visible: !document.hidden,
    engagedByUs,
    mode: video.webkitPresentationMode,
  })) {
    return
  }
  engagedByUs = false
  try {
    video.webkitSetPresentationMode?.('inline')
  } catch {
    // Refused — leave it where it is rather than fight the browser for it.
  }
}

/** Start offering PiP. Safe to call repeatedly. */
export function enablePictureInPicture(): void {
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
export function disablePictureInPicture(): void {
  observer?.disconnect()
  observer = null
  for (const [target, event] of leavingSignals()) target.removeEventListener(event, onLeaving, true)
  for (const [target, event] of returningSignals()) target.removeEventListener(event, onReturning, true)
  engagedByUs = false
  document.documentElement.removeAttribute(AUTO_ATTR)
  document.getElementById(BUTTON_ID)?.remove()
}
