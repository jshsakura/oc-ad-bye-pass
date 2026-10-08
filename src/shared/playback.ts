/** A snapshot, not a verdict about whether the browser allowed autoplay. */
export interface PlaybackFacts {
  paused: boolean
  ended: boolean
  readyState: number
  networkState: number
  currentTime: number
  muted: boolean
  error: number | null
}

/** A watch page can also have a preview or an old video during SPA navigation. */
export function findPlaybackVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#movie_player video')
    ?? document.querySelector<HTMLVideoElement>('.html5-video-player video')
    ?? document.querySelector<HTMLVideoElement>('video.html5-main-video')
    ?? document.querySelector<HTMLVideoElement>('video')
}

export function playbackFacts(video: HTMLVideoElement): PlaybackFacts {
  return {
    paused: video.paused,
    ended: video.ended,
    readyState: video.readyState,
    networkState: video.networkState,
    currentTime: video.currentTime,
    muted: video.muted,
    error: video.error?.code ?? null,
  }
}

export function playbackEvidence(facts: PlaybackFacts): string {
  const state = facts.error ? '미디어 오류' : facts.ended ? '종료' : facts.paused ? '일시정지' : facts.readyState < 3 ? '데이터 대기' : '재생 중'
  return `${state} · 위치 ${facts.currentTime.toFixed(1)}초 · 준비 ${facts.readyState}/4 · 네트워크 ${facts.networkState}/3 · 음소거 ${facts.muted ? '예' : '아니오'} · 오류 ${facts.error ?? '없음'}`
}
