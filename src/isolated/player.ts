// Layer 3 — the fallback. Fires only when layer 1 has been bypassed.
//
// The same kind of "it showed up anyway" handling as ReVanced's
// AdsFilter.closeFullscreenAd(), which sends a back-key press to dismiss a
// fullscreen ad. Kept for cases response pruning cannot reach, such as ads
// stitched into the stream server-side.

import { AD_STATE_MARKERS, SKIP_BUTTONS, SKIP_LABELS } from '../shared/selectors.ts'
import { log } from '../shared/log.ts'

let adPlayer: HTMLElement | null = null
/** Seek attempts spent on the ad currently showing. */
let seeks = 0
/** Only unmute if we were the ones who muted — never undo the user's own choice. */
let mutedByUs = false
/** The rate to put back, when we were the ones who raised it. */
let rateBeforeAd = 0
/** When this ad first appeared, so the log can say how long the black screen was. */
let adSince = 0

/**
 * How many times to seek at one ad.
 *
 * One was not enough. A seek to the end of an ad can be refused or undone — the
 * stream is still loading, or the player puts the position back — and with a
 * single attempt the ad then plays out in full behind a muted, black screen.
 * More than a handful would be a fight with the player rather than a fallback.
 */
const MAX_SEEKS = 8

/** Fast enough to be over in a moment, low enough that WebKit keeps decoding. */
const AD_RATE = 16

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
  // 1) A skip button, when present, is the safest route and the quickest.
  const button = findSkipButton(player)
  if (button) {
    button.click()
    log(`3계층: 건너뛰기 클릭 (${Date.now() - adSince}ms)`)
    return 1
  }

  // 2) Unskippable ad — mute it, run it at speed, and put it at its end.
  const video = findVideo(player)
  if (!video) return 0

  if (!video.muted) {
    video.muted = true
    mutedByUs = true
  }

  // The rate is the half that always applies. Seeking needs a duration, which an
  // ad that has not loaded yet does not have, and those first seconds are
  // exactly the black screen being complained about — at 16x they are a blink.
  if (video.playbackRate !== AD_RATE) {
    rateBeforeAd = video.playbackRate || 1
    try {
      video.playbackRate = AD_RATE
    } catch {
      rateBeforeAd = 0
    }
  }

  if (!Number.isFinite(video.duration) || video.duration <= 0) return 0
  // Already at the end and waiting for the player to notice — leave it alone.
  if (video.duration - video.currentTime < 0.4) return 0
  if (seeks >= MAX_SEEKS) return 0

  seeks += 1
  try {
    // Not `duration` exactly: some builds treat a seek to the very end as a
    // no-op and the ad simply carries on.
    video.currentTime = Math.max(0, video.duration - 0.05)
    log(`3계층: 끝으로 감기 ${seeks}회 (${Math.round(video.duration)}초짜리)`)
    return 1
  } catch {
    return 0
  }
}

function restoreAfterAd(player: HTMLElement) {
  if (adSince !== 0) {
    log(`3계층: 광고 끝 (${Date.now() - adSince}ms, 감기 ${seeks}회)`)
    adSince = 0
  }
  seeks = 0
  const video = findVideo(player)
  if (rateBeforeAd !== 0) {
    if (video) {
      try {
        video.playbackRate = rateBeforeAd
      } catch {
        // The player will set its own rate soon enough.
      }
    }
    rateBeforeAd = 0
  }
  if (!mutedByUs) return
  mutedByUs = false
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
    seeks = 0
    mutedByUs = false
    rateBeforeAd = 0
    adSince = 0
  }
  if (!player) return 0

  if (!adShowing(player)) {
    restoreAfterAd(player)
    return 0
  }
  if (adSince === 0) {
    adSince = Date.now()
    log('3계층: 광고 감지')
  }
  return skipAd(player)
}
