// Which kind of device the UI opened on.
//
// Three things could answer this and two of them cannot.
//
// The user agent is out: Orion on iPhone reports a desktop Mac Chrome UA
// (measured on the device — a 진단 dump from the phone reads
// `Macintosh; Intel Mac OS X 10_15_7 … Chrome/130`), so a UA check calls the
// phone a PC. That is the browser this extension is on a phone *through*, so
// the one case UA sniffing has to get right is the one it gets wrong.
//
// The popup's own width is out too, for a subtler reason: a desktop popup has
// no window to fill, so the browser sizes it from the document. Asking the
// width what width to be is circular. And on a phone the sheet is sized by the
// system, so in landscape it is wider than any breakpoint while still being a
// phone.
//
// The screen is neither. It describes the device rather than the window, and
// its short side is the same in both orientations.

/**
 * Short side, in CSS pixels, up to which a screen is a phone.
 *
 * Above every phone (the widest, an iPhone Pro Max, is 440) and below every
 * tablet (an iPad mini, the smallest, is 744). Nothing ships in between, so the
 * gap is wide enough that the exact number does not matter much.
 */
export const PHONE_SHORT_SIDE = 500

export type ScreenKind = 'phone' | 'desktop'

/**
 * Pure, so the tests can name real devices instead of a browser.
 *
 * The short side rather than the width: a phone held sideways is still a phone,
 * and `screen.width` alone reports 844 for one.
 */
export function screenKind(width: number, height: number): ScreenKind {
  return Math.min(width, height) <= PHONE_SHORT_SIDE ? 'phone' : 'desktop'
}

/**
 * Stamp the answer on <html> so the stylesheet can branch on it.
 *
 * Called before the first render: the popup is empty until React fills it and
 * the browser sizes it to whatever lands, so the class is in place before there
 * is anything to size.
 */
export function applyScreenKind(): ScreenKind {
  const kind = screenKind(window.screen.width, window.screen.height)
  document.documentElement.classList.add(`on-${kind}`)
  return kind
}
