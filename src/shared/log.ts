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
  return new Date().toISOString()
}

/** Legacy minute-only stamps cannot be ordered across an hour boundary. */
export function mergeLogLines(stored: string, tail: string, limit = 8000): string {
  const lines = [...new Set([...stored.split('\n'), ...tail.split('\n')])]
    .filter((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /.test(line))
    .sort((a, b) => a.slice(0, 24).localeCompare(b.slice(0, 24)))
  while (lines.join('\n').length > limit) lines.shift()
  return lines.join('\n')
}

/**
 * Append one line. Never throws, never waits.
 *
 * Called from paths that run while the page is being suspended, so it does the
 * least possible: one read, one write, no allocation beyond the string itself.
 */
function append(root: Element, text: string): void {
  const previous = root.getAttribute(ATTR) ?? ''
  const next = previous ? `${previous}\n${stamp()} ${text}` : `${stamp()} ${text}`
  const start = next.length > MAX_CHARS ? next.indexOf('\n', next.length - MAX_CHARS) + 1 : 0
  root.setAttribute(ATTR, next.slice(start))
}

/** The last line this world wrote, and how many times it has repeated since. */
let lastLine = ''
let repeats = 0

export function log(line: string): void {
  try {
    const root = document.documentElement
    if (!root) return
    /*
     * A run of the same line costs one line.
     *
     * Twice now a feedback loop has put dozens of identical entries into a single
     * millisecond and pushed everything before them out of an 1800-character
     * buffer — the storm visible, its cause deleted by it. The loop is fixed each
     * time; this is so the next one cannot erase the evidence of itself.
     */
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
