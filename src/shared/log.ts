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
function append(root: Element, text: string): void {
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
 * Both copies, merged and in order.
 *
 * It used to prefer localStorage and fall back to the attribute only when the
 * first threw. That assumed the two hold the same lines, and there is no
 * guarantee they do: the extension's world and the page's may not reach the same
 * storage on every browser, and a partitioned or refused localStorage is a silent
 * one — it returns a short answer rather than an error, and a short answer wins
 * over a full attribute. The panel then reports almost nothing while the record
 * is sitting right there.
 *
 * So neither is trusted over the other. Lines carry a full timestamp, which makes
 * merging them exact rather than a guess.
 */
export function readLog(): string | null {
  const store = lines(readStore())
  const attribute = lines(readAttribute())
  if (store.length === 0 && attribute.length === 0) return null

  /*
   * Merged as multisets, not as sets.
   *
   * The two copies overlap wherever both worlds could write, so a plain union
   * would print everything twice — and a plain de-duplication would delete the
   * second of two identical lines written inside one millisecond, which is a real
   * thing this log does. Taking the larger count of each line keeps the overlap
   * collapsed and the genuine repeats intact.
   */
  const merged = [...store]
  const room = tally(store)
  for (const line of attribute) {
    const left = (room.get(line) ?? 0) - 1
    room.set(line, left)
    if (left < 0) merged.push(line)
  }

  // By timestamp only, and stably. Sorting whole lines puts them in alphabetical
  // order within a millisecond, which scrambles exactly the bursts worth reading.
  return merged
    .map((line, index) => ({ line, index }))
    .sort((a, b) => a.line.slice(0, 12).localeCompare(b.line.slice(0, 12)) || a.index - b.index)
    .map((entry) => entry.line)
    .join('\n')
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

function tally(list: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of list) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

function readStore(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? ''
  } catch {
    return ''
  }
}

function readAttribute(): string {
  try {
    return document.documentElement?.getAttribute(ATTR) ?? ''
  } catch {
    return ''
  }
}
