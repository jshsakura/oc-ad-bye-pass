// Keep playing when the screen goes away — ISOLATED world.
//
// One feature, one switch: "나갈 때 재생 유지". It has two opponents and they are
// not the same. The page is one — the site listens for visibilitychange and
// pauses itself, which src/main/backgroundPlay.ts defeats by lying about
// visibility. The engine is the other — WebKit stops media when the tab goes to
// the background, inside HTMLVideoElement, where no lie reaches. This watches for
// that stop and asks for playback back.
//
// It is a request, not a guarantee: iOS may refuse a hidden page's media, and the
// refusal is logged rather than swallowed. What it does not do is float a window —
// that needs a live user gesture the moment of leaving does not have, which a day
// of measurement settled. On iPhone this keeps the sound; the picture is the OS's
// to give, from fullscreen, and it does.

import { log } from '../shared/log.ts'
import { RETURNED_EVENT } from '../shared/messages.ts'
import { pausedByUser } from './intent.ts'
import { reportDiagnostics } from './diagnostics.ts'

/** How long after a pause we still consider it the engine's doing. */
const ENGINE_PAUSE_MS = 400

/** Retries, spaced. The stop can land again as the browser finishes hiding the tab. */
const RETRIES = [120, 400, 1200]

interface WebkitVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
}

let watched: HTMLVideoElement | null = null
let lastPlayingAt = 0
let enabled = false
let wasHidden = false

/** Whether the panel has been told about a page that actually has a player. */
let reportedWithVideo = false

function onPlaying(): void {
  lastPlayingAt = Date.now()
}

/**
 * The video actually being watched.
 *
 * Not the widest element: on a hidden page everything measures zero, so width
 * falls to whichever comes first, which on a video site can be an empty one held
 * in reserve. Listeners on that never hear the real video stop — a departure with
 * eighty-two seconds of silence in the log. Scored by liveness instead, width
 * only breaking ties.
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

/**
 * The engine stops the media the moment the app backgrounds. Put it back —
 * unless the person is the one who stopped it.
 *
 * The engine does not stop it once; it keeps stopping it every few seconds while
 * hidden, and putting it back each time is what background playback is here. So
 * this cannot bail after the first stop. Whose pause it was is asked of the user
 * directly (the transport controls set the flag in ./intent.ts), because a count
 * or a clock cannot tell the engine's stop from a deliberate one.
 */
function onPause(): void {
  if (!enabled || !watched) return
  const video = watched

  if (pausedByUser()) {
    log('배경재생: 사용자가 멈춤 — 그대로 둔다')
    return
  }
  if (!document.hidden) return
  if (Date.now() - lastPlayingAt > ENGINE_PAUSE_MS + 1000) return

  log('배경재생: 엔진이 세움 — 되살리기 시도')
  let attempt = 0
  const tryPlay = () => {
    if (!enabled || video !== watched) return
    if (!document.hidden) return
    // Re-asked every attempt: a person's pause can land between attempts, and the
    // rest of a chain scheduled up front would answer it anyway.
    if (pausedByUser()) {
      log('배경재생: 되살리는 중에 사용자가 멈춤 — 그만둔다')
      return
    }
    if (!video.paused) return
    attempt += 1
    video.play().catch((e: unknown) => {
      // If iOS refuses a hidden page's media outright, this is where it says so.
      log(`배경재생: 거절 — ${e instanceof Error ? e.message : String(e)}`)
    })
    const next = RETRIES[attempt]
    if (next !== undefined) setTimeout(tryPlay, next)
  }
  setTimeout(tryPlay, RETRIES[0])
}

function attach(video: HTMLVideoElement): void {
  if (watched === video) return
  detachListeners()
  watched = video
  video.addEventListener('playing', onPlaying)
  video.addEventListener('timeupdate', onPlaying)
  video.addEventListener('pause', onPause)
  if (!video.paused) onPlaying()
}

function detachListeners(): void {
  if (!watched) return
  watched.removeEventListener('playing', onPlaying)
  watched.removeEventListener('timeupdate', onPlaying)
  watched.removeEventListener('pause', onPause)
  watched = null
}

/**
 * Tell the page it is back, once, when it really is.
 *
 * backgroundPlay.ts swallows every visibilitychange so the page never pauses
 * itself — including the one that says "visible again", which the page needs to
 * redraw. Without this the frame stays blank on return. The value read here is
 * the true one: the swallow is in the other world, this listener is ours.
 */
function onVisibility(): void {
  if (!enabled) return
  if (document.hidden) {
    wasHidden = true
    return
  }
  if (!wasHidden) return
  wasHidden = false
  document.dispatchEvent(new CustomEvent(RETURNED_EVENT))
  log('돌아옴 — 페이지에 다시 알림')
}

/** Called from the sweep, since the site swaps the element out on navigation. */
export function keepPlayingSweep(): void {
  if (!enabled) return
  const video = playerVideo()
  if (!video) return
  attach(video)

  // The report is first written before the player exists, so the panel says
  // "비디오 0개" for the life of the page. Say it once more when a real video with
  // metadata turns up. This used to live in pip.ts's sweep and went with it.
  if (!reportedWithVideo && video.readyState >= 1) {
    reportedWithVideo = true
    reportDiagnostics()
  }
}

export function enableKeepPlaying(): void {
  if (!enabled) {
    enabled = true
    // Capture, and the real value: see onVisibility.
    document.addEventListener('visibilitychange', onVisibility, true)
  }
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  wasHidden = false
  document.removeEventListener('visibilitychange', onVisibility, true)
  detachListeners()
}
