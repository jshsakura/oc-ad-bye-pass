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

/**
 * A tail an older build left in the page's storage.
 *
 * Written to until 2026-08-12 and never again — the writes were removed when the
 * player stopped loading and everything this extension had started doing to the
 * page went back. Reading it was kept so an existing tail was not thrown away,
 * and that turned out to mean every dump since carries the same frozen hour of
 * lines from builds nobody is asking about, above the twenty that matter.
 *
 * So it is cleared, once, and not read again. One removeItem is not what the
 * per-line writes were.
 */
const LEGACY_STORE_KEY = 'oc-abp-log'

/** Enough to hold a leave and a return. Older lines fall off the front. */
const MAX_CHARS = 1800


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

/*
 * The page's own localStorage is not written to any more.
 *
 * It was, so the tail could outlive a document — leaving an iPhone and coming
 * back routinely replaces the document, and the lines written on the way out died
 * with it. It bought a readable record and it put a synchronous write into the
 * page's storage on every line, on a page whose player is the thing being
 * debugged. Playback stopped working somewhere in the same handful of releases
 * and this is one of three things touching the page that arrived with them.
 *
 * Reading still looks at both, so a tail written by an older build is not thrown
 * away.
 */
let clearedLegacy = false

function clearLegacy(): void {
  if (clearedLegacy) return
  clearedLegacy = true
  try {
    localStorage.removeItem(LEGACY_STORE_KEY)
  } catch {
    // Nothing to clean up, or nowhere to clean it up in.
  }
}

function append(root: Element, text: string): void {
  clearLegacy()
  root.setAttribute(ATTR, tail(root.getAttribute(ATTR) ?? '', `${stamp()} ${text}`, MAX_CHARS))
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
 * This document's lines, as written.
 *
 * There was a merge here across two stores while the second one existed. It does
 * not, and a merge with something frozen yesterday reads worse than nothing.
 */
export function readLog(): string | null {
  const written = lines(readAttribute())
  return written.length === 0 ? null : written.join('\n')
}

/**
 * Only lines this version can place in time.
 *
 * Stamps carried minutes and seconds until 2026-08-12 and carry the hour now, and
 * the two stores hold whatever was written before the update — a page's
 * localStorage outlives an extension being reinstalled. Ordering a mixture of the
 * two by their first twelve characters interleaves an hour-old line with a fresh
 * one and reads as nonsense, which is what the last dump looked like.
 *
 * Old lines are dropped rather than migrated. They belong to versions whose
 * behaviour is no longer the question.
 */
const STAMPED = /^\d{2}:\d{2}:\d{2}\.\d{3} /

function lines(text: string): string[] {
  return text.split('\n').filter((line) => STAMPED.test(line))
}

function readAttribute(): string {
  try {
    return document.documentElement?.getAttribute(ATTR) ?? ''
  } catch {
    return ''
  }
}
