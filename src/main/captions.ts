// Picks Korean subtitles once per video: the Korean track when the video has
// one, auto-translation into Korean when it only has something else, nothing
// when it has no captions at all.
//
// MAIN world only — the caption API hangs off the player element
// (getOption / setOption / loadModule), which page scripts alone can call.
// ISOLATED flips this on and off through the config message like every other
// toggle.
//
// "Once per video" is the contract: after one attempt — applied or not — the
// player is left alone for that video, so a caption choice the user makes by
// hand is never fought. Re-asserting on a timer is exactly the mistake the
// media-session work taught us to avoid.

import { CAPTIONS_ATTR } from '../shared/messages.ts'

interface CaptionTrack {
  languageCode?: string
}

interface TranslationLanguage {
  languageCode?: string
}

interface CaptionPlayer extends Element {
  getOption?: (module: string, option: string) => unknown
  setOption?: (module: string, option: string, value: unknown) => void
  loadModule?: (module: string) => void
  getVideoData?: () => { video_id?: string } | null
}

export interface CaptionSelection {
  languageCode: string
  translationLanguage?: { languageCode: string }
}

/**
 * What to hand `setOption('captions', 'track', …)` for these tracks, or null
 * when Korean is unreachable. Pure, so the tests can enumerate the cases
 * without a player.
 */
export function chooseCaptionSelection(
  tracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[],
): CaptionSelection | null {
  const isKo = (code?: string) => !!code && code.toLowerCase().startsWith('ko')

  const korean = tracks.find((t) => isKo(t.languageCode))
  if (korean?.languageCode) return { languageCode: korean.languageCode }

  if (!translationLanguages.some((l) => isKo(l.languageCode))) return null

  // An English base when there is one — auto-translation reads best from it —
  // otherwise whatever the video carries.
  const base =
    tracks.find((t) => t.languageCode?.toLowerCase().startsWith('en')) ?? tracks[0]
  if (!base?.languageCode) return null
  return { languageCode: base.languageCode, translationLanguage: { languageCode: 'ko' } }
}

/**
 * The caption list often stays empty until the module is loaded, and loading is
 * asynchronous — so a video gets this many one-second looks before it is
 * declared captionless and left alone.
 */
const MAX_TRIES = 20

let timer: ReturnType<typeof setInterval> | null = null
let appliedFor: string | null = null
let moduleLoadedFor: string | null = null
let tries = 0

function report(outcome: string): void {
  document.documentElement.setAttribute(CAPTIONS_ATTR, outcome)
}

function videoId(player: CaptionPlayer): string | null {
  try {
    const id = player.getVideoData?.()?.video_id
    if (id) return id
  } catch {
    // Some player builds throw before the data is ready; the URL still answers.
  }
  return new URLSearchParams(location.search).get('v')
}

function tick(): void {
  const player = document.getElementById('movie_player') as CaptionPlayer | null
  if (!player || typeof player.getOption !== 'function') return

  const id = videoId(player)
  if (!id || id === appliedFor) return

  let tracks: unknown
  try {
    tracks = player.getOption('captions', 'tracklist')
  } catch {
    return // module not ready yet — next look
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    // Until the captions module loads the list reads empty even on videos that
    // have subtitles. Ask for the module once per video, then keep looking.
    if (moduleLoadedFor !== id) {
      moduleLoadedFor = id
      tries = 0
      try {
        player.loadModule?.('captions')
      } catch {
        // Not all player builds expose it; the tries budget still ends this.
      }
    }
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('no-captions')
    }
    return
  }

  let translatable: unknown
  try {
    translatable = player.getOption('captions', 'translationLanguages')
  } catch {
    translatable = []
  }

  const selection = chooseCaptionSelection(
    tracks as CaptionTrack[],
    Array.isArray(translatable) ? (translatable as TranslationLanguage[]) : [],
  )

  appliedFor = id
  if (!selection) {
    report('no-korean')
    return
  }
  try {
    player.setOption?.('captions', 'track', selection)
    report(selection.translationLanguage ? 'translated' : 'korean')
  } catch {
    report('set-failed')
  }
}

/** Config-driven switch. Turning it off leaves the current video as it is. */
export function setCaptionPreference(enabled: boolean): void {
  if (enabled) {
    if (timer === null) timer = setInterval(tick, 1000)
  } else if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
