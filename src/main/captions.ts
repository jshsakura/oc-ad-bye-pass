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
  /** The player's loaded module names — the tell for "did loadModule take". */
  getOptions?: () => unknown
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

/**
 * Caption tracks remembered from the player response JSON, as it flows
 * through the layer-1 hooks (JSON.parse / Response.json / the global setter).
 *
 * This exists for the mobile web player: on m.youtube its captions module
 * loads (getOptions lists it) but `getOption('captions', 'tracklist')` stays
 * empty on videos that demonstrably have tracks — measured on the phone,
 * v0.13.7 diagnostics. The response body has the same track list under
 * captions.playerCaptionsTracklistRenderer, so it is captured in passing and
 * used when the player's own list never fills.
 */
let fromResponse: {
  videoId: string
  tracks: CaptionTrack[]
  translation: TranslationLanguage[]
} | null = null

/** simpleText or the first run — the two shapes YouTube uses for label text. */
function labelText(name: unknown): string {
  const n = name as { simpleText?: unknown; runs?: Array<{ text?: unknown }> } | undefined
  const text = n?.simpleText ?? n?.runs?.[0]?.text
  return typeof text === 'string' ? text : ''
}

/** Remember the track list of any player response passing through the hooks. */
export function captureCaptionData(data: unknown): void {
  const obj = data as {
    videoDetails?: { videoId?: unknown }
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          languageCode?: unknown
          vssId?: unknown
          kind?: unknown
          isTranslatable?: unknown
          name?: unknown
        }>
        translationLanguages?: Array<{ languageCode?: unknown; languageName?: unknown }>
      }
    }
  } | null
  const renderer = obj?.captions?.playerCaptionsTracklistRenderer
  const videoId = obj?.videoDetails?.videoId
  if (!renderer?.captionTracks?.length || typeof videoId !== 'string') return

  // The same shape the player's own tracklist rows carry — setOption gets a
  // row it recognises, not a bare {languageCode} (see CaptionTrack above).
  fromResponse = {
    videoId,
    tracks: renderer.captionTracks.map((t) => ({
      languageCode: typeof t.languageCode === 'string' ? t.languageCode : undefined,
      languageName: labelText(t.name),
      displayName: labelText(t.name),
      kind: typeof t.kind === 'string' ? t.kind : '',
      vss_id: typeof t.vssId === 'string' ? t.vssId : '',
      name: '',
      is_servable: true,
      is_default: false,
      is_translateable: t.isTranslatable === true,
    })),
    translation: (renderer.translationLanguages ?? []).map((l) => ({
      languageCode: typeof l.languageCode === 'string' ? l.languageCode : undefined,
      languageName: labelText(l.languageName),
    })),
  }
}

/**
 * The video's spoken language, from the auto-generated (asr) track: YouTube
 * transcribes in the language actually spoken, so its languageCode is the one
 * signal the player gives away. Null when there is no asr track — an unknown
 * language is treated as foreign, since captions on a video someone could not
 * follow beat no captions on one they could.
 */
export function videoLanguage(tracks: CaptionTrack[]): string | null {
  const asr = tracks.find((t) => t.kind === 'asr')
  const code = asr?.languageCode
  return code ? code.split('-')[0].toLowerCase() : null
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
  }

  // No player API, no feature — the answer the phone build has to give us.
  if (!player || typeof player.getOption !== 'function') {
    report('watching(no-api)')
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('api-missing')
    }
    return
  }

  // The player restores the user's own saved caption state around playback
  // start; applying before that is applying into a state about to be replaced.
  // Waiting costs nothing and consumes no tries — a paused video just waits.
  // Everything on the player element can throw on a not-yet-ready build, and
  // an uncaught throw here kills every later tick silently — the phone spent
  // an afternoon frozen at 대기 중 exactly that way.
  let state = 1
  try {
    if (typeof player.getPlayerState === 'function') state = player.getPlayerState()
  } catch {
    // Unreadable state: treat as playing rather than wait forever.
  }
  // Playing (1) or paused (2) — paused means playback already began, so the
  // player's own restore has run. This matters on the phone, where opening
  // the popup pauses the video: gating on "playing" alone meant every
  // diagnostics check found the picker eternally waiting.
  if (state !== 1 && state !== 2) {
    report(`watching(state=${state})`)
    return
  }

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
    // A throwing caption module is a waiting state too, not a dead tick.
    report('watching(option-throws)')
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('api-missing')
    }
    return
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    // The mobile web player loads its captions module and still leaves the
    // list empty (measured on the phone), so after a few seconds' grace the
    // list remembered from the player response takes over. The grace keeps
    // desktop on its own, richer rows while its module finishes loading.
    if (tries >= 5 && fromResponse?.videoId === id && fromResponse.tracks.length > 0) {
      decideAndApply(player, id, fromResponse.tracks, fromResponse.translation, ':data')
      return
    }
    // Which modules the player actually has loaded — the difference between
    // "captions module never loads on this build" (module absent) and "loaded
    // but the list is empty" (a genuinely captionless video). A phone dump is
    // the only place this answer can come from.
    let mods = '?'
    try {
      const options = player.getOptions?.()
      if (Array.isArray(options)) mods = options.join('+') || 'none'
    } catch {
      mods = 'throws'
    }
    report(`watching(tracks=0,mods=${mods})`)
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report(`no-captions(mods=${mods})`)
    }
    return
  }

  let translatable: unknown
  try {
    translatable = player.getOption('captions', 'translationLanguages')
  } catch {
    translatable = []
  }

  decideAndApply(
    player,
    id,
    tracks as CaptionTrack[],
    Array.isArray(translatable) ? (translatable as TranslationLanguage[]) : [],
    '',
  )
}

/**
 * The shared back half: skip a native-language video, else pick and apply.
 * `via` is ':data' when the rows came from the player response instead of the
 * player itself — a response list is complete, so its no-match is final, and
 * the marker rides along in the outcome so a phone dump says which path ran.
 */
function decideAndApply(
  player: CaptionPlayer,
  id: string,
  tracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[],
  via: '' | ':data',
): void {
  // A video already in the viewer's language needs no captions, and forcing
  // them on would be the extension overriding a person who never asked. Only a
  // foreign-language video is acted on.
  const langs = browserLangs()
  const spoken = videoLanguage(tracks)
  if (spoken && langs.includes(spoken)) {
    appliedFor = id
    report('native-language')
    return
  }

  const selection = chooseCaptionSelection(tracks, translationLanguages, langs)

  if (!selection) {
    // The player's translation list loads after its track list, so that path
    // only concludes when the budget runs out. The response list arrives whole.
    if (via === ':data' || ++tries >= MAX_TRIES) {
      appliedFor = id
      report(`no-match${via}`)
    } else {
      report('watching(no-match-yet)')
    }
    return
  }

  appliedFor = id // one attempt per video, applied or not; never fight the user
  try {
    player.setOption?.('captions', 'track', selection)
    report((selection.translationLanguage ? 'translated' : 'matched') + via)
  } catch {
    report(`set-failed${via}`)
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
