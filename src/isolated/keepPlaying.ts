// Put it back on when the engine takes it away — ISOLATED world.
//
// Background playback has two opponents and they are not the same. The page is
// one: YouTube listens for visibilitychange and pauses itself, which
// src/main/backgroundPlay.ts handles by lying to it. The engine is the other:
// WebKit stops media when the tab goes away, inside HTMLVideoElement, where no
// amount of lying reaches. Measured on the device — every leaving signal arrived
// with the video already paused, and the log line above it said the swallow had
// worked.
//
// So this watches for that pause and asks for playback back. It is a request,
// not a guarantee: iOS may refuse to keep a hidden page's media running, and if
// it does, the refusal is written down rather than swallowed — that is the
// difference between a feature that does not work and a feature that cannot.
//
// Under the background-playback setting rather than the picture-in-picture one,
// because it is the same promise that setting already makes.

import { log } from '../shared/log.ts'
import { LEAVING_EVENT, RETURNED_EVENT } from '../shared/messages.ts'
import { isFloatingAway } from './pip.ts'
import { pausedByUser } from './intent.ts'

/** How long after a pause we still consider it the engine's doing. */
const ENGINE_PAUSE_MS = 400

let watched: HTMLVideoElement | null = null
let lastPlayingAt = 0
let enabled = false

function onPlaying(): void {
  lastPlayingAt = Date.now()
}

/**
 * Armed by the departure, spent by the first pause after it.
 *
 * The engine stops the media once, as the app goes to the background. That one
 * stop is what this file exists to undo, and everything else that arrives while
 * the page is hidden belongs to somebody: an earphone squeeze, the lock screen,
 * a headphone pulled out. Those were being resumed too, because the only test
 * was "hidden and paused", which stays true for the whole time the user is away.
 *
 * So the departure arms it, one pause spends it, and nothing re-arms it until the
 * user has been back.
 */
let armed = false

function onHiddenChanged(): void {
  if (document.hidden) {
    armed = true
    return
  }
  // Back in front. Whatever happens here is the user's, and the next departure
  // gets its own single attempt.
  armed = false
}

function onPause(): void {
  if (!enabled || !watched) return
  const video = watched

  // One resumer at a time. While a departure is in flight picture-in-picture owns
  // the element — two `play()` promises on one video make the earlier one reject
  // with AbortError, which was then logged as a refusal that never happened.
  if (isFloatingAway()) return

  if (pausedByUser()) {
    log('배경재생: 사용자가 멈춤 — 그대로 둔다')
    return
  }

  if (!document.hidden) return

  /*
   * Not the departure's stop, so not ours.
   *
   * This is the whole fix. "Hidden and paused" is true for as long as somebody is
   * away, so every pause they made out there — earphones, lock screen — read as
   * the engine's and was undone, three times over, by a retry chain that never
   * looked again at whether they still meant it.
   */
  if (!armed) {
    log('배경재생: 나간 순간의 멈춤이 아님 — 손 안 댄다')
    return
  }
  armed = false

  if (Date.now() - lastPlayingAt > ENGINE_PAUSE_MS + 1000) return

  /*
   * Once. No retries.
   *
   * There used to be three, at 120, 400 and 1200ms, because the stop can land
   * again while the browser finishes hiding the tab. It also meant a person's
   * pause was answered three times, and the chain could not be called off — its
   * later attempts fired long after we had worked out that the pause was theirs.
   * One attempt that sometimes loses the race is better than a loop that wins
   * against the user.
   */
  log('배경재생: 나간 순간 엔진이 세움 — 한 번 되살린다')
  video.play().catch((e: unknown) => {
    // The interesting case. If iOS refuses a hidden page's media outright, this
    // is where it says so, and no amount of retrying would change it.
    log(`배경재생: 거절 — ${e instanceof Error ? e.message : String(e)}`)
  })
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

/** Called from the sweep, since YouTube swaps the element out on navigation. */
export function keepPlayingSweep(): void {
  if (!enabled) return
  const videos = [...document.querySelectorAll<HTMLVideoElement>('video')]
  if (videos.length === 0) return
  attach(videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best)))
}

export function enableKeepPlaying(): void {
  if (!enabled) {
    // Both, because background playback swallows the real event before this
    // world's listeners see it and re-announces it under our own name.
    document.addEventListener('visibilitychange', onHiddenChanged, true)
    document.addEventListener(LEAVING_EVENT, onHiddenChanged, true)
    document.addEventListener(RETURNED_EVENT, onHiddenChanged, true)
  }
  enabled = true
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  armed = false
  document.removeEventListener('visibilitychange', onHiddenChanged, true)
  document.removeEventListener(LEAVING_EVENT, onHiddenChanged, true)
  document.removeEventListener(RETURNED_EVENT, onHiddenChanged, true)
  detachListeners()
}
