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
export function keepPlayingSweep(): void {
  if (!enabled) return
  const videos = [...document.querySelectorAll<HTMLVideoElement>('video')]
  if (videos.length === 0) return
  attach(videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best)))
}

/**
 * Tell iOS this page is a media player, not a page that happens to make noise.
 *
 * `navigator.audioSession.type = 'playback'` (Safari 16.4) puts the page's audio
 * in the same class as a music app's, and the system stops treating it as
 * incidental sound to be cut when the app goes away. Everything else in this file
 * is the other approach — let the engine stop the media and put it back — and
 * that one is a chase: it fires after the fact, it can be wrong about whose pause
 * it answered, and it has been wrong.
 *
 * The repository's notes list this API as tried and dismissed, with the reason
 * "백그라운드 실행과 무관" — which answers whether the *page* keeps running, a
 * different question from whether the *media session* survives. It is one
 * property, it reaches into nothing, and if it works the chase never starts. If
 * it does not, the log says the API was not there and nothing else changes.
 */
function claimAudioSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) {
    log('배경재생: audioSession 없음 — 되살리기로만 간다')
    return
  }
  try {
    session.type = 'playback'
    log(`배경재생: audioSession=${session.type}`)
  } catch (e) {
    log(`배경재생: audioSession 거절 — ${e instanceof Error ? e.message : String(e)}`)
  }
}

let claimed = false

export function enableKeepPlaying(): void {
  if (!claimed) {
    claimed = true
    claimAudioSession()
  }
  enabled = true
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  detachListeners()
}
