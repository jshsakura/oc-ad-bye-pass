// Layer 3 — the fallback. Fires only when layer 1 has been bypassed.
//
// The same kind of "it showed up anyway" handling as ReVanced's
// AdsFilter.closeFullscreenAd(), which sends a back-key press to dismiss a
// fullscreen ad. Kept for cases response pruning cannot reach, such as ads
// stitched into the stream server-side.

import { AD_STATE_MARKERS, SKIP_BUTTONS, SKIP_LABELS } from '../shared/selectors.ts'

let adPlayer: HTMLElement | null = null
/** Ensures we seek at most once per ad. */
let handledCurrentAd = false
/** Only unmute if we were the ones who muted — never undo the user's own choice. */
let mutedByUs = false

function findVideo(player: HTMLElement): HTMLVideoElement | null {
  return player.querySelector<HTMLVideoElement>('video.html5-main-video, video')
}

/** Visible, and actually on the page. */
function clickable(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.getClientRects().length > 0
}

/**
 * The skip button, by name where we know it and by shape where we do not.
 *
 * The named selectors are the desktop player's. Mobile web renames them, moves
 * them between experiments, and does both again next month — so after the names
 * comes the text, which is what a person actually reads before pressing it.
 */
function findSkipButton(player: HTMLElement): HTMLElement | null {
  for (const selector of SKIP_BUTTONS) {
    const button = player.querySelector<HTMLElement>(selector)
    if (clickable(button)) return button
  }

  for (const element of player.querySelectorAll<HTMLElement>('button, [role="button"], a')) {
    if (!clickable(element)) continue
    const text = (element.textContent ?? '').trim().toLowerCase()
    if (!text || text.length > 20) continue
    if (SKIP_LABELS.some((label) => text.includes(label))) return element
  }
  return null
}

function skipAd(player: HTMLElement): number {
  // 1) A skip button, when present, is the safest route.
  const button = findSkipButton(player)
  if (button) {
    button.click()
    return 1
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
/** Whether an ad is on screen right now. */
function adShowing(player: HTMLElement): boolean {
  if (player.classList.contains('ad-showing')) return true
  return AD_STATE_MARKERS.some((selector) => clickable(player.querySelector(selector)))
}

export function handleAdState(): number {
  // #movie_player is the desktop id and mobile web's as well, but not on every
  // surface — Shorts and the embedded player use the class instead.
  const player =
    document.querySelector<HTMLElement>('#movie_player') ??
    document.querySelector<HTMLElement>('.html5-video-player')
  if (player !== adPlayer) {
    adPlayer = player
    handledCurrentAd = false
    mutedByUs = false
  }
  if (!player) return 0

  if (!adShowing(player)) {
    restoreAfterAd(player)
    return 0
  }
  return skipAd(player)
}
