// A recording of the part nobody can watch — ISOLATED world.
//
// Everything about this feature happens while the phone is showing something
// else. Up to now the log held the moment of leaving, the moment of coming back,
// and nothing in between, so the interesting five seconds were reconstructed from
// their edges — which is how the same question was asked across a dozen releases.
//
// This writes a line a second for as long as the page is away. It answers, in one
// departure, questions that were being guessed at one release at a time:
//
//   does the page keep running?     A gap in the ticks is iOS suspending it, and
//                                   an absence of ticks is it never starting.
//   what is the video doing?        Mode, paused, position, readyState — at the
//                                   second the window disappears, not inferred
//                                   from the second before and the second after.
//   who asked for it?               The mode line is written by the sensor; the
//                                   call that caused it is traced separately in
//                                   src/main/deafenPlayer.ts, tagged with which
//                                   world it came from.
//
// Bounded, because it costs a synchronous storage write per tick and because a
// departure that matters is over in seconds. After the cap it stops and says so;
// a return stops it too.

import { log } from '../shared/log.ts'

interface WebkitVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
}

/** One second: fine enough to place a five-second teardown, coarse enough to be cheap. */
const TICK_MS = 1000

/** Twenty seconds of it. Past that the departure is not what is being studied. */
const MAX_TICKS = 20

let timer: ReturnType<typeof setInterval> | null = null
let ticks = 0
let startedAt = 0
let subject: WebkitVideo | null = null

function tick(): void {
  ticks += 1
  const video = subject
  if (!video) return stop('영상 없음')

  const seconds = Math.round((Date.now() - startedAt) / 100) / 10
  log(
    `나가있음 +${seconds}s 모드=${video.webkitPresentationMode ?? '?'} ` +
      `재생=${!video.paused} 시간=${video.currentTime.toFixed(1)} ` +
      `readyState=${video.readyState} 숨김=${document.hidden}`,
  )

  if (ticks >= MAX_TICKS) stop('그만 볼 시간')
}

/** Begin recording. Called from the departure, on the same tick as everything else. */
export function startAwayRecord(video: WebkitVideo): void {
  stop()
  subject = video
  ticks = 0
  startedAt = Date.now()
  timer = setInterval(tick, TICK_MS)
}

export function stop(why?: string): void {
  if (timer) {
    clearInterval(timer)
    if (why) log(`나가있음: 기록 끝 (${why})`)
  }
  timer = null
  subject = null
}
