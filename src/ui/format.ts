export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR')
}

export function formatWhen(ts: number | null): string {
  if (!ts) return '아직 없음'
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

const YOUTUBE_URL = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com)(\/|$)/i

export function isYouTubeUrl(url: string | undefined): boolean {
  return !!url && YOUTUBE_URL.test(url)
}
