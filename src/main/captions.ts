// Picks subtitles in the browser's language once per video: the matching track
// when the video has one, auto-translation into that language when it only has
// something else, nothing when it has no captions at all.
//
// The target is the browser locale (navigator.language), not the extension's
// UI language: the UI speaks only ko/en, while captions should follow whatever
// the user actually browses in.
//
// MAIN world only. The caption API hangs off the player element
// (getOption / setOption / loadModule), which page scripts alone can call.
// ISOLATED flips this on and off through the config message.
//
// "Once per video" is the contract: after one attempt, applied or not, the
// player is left alone for that video, so a caption choice the user makes by
// hand is never fought. Re-asserting on a timer is exactly the mistake the
// media-session work taught us to avoid.

import { CAPTIONS_ATTR } from '../shared/messages.ts'

/**
 * A row of getOption('captions', 'tracklist'). Only languageCode is read here,
 * but the whole object is passed back to setOption: a hand-built
 * `{languageCode}` selects a track the player marks `is_servable: false` and
 * never renders, while the player's own object carries whatever else
 * (vss_id, name, …) the display needs.
 */
interface CaptionTrack {
  languageCode?: string
  [key: string]: unknown
}

/** A row of getOption('captions', 'translationLanguages'); carries languageName too. */
interface TranslationLanguage {
  languageCode?: string
  [key: string]: unknown
}

interface CaptionPlayer extends Element {
  getOption?: (module: string, option: string) => unknown
  setOption?: (module: string, option: string, value: unknown) => void
  loadModule?: (module: string) => void
  getVideoData?: () => { video_id?: string } | null
}

export type CaptionSelection = CaptionTrack & {
  translationLanguage?: TranslationLanguage
}

const matches = (code: string | undefined, lang: string) =>
  !!code && code.toLowerCase().startsWith(lang.toLowerCase())

/**
 * What to hand `setOption('captions', 'track', …)` for these tracks, or null
 * when the language is unreachable. Pure, so the tests can enumerate the cases
 * without a player.
 */
export function chooseCaptionSelection(
  tracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[],
  lang: string,
): CaptionSelection | null {
  const direct = tracks.find((t) => matches(t.languageCode, lang))
  if (direct?.languageCode) return { ...direct }

  // The full row, not a hand-built {languageCode}: the player composes the
  // menu label ("영어 >> 한국어") from its languageName.
  const translation = translationLanguages.find((l) => matches(l.languageCode, lang))
  if (!translation) return null

  // An English base when there is one, since auto-translation reads best from
  // it. Otherwise whatever the video carries.
  const base =
    tracks.find((t) => t.languageCode?.toLowerCase().startsWith('en')) ?? tracks[0]
  if (!base?.languageCode) return null
  return { ...base, translationLanguage: { ...translation } }
}

/**
 * The caption list often stays empty until the module is loaded, and loading is
 * asynchronous. A video gets this many one-second looks before it is declared
 * captionless and left alone.
 */
const MAX_TRIES = 20

/** Primary subtag of the browser locale: 'ko-KR' → 'ko'. */
function browserLang(): string {
  return (navigator.language || 'en').split('-')[0].toLowerCase()
}

let enabled = false
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
  if (!enabled) return
  const player = document.getElementById('movie_player') as CaptionPlayer | null
  if (!player || typeof player.getOption !== 'function') return

  const id = videoId(player)
  if (!id || id === appliedFor) return

  // Turning captions on is loadModule's job; setOption alone picks a track the
  // display may never show when CC is off. It also makes the track list appear
  // on videos where the module has not loaded yet. Idempotent, once per video.
  if (moduleLoadedFor !== id) {
    moduleLoadedFor = id
    tries = 0
    try {
      player.loadModule?.('captions')
    } catch {
      // Not all player builds expose it; the tries budget still ends this.
    }
  }

  let tracks: unknown
  try {
    tracks = player.getOption('captions', 'tracklist')
  } catch {
    return // module not ready yet, next look
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
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
    browserLang(),
  )

  appliedFor = id // one attempt per video, applied or not; never fight the user
  if (!selection) {
    report('no-match')
    return
  }
  try {
    player.setOption?.('captions', 'track', selection)
    report(selection.translationLanguage ? 'translated' : 'matched')
  } catch {
    report('set-failed')
  }
}

/** Config-driven switch. Turning it off leaves the current video as it is. */
export function setCaptionPreference(on: boolean): void {
  enabled = on
  if (on) {
    if (timer === null) timer = setInterval(tick, 1000)
  } else if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
