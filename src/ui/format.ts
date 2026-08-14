import type { Lang, TFn } from '../shared/i18n.ts'

export function formatCount(n: number, lang: Lang = 'ko'): string {
  return n.toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US')
}

export function formatWhen(ts: number | null, t: TFn): string {
  if (!ts) return t('time.never')
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.min', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hour', { n: hours })
  return t('time.day', { n: Math.floor(hours / 24) })
}

const YOUTUBE_URL = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com)(\/|$)/i

export function isYouTubeUrl(url: string | undefined): boolean {
  return !!url && YOUTUBE_URL.test(url)
}
