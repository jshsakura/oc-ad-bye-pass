// Sponsor segments, from SponsorBlock's public API.
//
// Nothing here detects anything. A sponsor read looks exactly like the rest of
// the video to a machine — no ad markup, no response field, no player state —
// so the only way to know where one is, is that a person watched it and said
// so. This reads their answers; it does not add to them.
//
// **The video being watched is never sent.** The id is hashed and only the
// first four characters go out; the server answers with every video whose hash
// starts that way and the right one is picked out here. One prefix currently
// covers about forty videos, so what leaves the browser is "one of these forty",
// which is not a viewing history. The scheme is SponsorBlock's own and the
// reason their API is safe to use at all.
//
// This is somebody else's server, run for free by one person. Every failure
// path here is silent: no toast, no retry storm, no console noise. A video
// where this does nothing must be indistinguishable from a video with no
// sponsor in it.

/** Where the segments come from. Not configurable — there is one such server. */
const API = 'https://sponsor.ajay.app/api/skipSegments'

/**
 * Every category the API can be asked to skip, in the order the settings page
 * lists them: the paid one first, then the creator's own material, then the
 * two that only make sense on particular kinds of video.
 *
 * `exclusive_access`, `poi_highlight` and `chapter` are deliberately absent —
 * upstream marks them `full`, `poi` and `chapter`, which are labels and jump
 * points rather than segments to skip past.
 *
 * Which of these are actually used is the viewer's choice. Only `sponsor` is on
 * by default, because only `sponsor` is an advert; the rest is the creator's own
 * work, and deciding for someone that their intro is not worth watching is an
 * opinion about a video rather than an ad blocked. It is theirs to hold, not
 * ours to apply by default.
 */
export const SKIP_CATEGORIES = [
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'filler',
  'music_offtopic',
] as const

export type SkipCategory = (typeof SKIP_CATEGORIES)[number]

/** On by default. The only one of the nine that is a paid advert. */
export const DEFAULT_CATEGORIES: SkipCategory[] = ['sponsor']

/** Drop anything that is not a category we ship, and dedupe. */
export function usableCategories(values: readonly unknown[]): SkipCategory[] {
  const known = new Set<string>(SKIP_CATEGORIES)
  const out = new Set<SkipCategory>()
  for (const value of values) {
    if (typeof value === 'string' && known.has(value)) out.add(value as SkipCategory)
  }
  // Kept in the declared order rather than the stored one, so the request and
  // the settings page agree however the value was written.
  return SKIP_CATEGORIES.filter((c) => out.has(c))
}

/** A skip, in seconds from the start of the video. */
export interface SponsorSegment {
  start: number
  end: number
}

/** One row as the API returns it. Everything is optional until checked. */
interface ApiSegment {
  category?: unknown
  actionType?: unknown
  segment?: unknown
  votes?: unknown
}

interface ApiVideo {
  videoID?: unknown
  segments?: unknown
}

/** How many characters of the hash to send. SponsorBlock's own minimum. */
export const PREFIX_LENGTH = 4

/**
 * SHA-256 of the video id, hex, first `PREFIX_LENGTH` characters.
 *
 * Returns null where WebCrypto is unavailable, which is a reason not to ask at
 * all rather than a reason to send the id in the clear.
 */
export async function hashPrefix(videoId: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(videoId)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return hex.slice(0, PREFIX_LENGTH)
  } catch {
    return null
  }
}

/**
 * Merge segments that touch or overlap.
 *
 * Several people submit the same sponsor with slightly different edges, and the
 * server hands back what it has — and with more than one category chosen, a
 * sponsor and a self-promotion often run straight into each other. Seeking to
 * the end of the first one can land
 * inside the second, which then seeks again — a stutter where the viewer
 * expected one jump. Merging first makes it one.
 *
 * Pure, and exported because the ordering rules are the whole of the risk here.
 */
export function mergeSegments(segments: SponsorSegment[]): SponsorSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const out: SponsorSegment[] = []
  for (const segment of sorted) {
    const last = out[out.length - 1]
    if (last && segment.start <= last.end) last.end = Math.max(last.end, segment.end)
    else out.push({ ...segment })
  }
  return out
}

/**
 * The segments for one video, out of a response covering many.
 *
 * The response is everything sharing a hash prefix, so the first thing to do is
 * throw away the other thirty-nine videos. Then: this category only, skips only
 * (the API also carries mute and chapter actions), and nothing the crowd has
 * voted down — `votes < 0` is the signal that a submission is wrong, and acting
 * on one is worse than doing nothing.
 */
export function pickSegments(
  payload: unknown,
  videoId: string,
  categories: readonly string[] = DEFAULT_CATEGORIES,
): SponsorSegment[] {
  const wanted = new Set(categories)
  if (!Array.isArray(payload)) return []
  const video = (payload as ApiVideo[]).find((v) => v?.videoID === videoId)
  const rows = Array.isArray(video?.segments) ? (video.segments as ApiSegment[]) : []

  const usable: SponsorSegment[] = []
  for (const row of rows) {
    if (typeof row?.category !== 'string' || !wanted.has(row.category)) continue
    if (row.actionType !== undefined && row.actionType !== 'skip') continue
    if (typeof row.votes === 'number' && row.votes < 0) continue
    const pair = row.segment
    if (!Array.isArray(pair) || pair.length < 2) continue
    const [start, end] = pair as unknown[]
    if (typeof start !== 'number' || typeof end !== 'number') continue
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    // A zero-length or backwards segment is a bad submission, not a skip.
    if (end <= start || start < 0) continue
    usable.push({ start, end })
  }
  return mergeSegments(usable)
}

/**
 * The segment `time` is inside, or null.
 *
 * `start - lead` rather than `start`: a seek takes a moment to land and the
 * player reports time in coarse steps, so waiting for the exact boundary means
 * the first fraction of a second of the sponsor is heard. Leading by a little
 * is inaudible; being late is the thing people notice.
 *
 * The end is exclusive so that a seek to `end` does not immediately match the
 * same segment again and loop.
 */
export function segmentAt(
  segments: readonly SponsorSegment[],
  time: number,
  lead = 0.3,
): SponsorSegment | null {
  for (const segment of segments) {
    if (time >= segment.start - lead && time < segment.end) return segment
  }
  return null
}

/**
 * Ask the server. Returns an empty list for every failure, including refusal.
 *
 * There is no retry and no error surfaced anywhere. This is a free service run
 * by one person as a favour to everybody, and an extension that hammers it when
 * it is down, or that shows the user an error about somebody else's server, is
 * a bad guest. A silent empty list is the correct answer to "the segments could
 * not be had": the video simply plays.
 */
export async function fetchSponsorSegments(
  videoId: string,
  categories: readonly string[] = DEFAULT_CATEGORIES,
): Promise<SponsorSegment[]> {
  try {
    if (!categories.length) return []
    const prefix = await hashPrefix(videoId)
    if (!prefix) return []
    // Asked for by name so the server sends only what will be used. The
    // response is filtered again here, because what the server sends is its
    // decision and what gets skipped has to be ours.
    const url = `${API}/${prefix}?categories=${encodeURIComponent(JSON.stringify(categories))}`
    const response = await fetch(url)
    // 404 is the ordinary answer for "nobody has submitted anything here".
    if (!response.ok) return []
    return pickSegments(await response.json(), videoId, categories)
  } catch {
    return []
  }
}
