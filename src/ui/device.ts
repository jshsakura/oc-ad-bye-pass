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

/*
 * Whether this browser needs a picture-in-picture button drawn for it.
 *
 * The button exists because of one fact measured on an iPhone: WebKit opens a
 * floating window only inside a live user gesture, and YouTube replaces the
 * native controls where WebKit's own PiP control lives. A tap on something of
 * ours is therefore the only way in — see docs/pip-on-iphone.md.
 *
 * That fact does not travel. Desktop Chrome has picture-in-picture two
 * right-clicks away and again in the address bar's media control; Firefox
 * draws its own PiP toggle over every video on hover. On those a button of
 * ours is a second way to do a thing the browser already offers, sitting on
 * top of the player at the top of the stack. It reads as clutter because it is.
 *
 * So: WebKit, or a phone — where the gesture is the only reliable path whatever
 * the engine. Elsewhere the button is not drawn and its switch is not shown.
 */
export interface PipButtonFacts {
  /** The engine exposes WebKit's presentation-mode API. */
  webkit: boolean
  /** The screen is phone-sized (see screenKind). */
  phone: boolean
}

export function needsPipButton({ webkit, phone }: PipButtonFacts): boolean {
  return webkit || phone
}

/**
 * Read the facts from a window. Works in the popup and in a content script
 * alike: the prototype reflects the engine, and `screen` describes the device.
 */
export function pipButtonFacts(win: Window & typeof globalThis = window): PipButtonFacts {
  return {
    webkit: 'webkitSetPresentationMode' in win.HTMLVideoElement.prototype,
    phone: screenKind(win.screen.width, win.screen.height) === 'phone',
  }
}
