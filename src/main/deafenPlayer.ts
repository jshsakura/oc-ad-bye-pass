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
const HOLD_ATTR = 'data-oc-abp-hold'

/**
 * Refuse the page's request to put the video back in the page.
 *
 * Three departures in one device log opened a window and lost it again after
 * 5.02, 5.03 and 5.05 seconds, with the video still playing and nothing of ours
 * in between — no restore, no button, nothing this extension logs. Something else
 * asks for `inline` five seconds in, and the only two candidates are the page and
 * the platform.
 *
 * This tells them apart by taking the page's ask away. If the window still falls
 * after five seconds, nothing in the page did it and there is nothing here to fix;
 * if it stays up, that was the whole bug.
 *
 * Narrow on purpose. It only refuses `inline`, only while the other world says a
 * window of its own is standing, and that flag is raised by the presentation mode
 * actually changing and lowered the moment the user is back. A refusal that
 * outlived its departure would leave the page unable to return the video to itself
 * for the rest of its life, which is how an earlier attempt at this went wrong.
 */
function holdPresentation(): void {
  const proto = (
    window as unknown as {
      HTMLVideoElement?: { prototype: Record<string, unknown> }
    }
  ).HTMLVideoElement?.prototype
  if (!proto) return
  const native = proto.webkitSetPresentationMode
  if (typeof native !== 'function') return

  proto.webkitSetPresentationMode = function (this: HTMLVideoElement, mode: string) {
    if (mode === 'inline' && document.documentElement?.hasAttribute(HOLD_ATTR)) {
      log('페이지가 작은 창을 접으려 함 — 거절')
      return
    }
    return (native as (this: HTMLVideoElement, mode: string) => unknown).call(this, mode)
  }
}

export function deafenPlayer(): void {
  holdPresentation()

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
