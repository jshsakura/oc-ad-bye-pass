// Auto-translate comments by pressing YouTube's own translate control.
//
// **No text leaves the page.** The obvious implementation — read each comment,
// send it to a translation API — would ship every comment the user reads to a
// third party, need a host permission for it, and break the one promise this
// extension makes about data. YouTube already offers "Translate to <language>"
// on comments written in another language, and the translation is its own
// service on text it already has. So this presses that button and nothing else.
//
// The control is localized and its label is the only stable thing about it
// across desktop and mobile layouts, so the label decides — never a class name
// that ships different markup on m.youtube.

/**
 * Where a translate control can live. Broad on purpose; the label filters.
 *
 * Anything pressable inside a comment is a candidate, because YouTube ships
 * different markup on desktop and on m.youtube and changes both. The reply
 * button and the like count come back too — and are dropped by their label,
 * which is the one thing about the control that is stable.
 */
const CANDIDATES = [
  '#translate-button',
  'ytd-comment-view-model #translate-button',
  'ytd-comment-renderer #translate-button',
  'ytd-comment-view-model yt-button-shape button',
  'ytd-comment-view-model tp-yt-paper-button',
  'ytd-comment-renderer yt-button-shape button',
  'ytm-comment-renderer button',
  'ytm-comment-renderer [role="button"]',
]

/**
 * The element that actually carries the click handler.
 *
 * `#translate-button` is not a button. On desktop it is the id of a
 * `ytd-button-renderer`, a wrapper whose real `<button>` is nested inside it —
 * and a click dispatched on the wrapper **bubbles up, never down**, so the
 * handler never runs. The press was counted, the diagnostics said it worked,
 * and nothing was translated.
 *
 * The e2e fixture hid this: it builds a bare `<button id="translate-button">`,
 * which is the shape this code assumed rather than the shape YouTube ships.
 */
function pressTarget(node: Element): HTMLElement | null {
  const inner = node.querySelector<HTMLElement>('button, [role="button"], a[href]')
  if (inner) return inner
  return node instanceof HTMLElement ? node : null
}

/** Marks a control this ran on, so a comment is never translated twice. */
const CLICKED_ATTR = 'data-oc-abp-translated'

/**
 * How many controls one pass may press.
 *
 * Each press is a request YouTube makes, and a long thread can hold hundreds of
 * comments. Pressing every one at once would be a burst of traffic the user did
 * not ask for; the sweep runs again on the next DOM change, so the rest follow
 * as they are read.
 */
const PER_PASS = 8

/**
 * Should this label be pressed?
 *
 * Two states share the control: "Translate to Korean" before, "Show original"
 * after. Pressing the second undoes the first, which is how an auto-clicker
 * ends up flickering a comment back and forth forever.
 */
export function shouldClickTranslate(label: string): boolean {
  const text = label.trim()
  if (!text || text.length > 40) return false
  // Already translated — this control now says "show original".
  if (/원문|show\s*original|원본/i.test(text)) return false
  return /번역|translate/i.test(text)
}

/** True when the element is close enough to the viewport to be worth pressing. */
function nearViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const limit = innerHeight * 2
  return rect.top < limit && rect.bottom > -limit
}

/**
 * What the last sweep saw.
 *
 * Two failures look identical from outside — YouTube offering no control at
 * all, and a control that was found and pressed to no effect — and they need
 * opposite fixes. Only a real page can tell them apart, so the sweep counts
 * both and the 진단 panel reports them.
 */
export interface TranslateSweep {
  /** Controls whose label said "translate" and that had not been pressed yet. */
  found: number
  /** Of those, how many were actually clicked. */
  pressed: number
}

let lastFound = 0

/** How many candidates the last sweep matched by label, pressed or not. */
export function foundTranslateControls(): number {
  return lastFound
}

/**
 * Press every unpressed translate control near the viewport.
 * Returns how many were pressed.
 */
export function translateComments(): number {
  let pressed = 0
  let found = 0
  const seen = new Set<Element>()

  for (const selector of CANDIDATES) {
    let nodes: NodeListOf<Element>
    try {
      nodes = document.querySelectorAll(selector)
    } catch {
      continue // a selector YouTube's markup no longer supports is not fatal
    }
    for (const node of nodes) {
      if (pressed >= PER_PASS) return pressed
      if (seen.has(node) || node.hasAttribute(CLICKED_ATTR)) continue
      seen.add(node)
      if (!shouldClickTranslate(node.textContent ?? '')) continue
      found += 1
      if (!nearViewport(node)) continue

      const target = pressTarget(node)
      if (!target) continue
      // The wrapper and the button inside it are two different nodes and the
      // selector list matches both, so a mark on the matched node alone lets
      // the same control be pressed twice — which translates it and then puts
      // it straight back to the original.
      if (target.hasAttribute(CLICKED_ATTR)) continue

      // Marked before the click: if the click throws, or YouTube re-renders in
      // response, this control is still never pressed a second time.
      node.setAttribute(CLICKED_ATTR, '1')
      target.setAttribute(CLICKED_ATTR, '1')
      try {
        target.click()
        pressed += 1
      } catch {
        // A control that refuses to be clicked is not worth retrying.
      }
    }
  }
  lastFound += found
  return pressed
}
