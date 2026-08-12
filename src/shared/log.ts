// A log that survives the phone.
//
// There is no console on an iPhone, and the moment that matters is the one where
// the app goes away — iOS stops running the page within a frame of it, so a
// storage write started then never flushes and a message posted then is never
// delivered. What does survive is a synchronous write.
//
// Two of them, because one document is not enough.
//
//   the attribute   written at document_start, before anything else exists, and
//                   readable by both worlds since they share the document
//   localStorage    the same lines, and they outlive the document
//
// The second was added on 2026-08-12 after a departure went unrecorded three
// releases running. The attribute dies with its document and only reaches
// chrome.storage when reportDiagnostics happens to run; leaving an iPhone and
// coming back routinely replaces the document, so every line written on the way
// out — the whole question — was gone before anything could fold it in. The log
// showed a page starting, then a page starting again, and nothing in between,
// which reads as "the handler never ran" and was nothing of the kind.
//
// localStorage is the page's, not the extension's, so it is read-modify-written
// on every line: MAIN and ISOLATED both write here and neither may clobber the
// other. That costs a synchronous read per line, which is affordable because
// lines are few — a departure is a handful — and because runs of the same line
// are collapsed rather than written.

const ATTR = 'data-oc-abp-log'

/** The page's own storage, shared by both worlds, outliving the document. */
const STORE_KEY = 'oc-abp-log'

/** Enough to hold a leave and a return. Older lines fall off the front. */
const MAX_CHARS = 1800

/** The durable copy holds more, since it spans documents. */
const STORE_MAX_CHARS = 8000

/**
 * Hours included. Minutes alone made two lines an hour apart look adjacent, and
 * the tail spans whatever the phone did between one look and the next.
 */
function stamp(): string {
  const now = new Date()
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(
    now.getMilliseconds(),
    3,
  )}`
}

function tail(previous: string, line: string, limit: number): string {
  const next = previous ? `${previous}\n${line}` : line
  return next.length > limit ? next.slice(next.length - limit) : next
}

function append(root: Element, text: string): void {
  const line = `${stamp()} ${text}`
  root.setAttribute(ATTR, tail(root.getAttribute(ATTR) ?? '', line, MAX_CHARS))
  try {
    localStorage.setItem(STORE_KEY, tail(localStorage.getItem(STORE_KEY) ?? '', line, STORE_MAX_CHARS))
  } catch {
    // Private mode, a storage quota, a page that has disabled it. The attribute
    // is still there and still answers for this document.
  }
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

/**
 * The tail, preferring the copy that spans documents.
 *
 * The attribute only ever holds this document's lines, and the interesting ones
 * were written by the last one.
 */
export function readLog(): string | null {
  try {
    const stored = localStorage.getItem(STORE_KEY)
    if (stored) return stored
  } catch {
    // Fall through to the attribute.
  }
  try {
    return document.documentElement?.getAttribute(ATTR) ?? null
  } catch {
    return null
  }
}
