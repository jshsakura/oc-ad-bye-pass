// Skipping sponsor reads — ISOLATED world.
//
// The seek itself is one line. Everything else here is about when, and about
// not fighting the person watching.
//
// The rules it keeps:
//   * one lookup per video, cached, and never while the toggle is off
//   * nothing at all until playback has started, so a paused video is left alone
//   * never seek backwards, and never seek past the end
//   * if the viewer seeks back into a segment we already skipped, that is them
//     saying they wanted to see it — that segment is not skipped again
//
// The last one matters most. Everything else is a preference; that one is the
// difference between a feature and something that takes the video away from you.

import { fetchSponsorSegments, segmentAt, type SponsorSegment } from '../shared/sponsorblock.ts'
import { log } from '../shared/log.ts'

/** How often to look. Cheap: a property read and a walk over a handful of pairs. */
const TICK_MS = 500

let enabled = false
let timer: ReturnType<typeof setInterval> | null = null

let loadedFor: string | null = null
let segments: SponsorSegment[] = []
/** Segments the viewer has seeked back into. Never skipped again this video. */
let refused = new Set<number>()
/** Where our own last seek landed, so the jump it causes is not read as theirs. */
let seekedTo = -1

function videoId(): string | null {
  try {
    return new URLSearchParams(location.search).get('v')
  } catch {
    return null
  }
}

function player(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video.html5-main-video, video')
}

function forget(): void {
  loadedFor = null
  segments = []
  refused = new Set()
  seekedTo = -1
}

function tick(): void {
  if (!enabled) return
  const id = videoId()
  if (!id) return

  if (id !== loadedFor) {
    // Claim the video before the request finishes, so a slow answer does not
    // start a second one on every tick.
    loadedFor = id
    segments = []
    refused = new Set()
    seekedTo = -1
    void fetchSponsorSegments(id).then((found) => {
      // The viewer may have moved on while we waited.
      if (loadedFor !== id) return
      segments = found
      if (found.length) log(`스폰서: 구간 ${found.length}개`)
    })
    return
  }

  if (!segments.length) return
  const video = player()
  if (!video || video.paused) return

  const now = video.currentTime
  if (!Number.isFinite(now)) return

  const segment = segmentAt(segments, now)
  if (!segment) return

  /*
   * Did the viewer put themselves here?
   *
   * After our own seek the time is at the segment's end, outside it. So being
   * back inside a segment we have already jumped means somebody dragged the
   * scrubber into it — which is a person asking to watch this part. Skipping it
   * again would take the video away from them, twice, and there would be no way
   * to get it back short of turning the feature off.
   */
  if (refused.has(segment.start)) return
  if (seekedTo >= 0 && now < seekedTo - 1) {
    refused.add(segment.start)
    log('스폰서: 되감아서 들어옴 — 이 구간은 두지 않음')
    return
  }

  // Never past the end: a seek to duration ends the video, and on some builds
  // starts the next one. A sponsor at the very end is better left playing.
  const duration = video.duration
  if (Number.isFinite(duration) && duration > 0 && segment.end >= duration - 0.5) return
  if (segment.end <= now) return

  try {
    video.currentTime = segment.end
    seekedTo = segment.end
    refused.add(segment.start)
    log(`스폰서: ${Math.round(segment.end - segment.start)}초 건너뜀`)
  } catch {
    // A player that refuses the seek is a player we leave alone.
  }
}

/** Config-driven switch. Safe to call repeatedly. */
export function setSponsorSkip(on: boolean): void {
  if (on === enabled) return
  enabled = on
  if (on) {
    if (timer === null) timer = setInterval(tick, TICK_MS)
  } else {
    if (timer !== null) clearInterval(timer)
    timer = null
    forget()
  }
}
