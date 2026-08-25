// Pop-ups and pop-unders — MAIN world.
//
// This is the one blocking layer that cannot live anywhere else. A pop-under is
// the page's own script calling `window.open`; no request has been made yet, so
// declarativeNetRequest has nothing to match and a stylesheet has nothing to
// hide. Only a hook in the page's own context sees it.
//
// **The rule is: a window may open only out of a press on something pressable.**
//
// The obvious rule — "no user gesture, no window" — was tried first and is a
// placebo. Every browser already refuses a gesture-less `window.open`; writing
// it again buys nothing on Chrome and only matters where a WebKit build is
// laxer. What browsers deliberately do *not* refuse is the modern pop-under,
// which rides a real click: a listener on the document turns a press anywhere
// on the page — the background, an image, a paragraph — into a new window.
// That is the gap, and it is checkable, because a press that was meant to open
// something lands on a link or a button and a hijacked one does not.
//
// So the guard remembers what the last press landed on and asks whether that
// thing was pressable. The whole judgement is in `INTERACTIVE` below.
//
// **What this costs.** A site that opens a window from a press on a plain
// `<div>` — a custom card, a canvas, a bespoke widget — is refused, and it did
// nothing wrong. That is the price of catching the click-riding pop-under at
// all, and it is why this is a toggle and why the per-site off switch exists.
// The alternative prices are worse: allow every click-riding window (the
// placebo above) or block on the destination URL, which means guessing at
// intent from a hostname and breaking OAuth and payment windows.
//
// `navigator.userActivation` is deliberately not consulted. It answers "was
// there a gesture recently", which is the question that does not distinguish
// the two cases — and its window is five seconds, long enough for a pop-under
// fired from a timer to look like a click.
//
// A blocked call returns `null`, which is exactly what the browser's own pop-up
// blocker returns. Pages that cope with being blocked already cope with this.

import { NS } from '../shared/messages.ts'

/**
 * How long a press stays the reason for a window.
 *
 * A window that a press asked for opens out of that press's own handler, so
 * this only has to cover the handler running late — a click that awaits
 * something before opening. Browsers give transient activation five seconds;
 * this is shorter on purpose, because the longer the window the more a timer
 * can hide inside it.
 */
const PRESS_MS = 1500

const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const

/**
 * Things a person presses to open something.
 *
 * Anchors and buttons are the whole of it in practice, plus the ARIA spellings
 * for the widgets built out of `<div>`s that at least say what they are. An
 * element that says nothing about itself and opens a window is the pattern this
 * guard exists for.
 */
const INTERACTIVE =
  'a[href], area[href], button, input, select, textarea, label, summary, ' +
  '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick], [contenteditable]'

let enabled = true
let pressedAt = 0
let pressedOn: Element | null = null

/** Did a press on something pressable just happen? */
function pressWasIntentional(): boolean {
  if (Date.now() - pressedAt > PRESS_MS) return false
  const target = pressedOn
  if (!target) return false
  try {
    // `closest` rather than the target itself: a press lands on the <span>
    // inside the button as often as on the button.
    return !!target.closest?.(INTERACTIVE)
  } catch {
    // A malformed selector cannot happen here, but a detached or exotic node
    // can throw. Allow it: refusing on an error would block a real window.
    return true
  }
}

function report(url: unknown): void {
  try {
    window.postMessage(
      { ns: NS, type: 'popup-blocked', url: typeof url === 'string' ? url.slice(0, 200) : '' },
      '*',
    )
  } catch {
    // Reporting is a statistic. Never let it affect what we returned.
  }
}

export function setPopupBlocking(on: boolean): void {
  enabled = on
}

export function installPopupGuard(): void {
  const nativeOpen = window.open
  if (typeof nativeOpen !== 'function') return

  for (const type of PRESS_EVENTS) {
    // Capture, so a page that stops propagation in its own handler cannot make
    // its presses invisible to us — which would turn every window the user
    // asked for into a blocked one.
    window.addEventListener(
      type,
      (event) => {
        pressedAt = Date.now()
        // `composedPath()[0]` rather than `target`, so a press inside a shadow
        // root reports the element pressed and not the host that retargets it.
        const path = typeof event.composedPath === 'function' ? event.composedPath() : []
        const node = (path[0] ?? event.target) as Node | null
        pressedOn = node instanceof Element ? node : null
      },
      { capture: true, passive: true },
    )
  }

  const guarded = function open(this: unknown, ...args: unknown[]): Window | null {
    if (enabled && !pressWasIntentional()) {
      report(args[0])
      return null
    }
    return (nativeOpen as (...a: unknown[]) => Window | null).apply(window, args)
  }

  // Pages do check. `window.open.toString()` reading as native code is not
  // about hiding from anyone — it is that a page which decides it is being
  // tampered with usually responds by refusing to work, and a reader who wanted
  // an ad blocker did not ask for a broken site.
  try {
    Object.defineProperty(guarded, 'toString', {
      value: () => Function.prototype.toString.call(nativeOpen),
      writable: true,
      configurable: true,
    })
    Object.defineProperty(guarded, 'name', { value: 'open', configurable: true })
  } catch {
    // Cosmetic. Not worth failing the install over.
  }

  try {
    window.open = guarded as typeof window.open
  } catch {
    // A page can freeze `window.open`. Nothing to do but leave it alone.
  }
}
