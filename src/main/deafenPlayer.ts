// Keep the player from listening for the thing it cancels — MAIN world.
//
// YouTube cancels picture-in-picture by reacting to `webkitpresentationmodechanged`
// on the video. Stopping the event was tried and loses a race that cannot be won:
// listeners on the same element run in registration order, not capture-then-bubble,
// so if YouTube's handler was attached before ours, ours stopping the event stops
// nothing — theirs has already run.
//
// So the registration is refused instead. The page cannot listen for an event it
// never subscribed to, whatever order anything attached in. This is the pattern
// uBlock Origin ships as `addEventListener-defuser`, aimed at one event type on one
// kind of element.
//
// The extension's own listeners are untouched: they are added from the other world,
// which has its own copy of these prototypes. That is the same isolation that makes
// this file necessary in the first place — the page's `addEventListener` is not the
// one an extension sees.

import { log } from '../shared/log.ts'

/** Only this one, and only on videos. A blanket refusal would break the page. */
const DEAFENED = 'webkitpresentationmodechanged'

/**
 * Set by the other world while a window it opened is still meant to be up.
 *
 * An attribute rather than a message, because the two worlds share the document
 * and nothing else reliably — and because it has to be readable synchronously,
 * inside a call this is deciding whether to pass on.
 */

/*
 * What used to be here: a wrapper on `webkitSetPresentationMode` that logged every
 * call and, for a few releases, refused the page's `inline`.
 *
 * The refusal broke playback outright and was removed. The wrapper that only
 * logged was kept for one more release and is removed too — playback stayed
 * broken, and a prototype of the page's own video element replaced for the sake
 * of a log line is not a thing to leave in while that is unexplained. What it was
 * there to learn is not worth a page that will not play.
 */

export function deafenPlayer(): void {

  const proto = EventTarget.prototype
  const native = proto.addEventListener
  if (typeof native !== 'function') return

  let refused = 0

  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === DEAFENED && this instanceof HTMLVideoElement) {
      // Said once. It is a hot path and the interesting fact is that it happened
      // at all, not how many times.
      if (refused === 0) log('플레이어의 표시 모드 감시를 막았습니다')
      refused += 1
      return
    }
    return native.call(this, type, listener, options)
  }
}
