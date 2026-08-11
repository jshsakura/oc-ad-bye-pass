// Layer 3 — the fallback. Fires only when layer 1 has been bypassed.
//
// The same kind of "it showed up anyway" handling as ReVanced's
// AdsFilter.closeFullscreenAd(), which sends a back-key press to dismiss a
// fullscreen ad. Kept for cases response pruning cannot reach, such as ads
// stitched into the stream server-side.

import { SKIP_BUTTONS } from '../shared/selectors.ts'

let adPlayer: HTMLElement | null = null
/** Ensures we seek at most once per ad. */
let handledCurrentAd = false
/** Only unmute if we were the ones who muted — never undo the user's own choice. */
let mutedByUs = false

function findVideo(player: HTMLElement): HTMLVideoElement | null {
  return player.querySelector<HTMLVideoElement>('video.html5-main-video, video')
}

function skipAd(player: HTMLElement): number {
  // 1) A skip button, when present, is the safest route.
  for (const selector of SKIP_BUTTONS) {
    const button = player.querySelector<HTMLElement>(selector)
    if (button && button.getClientRects().length > 0) {
      button.click()
      return 1
    }
  }

  // 2) Unskippable ad — mute it and seek to the end.
  if (handledCurrentAd) return 0
  const video = findVideo(player)
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return 0

  handledCurrentAd = true
  if (!video.muted) {
    video.muted = true
    mutedByUs = true
  }
  try {
    video.currentTime = video.duration
    return 1
  } catch {
    handledCurrentAd = false
    return 0
  }
}

function restoreAfterAd(player: HTMLElement) {
  handledCurrentAd = false
  if (!mutedByUs) return
  mutedByUs = false
  const video = findVideo(player)
  if (video) video.muted = false
}

/**
 * Check the current ad state and act if needed, returning how many actions
 * were taken. The ISOLATED-side MutationObserver calls this whenever the DOM moves.
 */
export function handleAdState(): number {
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (player !== adPlayer) {
    adPlayer = player
    handledCurrentAd = false
    mutedByUs = false
  }
  if (!player) return 0

  if (!player.classList.contains('ad-showing')) {
    restoreAfterAd(player)
    return 0
  }
  return skipAd(player)
}
