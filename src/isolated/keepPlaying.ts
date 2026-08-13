// Put it back on when the engine takes it away — ISOLATED world.
//
// Background playback has two opponents. The page is one: the site listens for
// visibilitychange and pauses itself, which src/main/backgroundPlay.ts defeats by
// lying about visibility. The engine is the other: WebKit stops media the moment
// the app backgrounds, inside HTMLVideoElement, where no lie reaches. This watches
// for that stop and asks for playback back.
//
// The hard part is not resuming — it is knowing WHICH pause to resume. The
// engine's stop on leaving and a person's press on the lock screen look identical
// from here: both arrive while the player is not visible. Telling them apart by
// "who pressed it" needs the media-session handler, which the site keeps taking
// back — that chase is the whole of the "무한재생" bug. They differ in one thing
// that cannot be stolen: WHEN. The engine stops in the same breath as the
// departure; a deliberate pause comes seconds later, after you have been listening
// in the background. So only a pause that lands within a moment of going hidden is
// the engine's, and only that one is put back.

import { log } from '../shared/log.ts'
import { isFloatingAway, playerVideo } from './pip.ts'

/** How long after going hidden a pause is still the engine's departure stop. */
const DEPARTURE_WINDOW_MS = 1500

/** Retries, spaced — the stop can land again as the browser finishes hiding. */
const RETRIES = [150, 500, 1000]

let watched: HTMLVideoElement | null = null
let enabled = false

/** When the page last became hidden. 0 while visible. */
let hiddenAt = 0

function onVisibility(): void {
  // The real value: the spoof lives in the other world, this listener is ours.
  hiddenAt = document.hidden ? Date.now() : 0
}

function onPause(): void {
  if (!enabled || !watched) return
  const video = watched

  // A floating window keeps itself alive (src/isolated/pip.ts); staying out avoids
  // two play() promises racing on one element.
  if (isFloatingAway()) return

  // Visible → the player is in front of them, so the pause is theirs. Leave it.
  if (!document.hidden) return

  // Both the engine's stop and a lock-screen press arrive while hidden. Only the
  // engine's rides in with the departure. A pause this long after going hidden was
  // pressed on purpose — reviving it is exactly the loop people fought.
  const sinceHidden = hiddenAt === 0 ? Infinity : Date.now() - hiddenAt
  if (sinceHidden > DEPARTURE_WINDOW_MS) {
    log(`배경재생: 나간 지 ${(sinceHidden / 1000).toFixed(1)}s 뒤 멈춤 — 사용자 것, 안 건드림`)
    return
  }

  log('배경재생: 나간 순간 엔진이 세움 — 되살림')
  let attempt = 0
  const tryPlay = () => {
    if (!enabled || video !== watched || !document.hidden) return
    // Still the departure's, not a press that landed mid-chain.
    if (Date.now() - hiddenAt > DEPARTURE_WINDOW_MS + 1500) return
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
  video.addEventListener('pause', onPause)
}

function detachListeners(): void {
  if (!watched) return
  watched.removeEventListener('pause', onPause)
  watched = null
}

/** Called from the sweep, since the site swaps the element out on navigation. */
export function keepPlayingSweep(): void {
  if (!enabled) return
  const video = playerVideo()
  if (video) attach(video)
}

export function enableKeepPlaying(): void {
  if (!enabled) {
    enabled = true
    hiddenAt = document.hidden ? Date.now() : 0
    document.addEventListener('visibilitychange', onVisibility, true)
  }
  keepPlayingSweep()
}

export function disableKeepPlaying(): void {
  enabled = false
  hiddenAt = 0
  document.removeEventListener('visibilitychange', onVisibility, true)
  detachListeners()
}
