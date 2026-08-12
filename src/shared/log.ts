// A log that survives the phone.
//
// There is no console on an iPhone, and the moment that matters is the one where
// the app goes away — iOS stops running the page within a frame of it, so a
// storage write started then never flushes and a message posted then is never
// delivered. What does survive is an attribute on the document element: written
// synchronously, still there when the page comes back.
//
// So this is a ring buffer kept in the DOM. Both worlds can write to it — MAIN
// and ISOLATED share the document — and the popup reads it out of the page's
// last diagnostics report. Small on purpose: it is a tail, not a history.

const ATTR = 'data-oc-abp-log'

/** Enough to hold a leave and a return. Older lines fall off the front. */
const MAX_CHARS = 1800

function stamp(): string {
  const now = new Date()
  return `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(
    now.getMilliseconds(),
  ).padStart(3, '0')}`
}

function append(root: Element, text: string): void {
  const previous = root.getAttribute(ATTR) ?? ''
  const next = previous ? `${previous}\n${stamp()} ${text}` : `${stamp()} ${text}`
  root.setAttribute(ATTR, next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next)
}

/**
 * The last line this world wrote, and how many times it has repeated since.
 *
 * Per world on purpose. Both worlds append to the same attribute, so rewriting
 * the tail to fold a repeat into it would clobber whatever the other one wrote in
 * between. Counting here and appending later touches only our own lines.
 */
let lastLine = ''
let repeats = 0

/**
 * Append one line. Never throws, never waits.
 *
 * Called from paths that run while the page is being suspended, so it does the
 * least possible: one read, one write, no allocation beyond the string itself.
 *
 * Repeats are counted rather than written. A feedback loop between the two worlds
 * once put dozens of identical pairs into a single millisecond and pushed every
 * line before them out of a 1800-character buffer — the storm was visible and
 * what caused it was not, because the log had eaten its own beginning. A run of
 * the same line now costs one line whatever its length.
 */
export function log(line: string): void {
  try {
    const root = document.documentElement
    if (!root) return
    if (line === lastLine) {
      repeats += 1
      return
    }
    if (repeats > 0) {
      append(root, `— 위 줄 ${repeats}번 더`)
      repeats = 0
    }
    lastLine = line
    append(root, line)
  } catch {
    // A log that can break the page is worse than no log.
  }
}

export function readLog(): string | null {
  try {
    return document.documentElement?.getAttribute(ATTR) ?? null
  } catch {
    return null
  }
}
