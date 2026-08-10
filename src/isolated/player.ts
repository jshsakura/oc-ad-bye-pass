// 3계층 — 폴백. 1계층이 뚫렸을 때만 발화한다.
//
// ReVanced 에서 AdsFilter.closeFullscreenAd() 가 뒤로가기 키를 보내 전면 광고를 닫는 것과
// 같은 성격의 "그래도 떴을 때" 처리다. 서버에서 스트림에 광고를 이어붙이는 경우처럼
// 응답 프루닝으로 막을 수 없는 상황을 위해 남겨둔다.

import { SKIP_BUTTONS } from '../shared/selectors.ts'

let adPlayer: HTMLElement | null = null
/** 광고 1건당 한 번만 감기 위한 플래그 */
let handledCurrentAd = false
/** 우리가 음소거했을 때만 되돌린다 — 사용자가 끈 음소거를 켜버리면 안 된다 */
let mutedByUs = false

function findVideo(player: HTMLElement): HTMLVideoElement | null {
  return player.querySelector<HTMLVideoElement>('video.html5-main-video, video')
}

function skipAd(player: HTMLElement): number {
  // 1) 스킵 버튼이 있으면 그게 가장 안전하다
  for (const selector of SKIP_BUTTONS) {
    const button = player.querySelector<HTMLElement>(selector)
    if (button && button.getClientRects().length > 0) {
      button.click()
      return 1
    }
  }

  // 2) 건너뛸 수 없는 광고 — 음소거하고 끝으로 감는다
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
 * 현재 광고 상태를 확인하고 필요하면 처리한다. 처리한 횟수를 돌려준다.
 * ISOLATED 쪽 MutationObserver 가 DOM 이 움직일 때마다 불러준다.
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
