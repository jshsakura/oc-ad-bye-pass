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

/** Where a translate control can live. Broad on purpose; the label filters. */
const CANDIDATES = [
  '#translate-button',
  'ytd-comment-view-model #translate-button',
  'ytd-comment-renderer #translate-button',
  'ytm-comment-renderer button',
  '#content-text + button',
]

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
 * Press every unpressed translate control near the viewport.
 * Returns how many were pressed.
 */
export function translateComments(): number {
  let pressed = 0
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
      if (!nearViewport(node)) continue

      // Marked before the click: if the click throws, or YouTube re-renders in
      // response, this control is still never pressed a second time.
      node.setAttribute(CLICKED_ATTR, '1')
      try {
        ;(node as HTMLElement).click()
        pressed += 1
      } catch {
        // A control that refuses to be clicked is not worth retrying.
      }
    }
  }
  return pressed
}
