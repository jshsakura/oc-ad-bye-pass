// Turning an element the user pointed at into a rule they can keep.
//
// This is the half of the element picker that has no UI in it. The overlay
// lives in src/isolated/picker.ts; what is here is the only interesting
// question: given an element, what is the shortest selector that names it and
// will still name it tomorrow.
//
// "Tomorrow" is the whole difficulty. A selector copied out of devtools
// (`#content > div:nth-child(3) > div.sc-a1b2c3`) matches exactly once, on that
// page, in that build — the ad comes back under a different hash and the rule
// the user saved does nothing while looking correct. So generated selectors are
// built out of the parts of the DOM that carry meaning (a custom element's
// name, a hand-written class, an ad-ish attribute) and never out of the parts
// that carry a build (hashes, digit runs, positional indexes).
//
// It is better to offer nothing than to offer a rule that will quietly rot,
// which is why `candidateSelectors` can come back empty.

/** As long a class list as anyone writes by hand. Beyond it, it is generated. */
const MAX_TOKEN_LENGTH = 40

/** A hex run this long inside a class name is a build hash, not a name. */
const HASH_RUN = /[0-9a-f]{6,}/i

/** Four digits in a row is an id, a timestamp or a counter. Never a name. */
const DIGIT_RUN = /\d{4,}/

/**
 * A word-sized chunk that mixes letters and digits — `1x2y3z4`, `a1b2c3`.
 *
 * This is what catches the CSS-in-JS hashes that the two rules above miss:
 * emotion's `css-1x2y3z4` has no hex run and no digit run, and it is different
 * on every build. Segments are examined rather than the whole token, so
 * `col-md-6` and `h1` survive.
 *
 * **It costs `ad300x250`**, which is a real hand-written class and exactly the
 * kind an ad blocker wants. That is the trade accepted here, because the two
 * mistakes are not symmetric: offering a wider rule (or none, and letting the
 * user widen) is a worse suggestion, while offering a hashed one is a rule that
 * works when it is tested and is silently dead a week later, with nothing to
 * tell the user which happened.
 */
const MIXED_CHUNK = 6

/** CSS identifiers we can write literally. Anything else would need escaping. */
const PLAIN_IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * Attributes worth building a selector out of.
 *
 * Each one is a statement by the page about what the element *is*, which is
 * exactly what survives a redeploy. `class` and `id` are handled separately;
 * everything else on an element is either styling or state.
 */
const MEANINGFUL_ATTRS = [
  'data-ad',
  'data-ad-slot',
  'data-ad-client',
  'data-adunit',
  'data-testid',
  'data-cy',
  'data-qa',
  'aria-label',
  'role',
  'name',
] as const

/** Would this class name still be there after a rebuild? */
export function isStableClass(token: string): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false
  if (!PLAIN_IDENT.test(token)) return false
  if (HASH_RUN.test(token)) return false
  if (DIGIT_RUN.test(token)) return false
  for (const chunk of token.split(/[-_]/)) {
    if (chunk.length < MIXED_CHUNK) continue
    if (/\d/.test(chunk) && /[A-Za-z]/.test(chunk)) return false
  }
  return true
}

/** Same question for an id, which is otherwise the strongest handle there is. */
export function isStableId(id: string): boolean {
  return isStableClass(id)
}

/** A tag name that says something by itself — `ytd-ad-slot-renderer`, not `div`. */
export function isCustomElement(tag: string): boolean {
  return tag.includes('-')
}

function attributeValue(value: string): string | null {
  // Long values are copy, not identity, and they are the ones that change.
  if (!value || value.length > 60) return null
  if (/["\\]/.test(value)) return null
  // Control characters would break out of the quoted string.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return value
}

/**
 * Selectors that name this element, best first.
 *
 * "Best" means most likely to still be right later, **not** most precise.
 * A rule that matches the three ad slots on the page is a better rule than one
 * that matches the one that happens to be third in the DOM, so nothing here
 * ever reaches for `:nth-child`.
 *
 * The caller filters the result through `isSafeSelector` — this function is not
 * the safety gate, only the source of ideas.
 */
export function candidateSelectors(element: Element): string[] {
  const out: string[] = []
  const push = (selector: string) => {
    if (selector && !out.includes(selector)) out.push(selector)
  }

  const tag = element.tagName.toLowerCase()
  const id = element.getAttribute('id') ?? ''
  const classes = [...element.classList].filter(isStableClass)

  // An id is the page naming the element outright. Nothing beats it.
  if (isStableId(id)) push(`#${id}`)

  // A custom element's own name, narrowed by whatever else it carries. The
  // narrowed form comes first: `ytd-rich-item-renderer.ad` is a better rule
  // than the bare tag, which would take the whole feed with it.
  if (isCustomElement(tag)) {
    if (classes.length) push(`${tag}.${classes.join('.')}`)
    push(tag)
  }

  if (classes.length) {
    push(`${tag}.${classes.join('.')}`)
    // One class is the more forgiving rule: it survives the page adding a
    // second one, which the full list above does not.
    push(`${tag}.${classes[0]}`)
    push(`.${classes[0]}`)
  }

  for (const attr of MEANINGFUL_ATTRS) {
    const raw = element.getAttribute(attr)
    if (raw === null) continue
    const value = attributeValue(raw)
    // A bare presence check is the stronger rule when the value is noise.
    push(value ? `${tag}[${attr}="${value}"]` : `${tag}[${attr}]`)
  }

  return out
}

/**
 * Walk up from an element until something is nameable.
 *
 * The thing a person points at is often a bare `<span>` inside the ad rather
 * than the ad, and the ad is the ancestor that carries the mark. This is what
 * makes the picker feel like it understood the click rather than took it
 * literally.
 */
export function nameableAncestor(
  element: Element,
  isUsable: (selector: string) => boolean,
  maxDepth = 6,
): { element: Element; selector: string } | null {
  let node: Element | null = element
  for (let depth = 0; node && depth < maxDepth; depth++) {
    for (const selector of candidateSelectors(node)) {
      if (isUsable(selector)) return { element: node, selector }
    }
    node = node.parentElement
    // The document's own frame is never the answer — hiding it blanks the page.
    if (node === document.body || node === document.documentElement) break
  }
  return null
}
