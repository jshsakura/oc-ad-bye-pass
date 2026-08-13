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
import { isFloatingAway, playerVideo } from './pip.ts'
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
 * Retries, spaced. The stop can land again as the browser finishes hiding the tab.
 *
 * Each one re-checks intent before firing, which is what the first version of
 * this could not do: its chain was scheduled up front and its later attempts
 * arrived long after the pause had turned out to be the user's.
 */
const RETRIES = [120, 400, 1200]

/**
 * A single-shot version of this was tried and it switched background playback
 * off a few seconds after leaving.
 *
 * The engine does not stop the media once on the way out. It keeps stopping it,
 * every few seconds, for as long as the page is in the background — the device
 * log has it at fifteen, twenty-three and thirty-five seconds past a departure —
 * and putting it back each time *is* background playback here. Undoing only the
 * first stop meant the sound died with the second.
 *
 * So the answer to "whose pause was that" cannot be a count or a clock. It is
 * asked of the user directly, through the transport controls, which is the one
 * place this extension is told rather than left to guess.
 */

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

  if (Date.now() - lastPlayingAt > ENGINE_PAUSE_MS + 1000) return

  log('배경재생: 엔진이 세움 — 되살리기 시도')
  let attempt = 0
  const tryPlay = () => {
    if (!enabled || video !== watched) return
    if (!document.hidden) return
    // Re-asked on every attempt. The whole failing of the old chain was that it
    // was scheduled once and could not be called off — a person's pause landed
    // between attempts and the rest of the chain answered it anyway.
    if (pausedByUser()) {
      log('배경재생: 되살리는 중에 사용자가 멈춤 — 그만둔다')
      return
    }
    if (!video.paused) return
    attempt += 1
    video.play().catch((e: unknown) => {
      // The interesting case. If iOS refuses a hidden page's media outright,
      // this is where it says so, and no amount of retrying will change it.
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

/** Called from the sweep, since YouTube swaps the element out on navigation. */
/**
 * The video actually being watched — the same pick picture-in-picture makes.
 *
 * This chose the widest element, and on a hidden page every element measures
 * zero, so it fell to whichever came first: on YouTube that can be an empty one
 * held in reserve. The listeners went on that, and the real video could stop
 * without a word reaching here — which is what a departure looked like in the
 * device log, eighty-two seconds with nothing written at all.
 *
 * src/isolated/pip.ts learned this once already and its comment says so. Sharing
 * the pick is how it stays learned.
 */
export function keepPlayingSweep(): void {
  if (!enabled) return
  const video = playerVideo()
  if (video) attach(video)
}

/*
 * `navigator.audioSession.type = 'playback'` was tried here and the sound stopped
 * carrying at all — reported immediately, and it is the one thing that release
 * added to this path.
 *
 * The repository's notes already listed the API as dismissed. It was brought back
 * because the stated reason answered a different question, and that reasoning was
 * sound and the result was not. Whatever declaring the session does on this
 * browser, it is not what the resumer needs, and the resumer works.
 */

export function enableKeepPlaying(): void {
  enabled = true
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  detachListeners()
}
