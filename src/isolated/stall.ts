// A freeze leaves nothing behind. This leaves a line.
//
// Reported from a phone: the browser goes unresponsive now and then, and it
// started with this extension. Three suspects were measured in Chromium with a
// 6× CPU throttle and none of them explains it — the extension adds ~12% to
// style recalculation, ~15% to script time, and no memory growth over the
// browser's own. Chromium is not the engine that stalls, and there is no
// console, no profiler and no crash log on the device that does.
//
// So instead of guessing again: measure the gap between ticks of a one-second
// timer. A gap much longer than a second means the main thread was busy for
// that long, which is exactly what a freeze is, and the line goes into the same
// ring buffer the diagnostics panel already reports. The next freeze then
// arrives with its own duration attached.
//
// This is an instrument, not a fix. It costs one timer, on the video site only,
// where the report came from.

import { log } from '../shared/log.ts'

const TICK_MS = 1000

/** How far past the interval a gap has to run before it is worth a line. */
export const STALL_MS = 2000

/**
 * How long the main thread was blocked, or 0 when this gap says nothing.
 *
 * Pure, because what has to be right here is the *exclusions* — a watchdog that
 * cries at every backgrounded tab is a watchdog nobody reads.
 *
 * `visible` is false if the document was hidden at any point across the gap.
 * iOS suspends timers in a backgrounded tab and on a locked screen, and those
 * gaps run to minutes while nothing was ever blocked. Picture-in-picture is the
 * same: the video plays on while the page is hidden and its timers slow down.
 */
export function stallMs(gap: number, visible: boolean): number {
  if (!visible) return 0
  const late = gap - TICK_MS
  return late >= STALL_MS ? late : 0
}

let timer: ReturnType<typeof setInterval> | null = null
let last = 0
let sawHidden = false

/** Any visibility change at all disqualifies the gap it falls in. */
function onVisibility(): void {
  sawHidden = true
}

/** Safe to call repeatedly; only the top document runs one. */
export function watchForStalls(): void {
  if (timer !== null || window.top !== window) return
  last = Date.now()
  document.addEventListener('visibilitychange', onVisibility, { passive: true })
  timer = setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now
    const hidden = sawHidden || document.hidden
    sawHidden = false
    const blocked = stallMs(gap, !hidden)
    if (blocked) log(`멈춤 ${(blocked / 1000).toFixed(1)}초`)
  }, TICK_MS)
}

export function stopWatchingStalls(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onVisibility)
  sawHidden = false
}
