// Picks subtitles in the browser's language once per video: the matching track
// when the video has one, auto-translation into that language when it only has
// something else, nothing when it has no captions at all.
//
// The target is the browser locale (navigator.languages), not the extension's
// UI language: the UI speaks only ko/en, while captions should follow whatever
// the user actually browses in.
//
// MAIN world only. The caption API hangs off the player element
// (getOption / setOption / loadModule), which page scripts alone can call.
// ISOLATED flips this on and off through the config message.
//
// Timing is most of this file. Three things arrive late and in no fixed order:
// the player element, its caption module (whose track list reads empty until
// loaded), and the translation-language list. And the player restores the
// user's own saved caption state around playback start, which would overwrite
// anything applied earlier — so nothing is applied until the video is actually
// playing. Every state is reported through a documentElement attribute so the
// 진단 panel can say how far it got on a device we cannot see.
//
// "Once per video" is the contract: after one attempt, applied or not, the
// player is left alone for that video, so a caption choice the user makes by
// hand is never fought.

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
  /** 1 = playing. Absent on some builds; the gate is skipped there. */
  getPlayerState?: () => number
}

export type CaptionSelection = CaptionTrack & {
  translationLanguage?: TranslationLanguage
}

const matches = (code: string | undefined, lang: string) =>
  !!code && code.toLowerCase().startsWith(lang.toLowerCase())

/**
 * What to hand `setOption('captions', 'track', …)` for these tracks, or null
 * when none of the languages is reachable. Pure, so the tests can enumerate
 * the cases without a player.
 *
 * `langs` is the preference order: a direct track in an earlier language beats
 * one in a later language, and the translation target is always the first.
 */
export function chooseCaptionSelection(
  tracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[],
  langs: string[],
): CaptionSelection | null {
  for (const lang of langs) {
    const direct = tracks.find((t) => matches(t.languageCode, lang))
    if (direct?.languageCode) return { ...direct }
  }

  // The full row, not a hand-built {languageCode}: the player composes the
  // menu label ("영어 >> 한국어") from its languageName.
  const target = langs[0]
  const translation = target
    ? translationLanguages.find((l) => matches(l.languageCode, target))
    : undefined
  if (!translation) return null

  // An English base when there is one, since auto-translation reads best from
  // it. Otherwise whatever the video carries.
  const base =
    tracks.find((t) => t.languageCode?.toLowerCase().startsWith('en')) ?? tracks[0]
  if (!base?.languageCode) return null
  return { ...base, translationLanguage: { ...translation } }
}

/** Primary subtags of the browser's language list, deduped: ko-KR → ko. */
function browserLangs(): string[] {
  const raw = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en']
  return [...new Set(raw.map((l) => l.split('-')[0].toLowerCase()).filter(Boolean))]
}

/**
 * How many one-second looks a video gets in each waiting state (player API,
 * track list, translation list) before the verdict is written and the video
 * is left alone.
 */
const MAX_TRIES = 20

let enabled = false
let timer: ReturnType<typeof setInterval> | null = null
let currentVideo: string | null = null
let appliedFor: string | null = null
let moduleLoadedFor: string | null = null
let tries = 0

function report(outcome: string): void {
  document.documentElement.setAttribute(CAPTIONS_ATTR, outcome)
}

function videoId(player: CaptionPlayer | null): string | null {
  try {
    const id = player?.getVideoData?.()?.video_id
    if (id) return id
  } catch {
    // Some player builds throw before the data is ready; the URL still answers.
  }
  return new URLSearchParams(location.search).get('v')
}

function tick(): void {
  if (!enabled) return
  const player = document.getElementById('movie_player') as CaptionPlayer | null

  const id = videoId(player)
  if (!id || id === appliedFor) return

  if (currentVideo !== id) {
    currentVideo = id
    moduleLoadedFor = null
    tries = 0
    // From here the 진단 line can already distinguish "the toggle never
    // reached the page" (no attribute at all) from "it is running".
    report('watching')
  }

  // No player API, no feature — the answer the phone build has to give us.
  if (!player || typeof player.getOption !== 'function') {
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('api-missing')
    }
    return
  }

  // The player restores the user's own saved caption state around playback
  // start; applying before that is applying into a state about to be replaced.
  // Waiting costs nothing and consumes no tries — a paused video just waits.
  const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : 1
  if (state !== 1) return

  // Turning captions on is loadModule's job; setOption alone picks a track the
  // display may never show when CC is off. It also makes the track list appear
  // on videos where the module has not loaded yet. Idempotent, once per video.
  if (moduleLoadedFor !== id) {
    moduleLoadedFor = id
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
    browserLangs(),
  )

  if (!selection) {
    // The translation list loads after the track list on real pages, so "no
    // match yet" and "no match" only separate when the budget runs out.
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('no-match')
    }
    return
  }

  appliedFor = id // one attempt per video, applied or not; never fight the user
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
