// Pins the audio track to one language, once per video.
//
// This is the dubbing track, not the captions: YouTube ships many videos with
// several audio tracks and picks one from the account's own settings, the
// browser locale and whatever it decides the viewer wants. For a child watching
// on someone else's account that guess is wrong often, and the fix is a menu
// three levels deep that has to be repeated on every video.
//
// So it is one switch, and the language it pins to is the browser's own — the
// same language the caption picker follows, from the same helper, because a
// video that came back dubbed in one language and subtitled in another would be
// worse than either feature being off. No language picker: a setting nobody has
// a reason to open is a setting that will hold a wrong value for years, and the
// device a child watches on is already in the language they speak.
//
// MAIN world only — the audio API hangs off the player element and page scripts
// alone can call it. ISOLATED flips it on and off through the config message.
//
// The timing rules are the caption picker's, for the same reasons: the player
// arrives late, its track list fills later still, and it restores its own saved
// state around playback start. See src/main/captions.ts, which this deliberately
// mirrors rather than abstracts — the two features share a shape but not a
// single line of behaviour, and merging them would mean a change to one is a
// change to both.
//
// **Once per video, applied or not.** A viewer who switches the track by hand
// is never fought.

import { AUDIO_ATTR } from '../shared/messages.ts'
import { viewerLangs } from './viewerLangs.ts'

/**
 * A row of `getAvailableAudioTracks()`.
 *
 * The whole object is passed back to `setAudioTrack`: a hand-built stand-in is
 * not the object the player is holding, and the player compares identity as
 * well as contents. Same lesson as the caption tracklist rows.
 */
export interface AudioTrack {
  id?: string
  languageInfo?: { id?: string; name?: string }
  displayName?: string
  isDefault?: boolean
  [key: string]: unknown
}

/**
 * A track's language, from whichever field this player build carries it in.
 *
 * `languageInfo.id` is the direct answer. When it is missing the id itself
 * still holds one: it looks like `251;bGFuZz1rbw%3D%3D`, whose tail is base64
 * for `lang=ko`. Reading it is worth the few lines — a track we cannot name is
 * a track we cannot pick, and the id is present on every build seen so far.
 */
export function audioLangOf(track: AudioTrack): string | null {
  const direct = track.languageInfo?.id
  if (typeof direct === 'string' && direct) return direct.split('-')[0].toLowerCase()

  const id = track.id
  if (typeof id !== 'string') return null
  const tail = id.split(';')[1]
  if (!tail) return null
  try {
    const decoded = atob(decodeURIComponent(tail))
    const match = /(?:^|[&;])lang=([A-Za-z]{2,3})/.exec(decoded)
    return match ? match[1].toLowerCase() : null
  } catch {
    // Not base64, or no atob here. The track simply goes unnamed.
    return null
  }
}

/**
 * Audio description — a separate narration track for blind viewers, offered in
 * the same list as the ordinary dubs.
 *
 * It has to be excluded explicitly. It is a real track in the target language,
 * so a plain language match finds it, and handing a child a running narration
 * of what is on screen is a worse outcome than not switching at all. Matched by
 * label rather than by a flag because no build seen exposes one.
 */
const DESCRIPTIVE = /descriptive|audio description|описание|화면\s*해설|音声解説/i

export function isDescriptive(track: AudioTrack): boolean {
  const label = `${track.displayName ?? ''} ${track.languageInfo?.name ?? ''}`
  return DESCRIPTIVE.test(label)
}

/**
 * Which track to switch to, or null to leave the video alone.
 *
 * Pure, so the cases can be enumerated in a test rather than on a television.
 * `langs` is the preference order; the first language with a track wins.
 *
 * Returns null when the wanted language is not among the tracks — **not** the
 * default track. "Pin the audio to Korean" cannot mean "and when there is no
 * Korean, change it to something else": the player's own choice is already the
 * best available answer at that point.
 */
export function chooseAudioTrack(tracks: AudioTrack[], langs: string[]): AudioTrack | null {
  const usable = tracks.filter((t) => !isDescriptive(t))
  for (const lang of langs) {
    const target = lang.split('-')[0].toLowerCase()
    const matching = usable.filter((t) => audioLangOf(t) === target)
    if (!matching.length) continue
    // The original-language track is marked default; among several in one
    // language it is the one the uploader meant.
    return matching.find((t) => t.isDefault === true) ?? matching[0]
  }
  return null
}

/** Is this track the one already playing? Compared by id, then by language. */
export function isSameTrack(a: AudioTrack | null, b: AudioTrack | null): boolean {
  if (!a || !b) return false
  if (typeof a.id === 'string' && typeof b.id === 'string') return a.id === b.id
  return audioLangOf(a) !== null && audioLangOf(a) === audioLangOf(b)
}

// --- the player side ---------------------------------------------------------

interface AudioPlayer extends Element {
  getAvailableAudioTracks?: () => unknown
  getAudioTrack?: () => unknown
  setAudioTrack?: (track: unknown) => unknown
  getVideoData?: () => { video_id?: string } | null
  getPlayerState?: () => number
}

/** Same budget as the caption picker: twenty one-second looks, then give up. */
const MAX_TRIES = 20

let enabled = false
let timer: ReturnType<typeof setInterval> | null = null
let currentVideo: string | null = null
let appliedFor: string | null = null
let tries = 0

function report(outcome: string): void {
  document.documentElement.setAttribute(AUDIO_ATTR, outcome)
}

function videoId(player: AudioPlayer | null): string | null {
  try {
    const id = player?.getVideoData?.()?.video_id
    if (id) return id
  } catch {
    // Some builds throw before the data is ready; the URL still answers.
  }
  return new URLSearchParams(location.search).get('v')
}

function tick(): void {
  if (!enabled) return
  const langs = viewerLangs()
  const player = document.getElementById('movie_player') as AudioPlayer | null

  const id = videoId(player)
  if (!id || id === appliedFor) return
  if (currentVideo !== id) {
    currentVideo = id
    tries = 0
  }

  // No audio API, no feature. Reported rather than assumed, because this is the
  // one answer only a real device gives — the mobile player is a different
  // build and there is no way to know from here which methods it carries.
  if (!player || typeof player.getAvailableAudioTracks !== 'function') {
    report('watching(no-api)')
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('api-missing')
    }
    return
  }

  // The player restores its own saved state around playback start; applying
  // before that is applying into a state about to be replaced. Paused counts
  // as started — on a phone, opening the popup pauses the video, and gating on
  // "playing" alone meant every diagnostics check found it eternally waiting.
  let state = 1
  try {
    if (typeof player.getPlayerState === 'function') state = player.getPlayerState()
  } catch {
    // Unreadable state: treat as playing rather than wait forever.
  }
  if (state !== 1 && state !== 2) {
    report(`watching(state=${state})`)
    return
  }

  let tracks: unknown
  try {
    tracks = player.getAvailableAudioTracks()
  } catch {
    // A throwing call is a waiting state, not a dead tick. An uncaught throw
    // here would kill every later tick silently.
    report('watching(throws)')
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('api-missing')
    }
    return
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    report('watching(tracks=0)')
    if (++tries >= MAX_TRIES) {
      appliedFor = id
      report('no-tracks')
    }
    return
  }

  // One track is the ordinary case: the video is not dubbed and there is
  // nothing to choose. Concluded immediately rather than waited out.
  if (tracks.length === 1) {
    appliedFor = id
    report('single-track')
    return
  }

  const wanted = chooseAudioTrack(tracks as AudioTrack[], langs)
  if (!wanted) {
    appliedFor = id
    report('no-match')
    return
  }

  let current: AudioTrack | null = null
  try {
    current = (player.getAudioTrack?.() ?? null) as AudioTrack | null
  } catch {
    current = null
  }

  appliedFor = id // one attempt per video, applied or not
  if (isSameTrack(current, wanted)) {
    report(`already(${audioLangOf(wanted) ?? '?'})`)
    return
  }

  try {
    player.setAudioTrack?.(wanted)
    report(`switched(${audioLangOf(wanted) ?? '?'})`)
  } catch {
    report('set-failed')
  }
}

/** Config-driven switch. Turning it off leaves the current video as it is. */
export function setAudioPreference(on: boolean): void {
  enabled = on
  if (on) {
    if (timer === null) timer = setInterval(tick, 1000)
  } else if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
