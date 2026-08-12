// Stop the player putting the video back in the page while the user is away.
//
// The window opens on the way out and YouTube drags it back a few seconds later —
// measured on the device at five seconds, still playing, page still away:
//
//   56:40.272  모드 바뀜 → picture-in-picture (재생=true 시간=3.4)
//   56:45.303  모드 바뀜 → inline (재생=true 시간=8.3)
//
// Hiding the change from the player was tried and cost more than it saved: it is a
// state machine fed by those events, and blinded it leaves its own card on screen
// over a page you have come back to. What is wanted is narrower — not to keep it
// uninformed, but to keep it from doing this one thing at this one time.
//
// So the call itself is refused. That has to happen in the page's world, because
// this is the page's own copy of the method: a property defined from the
// extension's world is not the one YouTube's script sees. Hence a file in MAIN,
// reading a flag off the document element, which is the one thing both worlds
// share.
//
// Only 'inline', only while the flag is up, and the flag is only up between
// leaving and coming back. Everything else is passed through untouched, including
// every call the user's own tap makes.

import { HOLD_ATTR } from '../shared/messages.ts'

export function holdPresentation(): void {
  const proto = HTMLVideoElement.prototype as unknown as {
    webkitSetPresentationMode?: (mode: string) => void
  }
  const native = proto.webkitSetPresentationMode
  if (typeof native !== 'function') return

  proto.webkitSetPresentationMode = function (this: HTMLVideoElement, mode: string) {
    if (mode === 'inline' && document.documentElement?.hasAttribute(HOLD_ATTR)) {
      // Refused, and silently: throwing here would land inside YouTube's own code.
      return
    }
    return native.call(this, mode)
  }
}
