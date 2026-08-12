// A recording of the part nobody can watch — ISOLATED world.
//
// Everything about this feature happens while the phone is showing something
// else, and the log used to hold the moment of leaving, the moment of coming
// back, and nothing in between. The five seconds where the window dies were
// reconstructed from their edges, one release at a time.
//
// **Not on a timer.** The first version of this ticked once a second and wrote
// nothing at all on the device, which is itself the finding: iOS throttles a
// backgrounded page's timers, and a one-second interval is among the first things
// to stop. Events are not throttled the same way — the previous logs have mode
// changes arriving five seconds into a departure, so the page is running; it is
// only its clocks that are not.
//
// So this listens to the video instead. `timeupdate` fires as the media pipeline
// advances, several times a second, for as long as there is playback at all — and
// when it stops, that is the thing worth knowing rather than a hole in the record.
// Everything else here is a state change worth a line on its own.

import { log } from '../shared/log.ts'

interface WebkitVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
}

/** How often the position line is written while playback advances. */
const HEARTBEAT_MS = 1000

/** How long a departure is studied for. Past this it is not what is being asked. */
const RECORD_MS = 25_000

/** Each says something different about how a departure ends. */
const MOMENTS = ['pause', 'play', 'playing', 'waiting', 'stalled', 'ended', 'emptied'] as const

let subject: WebkitVideo | null = null
let startedAt = 0
let lastBeat = 0
let attached: (() => void) | null = null

function elapsed(): string {
  return `+${Math.round((Date.now() - startedAt) / 100) / 10}s`
}

function state(video: WebkitVideo): string {
  return (
    `모드=${video.webkitPresentationMode ?? '?'} 재생=${!video.paused} ` +
    `시간=${video.currentTime.toFixed(1)} readyState=${video.readyState} 숨김=${document.hidden}`
  )
}

function onTimeUpdate(): void {
  const video = subject
  if (!video) return
  const now = Date.now()
  if (now - startedAt > RECORD_MS) return stop('그만 볼 시간')
  if (now - lastBeat < HEARTBEAT_MS) return
  lastBeat = now
  log(`나가있음 ${elapsed()} ${state(video)}`)
}

function onMoment(event: Event): void {
  const video = subject
  if (!video) return
  if (Date.now() - startedAt > RECORD_MS) return stop('그만 볼 시간')
  // Not rate-limited: these are the lines that say how it ended.
  log(`나가있음 ${elapsed()} ${event.type} — ${state(video)}`)
}

/** Begin recording. Called from the departure, on the same tick as everything else. */
export function startAwayRecord(video: WebkitVideo): void {
  stop()
  subject = video
  startedAt = Date.now()
  lastBeat = 0

  video.addEventListener('timeupdate', onTimeUpdate)
  for (const type of MOMENTS) video.addEventListener(type, onMoment)
  attached = () => {
    video.removeEventListener('timeupdate', onTimeUpdate)
    for (const type of MOMENTS) video.removeEventListener(type, onMoment)
  }

  log(`나가있음 시작 — ${state(video)}`)
}

export function stop(why?: string): void {
  if (attached) {
    attached()
    if (why && subject) log(`나가있음 ${elapsed()} 기록 끝 (${why})`)
  }
  attached = null
  subject = null
}
