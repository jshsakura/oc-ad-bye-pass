// What the phone actually delivers — counted, not waited for.
//
// Three releases of instrumentation failed the same way: every probe was written
// at the moment of the departure, and the moment of the departure is exactly when
// nothing can be relied on to survive. A line written there dies with its document
// if the browser replaces it, and a storage write started there may never flush.
// The log came back showing a page starting, then a page starting again, and the
// reader has no way to tell "the handler never ran" from "the handler ran and the
// evidence was lost".
//
// So nothing here is written at the interesting moment. Events are counted as they
// arrive — a counter costs one increment and cannot be half-written — and the
// totals are logged on a timer while the page is in front, where writing is safe.
// Come back from the home screen, wait two seconds, and the panel says how many
// visibilitychanges the departure produced. If the answer is zero, that is a fact
// about this browser and not a guess about our listeners.
//
// It also answers the one measurement the swipe path needs and never got: how
// close to the bottom of the page a thumb can actually reach. On iOS the browser's
// own bar owns the bottom of the screen, so the lowest touch the page ever sees is
// some distance above it — and that distance decides whether looking for a home
// swipe is worth anything at all.

import { log } from '../shared/log.ts'

interface Census {
  touchstart: number
  /** Touches that began inside the band the home-swipe watcher cares about. */
  touchLow: number
  touchend: number
  touchcancel: number
  visibilitychange: number
  pagehide: number
  pageshow: number
  blur: number
  focus: number
  freeze: number
  resume: number
}

const seen: Census = {
  touchstart: 0,
  touchLow: 0,
  touchend: 0,
  touchcancel: 0,
  visibilitychange: 0,
  pagehide: 0,
  pageshow: 0,
  blur: 0,
  focus: 0,
  freeze: 0,
  resume: 0,
}

/** How close to the visible bottom edge any touch has come. */
let closestToBottom = Infinity

/** The band the home-swipe watcher reads as "started at the edge". */
const LOW_BAND = 60

/** How often the totals are written down, while the page is in front. */
const TICK_MS = 2000

let timer: ReturnType<typeof setInterval> | null = null
let lastWritten = ''

/**
 * The bottom of what a thumb can reach, in the coordinates touches arrive in.
 * The same measurement src/isolated/pip.ts makes, for the same reason: on iOS
 * `window.innerHeight` runs on underneath the browser's bottom bar.
 */
function visibleBottom(): number {
  const view = window.visualViewport
  if (!view) return window.innerHeight
  return view.offsetTop + view.height
}

function count(key: keyof Census): void {
  seen[key] += 1
}

function onTouch(event: Event): void {
  count('touchstart')
  const touch = (event as TouchEvent).changedTouches?.[0]
  if (!touch) return
  const fromBottom = visibleBottom() - touch.clientY
  if (fromBottom < closestToBottom) closestToBottom = fromBottom
  if (fromBottom <= LOW_BAND) count('touchLow')
}

const WATCHED: [EventTarget, string, EventListener][] = []

function watch(): void {
  const simple: [EventTarget, keyof Census][] = [
    [document, 'visibilitychange'],
    [window, 'pagehide'],
    [window, 'pageshow'],
    [window, 'blur'],
    [window, 'focus'],
    [document, 'freeze'],
    [document, 'resume'],
    [document, 'touchend'],
    [document, 'touchcancel'],
  ]
  for (const [target, type] of simple) {
    const handler = () => count(type)
    WATCHED.push([target, type, handler])
    target.addEventListener(type, handler, { capture: true, passive: true })
  }
  WATCHED.push([document, 'touchstart', onTouch])
  document.addEventListener('touchstart', onTouch, { capture: true, passive: true })
}

/**
 * One line, and only when it has changed.
 *
 * Repeats are collapsed by the log itself, but an unchanged line still costs a
 * localStorage write every two seconds for as long as the page is open.
 */
function tick(): void {
  if (document.hidden) return
  const reach = Number.isFinite(closestToBottom) ? `${Math.round(closestToBottom)}px` : '없음'
  const line =
    `본 것: 터치 ${seen.touchstart}(하단 ${seen.touchLow}, 최저 ${reach}) ` +
    `끝 ${seen.touchend}/취소 ${seen.touchcancel} · ` +
    `가시성 ${seen.visibilitychange} pagehide ${seen.pagehide} pageshow ${seen.pageshow} ` +
    `blur ${seen.blur} 포커스 ${seen.focus} freeze ${seen.freeze} resume ${seen.resume}`
  if (line === lastWritten) return
  lastWritten = line
  log(line)
}

export function startCensus(): void {
  if (timer) return
  watch()
  timer = setInterval(tick, TICK_MS)
  tick()
}

export function stopCensus(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const [target, type, handler] of WATCHED.splice(0)) {
    target.removeEventListener(type, handler, true)
  }
}
