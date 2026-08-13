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
import { pausedByUser } from './intent.ts'

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
const BUTTON_SIZE = 36
const CHIP_SIZE = 22

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

/*
 * The tap always asks for a window.
 *
 * There used to be a latch: if the presentation mode did not read
 * picture-in-picture 900ms after the call, the next tap went to fullscreen
 * instead, and nothing but a successful window ever cleared it. One bad read —
 * a mode that had already been pulled back, a check that raced the change — and
 * the control became a fullscreen button for the rest of the page's life, with
 * no way for anyone to say otherwise. Reported as "왜 전체임", and it is a
 * control quietly deciding what it is.
 *
 * A refusal is now reported and nothing more. The tap means the same thing every
 * time it is pressed.
 */

/**
 * Which call this tap makes. Decided before anything is called, and only from
 * what is knowable at that instant — because after the first `await` the tap is
 * over and nothing privileged can be issued at all.
 *
 * **On iOS the answer is fullscreen, and that is not a consolation prize.**
 *
 * What people mean by "like the app" is that leaving floats the video without
 * being asked. No web page can do that: WebKit grants a floating window only
 * inside a live user activation, and a departure has none — a day of releases
 * established that by measurement, every automatic call taken and silently
 * ignored. But iOS does it *itself* for a video in native fullscreen, with
 * Settings › General › Picture in Picture › Start PiP Automatically on. Confirmed
 * on the device: fullscreen, leave, and the window is there.
 *
 * So the tap that used to open a window now puts the video in fullscreen, and
 * leaving is automatic from then on. One tap either way, and the difference is
 * everything — a window opened on tap floats over the page you are still looking
 * at, while fullscreen is how you were going to watch it anyway. Nothing of ours
 * runs at the moment of leaving, which is the moment nothing of ours has ever
 * worked.
 *
 * The native player carries its own picture-in-picture control, so the immediate
 * window is still one tap away for anyone who wants it now.
 *
 * `supported === false` is WebKit saying this video cannot be floated at all;
 * asking anyway wastes the one gesture the user gave us.
 */
export function chooseEntry(state: {
  preferFullscreen: boolean
  supported: boolean | undefined
  webkit: boolean
  standard: boolean
  fullscreen: boolean
  /** iOS hands a fullscreen video over by itself. Nothing else does. */
  autoPipFromFullscreen?: boolean
}): 'webkit' | 'standard' | 'fullscreen' | 'none' {
  /*
   * The fullscreen-first route is gone.
   *
   * iOS really does hand a fullscreen video over by itself, and routing the tap
   * there really would make leaving automatic — but on the device the button
   * stopped responding at all, and a control that does nothing is worse than one
   * that does the wrong thing. The tap opens a window, which is measured to work
   * every time.
   */
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
    preferFullscreen: false,
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
      log(`탭: 전체화면 요청함 (모드=${video.webkitPresentationMode ?? '?'} readyState=${video.readyState})`)
      toast('이대로 홈으로 나가면 작은 창이 됩니다')
      // Said late, and only if nothing happened. WebKit takes this call and can
      // do nothing at all — the device reported a button with no visible effect,
      // and without this the log could not tell that from the call never running.
      setTimeout(() => {
        log(`탭: 전체화면 결과 모드=${video.webkitPresentationMode ?? '?'}`)
      }, PRESENTATION_SETTLE_MS)
      return
    } catch (e) {
      toast(`전체화면도 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  toast('이 브라우저에서 PiP 진입점을 찾지 못했습니다')
}

/**
 * Did the window actually open? Answered late, and only written down.
 *
 * WebKit can take the call, fire webkitpresentationmodechanged and leave nothing
 * on screen. Reading the mode straight away always says `inline`, so the answer
 * has to be waited for — and by then nothing privileged can be called, which is
 * why this changes nothing about what the next tap does.
 */
async function confirmOrOfferFullscreen(video: WebkitVideo): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, PRESENTATION_SETTLE_MS))
  log(`탭 결과: 모드=${video.webkitPresentationMode ?? '?'}`)
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
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2"' +
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

  // Hard into the bottom-right corner of the player.
  //
  // It has been walked down twice: twelve pixels up read as part of YouTube's own
  // row of controls, and four still sat above the corner. Two is as close as it
  // goes without clipping its own shadow.
  const inset = 2
  const insetX = 2
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
  allowPip(video)
  guardPresentation(video)
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

/*
 * The automatic hand-over is gone, and every piece of bookkeeping it needed with
 * it: whose pause it was, whether to resume before asking, how many times to ask
 * again, which of six signals to trust, and the record each attempt wrote.
 *
 * Nothing can float a video at the moment the app goes away. WebKit grants the
 * window only inside a live user activation and a departure has none — measured
 * across a day of releases, confirmed independently twice, and answered by Apple
 * in as many words. Eight attempts at it lived here; several of them broke
 * playback, and none of them ever opened a window.
 *
 * What is left is the button, which works every time, and one flag saying a
 * departure happened — a return still has to be announced or the player comes
 * back to a blank frame.
 */

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
    // And the window has to actually be there — a flag is a belief, this is the
    // fact. A hold left standing turned every pause the user pressed into a video
    // that started itself again.
    if (!isFloating(video)) return
    // And they may still have meant it. A window closing because its video was
    // paused is a cost; restarting a video somebody deliberately stopped is worse.
    if (pausedByUser()) return
    log('작은 창: 멈춰서 다시 재생')
    void video.play().catch((e: unknown) => {
      log(`작은 창: 재생 거절 — ${e instanceof Error ? e.message : String(e)}`)
    })
  })
}

/**
 * Note that the user has gone. Nothing else.
 *
 * Several signals, because a second notice costs nothing and missing the only one
 * that fired costs a return that never announces itself.
 */
function onLeaving(): void {
  if (!document.hidden || wentAway) return
  wentAway = true
  const video = playerVideo()
  if (video) leftAt = video.currentTime
  log('나감')
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

function onReturning(): void {
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
  if (!wentAway) return

  const video = floatedVideo ?? playerVideo()
  log(`돌아옴: 모드=${video?.webkitPresentationMode ?? '?'}`)

  // One announcement, so the page draws itself again — the swallow eats the real
  // one and a player that never hears it leaves the frame blank.
  document.dispatchEvent(new CustomEvent(RETURNED_EVENT))

  wentAway = false

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

// --- What used to be the way out --------------------------------------------
//
// A touch watcher looked for the swipe up from the bottom edge, on the theory
// that its touch reaches the page before the system takes it. The census
// answered that: over a whole session the closest any touch came to the bottom of
// the page was 477px, because the bottom of the screen belongs to the browser's
// own toolbar. Nothing here reads touches now.

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
  observer?.disconnect()
  observer = null
  for (const [target, event] of leavingSignals()) target.removeEventListener(event, onLeaving, true)
  for (const [target, event] of returningSignals()) target.removeEventListener(event, onReturning, true)
  for (const [target, event] of placementSignals()) target.removeEventListener(event, place)
  document.getElementById(BUTTON_ID)?.remove()
}
