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
import { isFloatingAway } from './pip.ts'
import { markUserPause, pausedByUser } from './intent.ts'

/** How long after a pause we still consider it the engine's doing. */
const ENGINE_PAUSE_MS = 400

/*
 * No window around the departure.
 *
 * One was added and it switched background playback off ten seconds after
 * leaving, which is the feature. The engine does not stop the media once as the
 * app goes away — it keeps stopping it, every few seconds, for as long as the page
 * is in the background, and putting it back each time is what background playback
 * is on this platform.
 *
 * What that window was really for was making a person's pause stick, and that is
 * answered by knowing whose pause it was rather than by when it arrived: the
 * media-session marker above, and the backstop below for when the marker is not
 * there.
 */

/** Retries, spaced. A pause can land again as the browser finishes hiding the tab. */
const RETRIES = [120, 400, 1200]

let watched: HTMLVideoElement | null = null
let lastPlayingAt = 0
let enabled = false

/**
 * When we last put it back, and how many times that was undone straight away.
 *
 * The backstop for everything above, and the one that needs no cooperation from
 * anybody. Telling the engine's pause from a person's depends on our
 * media-session handler still being the registered one, and it can be replaced
 * without notice — so when the inference is wrong, this is what notices.
 *
 * A person who pauses, sees it start again, and pauses again has said it twice.
 * Nothing here gets a third turn: reported from the phone as "재생이 멈추질 않아",
 * which is the extension and the user pressing the same button at each other.
 */
let resumedAt = 0
let fought = 0

/** How soon after our resume a pause counts as an answer to it. */
const FIGHT_WINDOW_MS = 2500

function onPlaying(): void {
  lastPlayingAt = Date.now()
}

function onPause(): void {
  if (!enabled || !watched) return
  const video = watched

  // One resumer at a time. While a departure is in flight picture-in-picture owns
  // the element — two `play()` promises on one video make the earlier one reject
  // with AbortError, which was then logged as a refusal that never happened.
  if (isFloatingAway()) return

  // Whose pause was it? The engine's arrives with the page already hidden.
  // Someone pressing pause while watching is not to be overruled, and this is
  // the only signal that separates them.
  //
  // Except on the lock screen, where the two look identical and the answer is the
  // opposite one: the transport controls work *because* the page is hidden, so
  // the most deliberate pause a person can make arrived here looking exactly like
  // the engine's. It was resumed every time. Intent is asked for first now.
  if (pausedByUser()) {
    log('배경재생: 사용자가 멈춤 — 그대로 둔다')
    return
  }

  // Undone straight after we put it back. Once is the engine being stubborn;
  // twice is somebody answering us.
  fought = Date.now() - resumedAt < FIGHT_WINDOW_MS ? fought + 1 : 0
  if (fought >= 2) {
    log('배경재생: 계속 멈춘다 — 사용자 뜻으로 보고 그만둔다')
    markUserPause()
    return
  }
  if (!document.hidden) return
  if (Date.now() - lastPlayingAt > ENGINE_PAUSE_MS + 1000) return



  log('배경재생: 엔진이 세움 — 되살리기 시도')
  let attempt = 0
  const tryPlay = () => {
    if (!enabled || video !== watched) return
    if (!document.hidden) return
    if (!video.paused) {
      resumedAt = Date.now()
      log(`배경재생: 되살림 (시도 ${attempt})`)
      return
    }
    attempt += 1
    video
      .play()
      .then(() => {
        resumedAt = Date.now()
        log(`배경재생: 되살림 (시도 ${attempt})`)
      })
      .catch((e: unknown) => {
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
export function keepPlayingSweep(): void {
  if (!enabled) return
  const videos = [...document.querySelectorAll<HTMLVideoElement>('video')]
  if (videos.length === 0) return
  attach(videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best)))
}

export function enableKeepPlaying(): void {
  enabled = true
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  detachListeners()
}
