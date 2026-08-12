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

/** Set by the other world around a presentation call of its own. */
const OURS_ATTR = 'data-oc-abp-ours'

/**
 * Watch the presentation calls. Refuse none of them.
 *
 * Refusing the page's `inline` was tried here and it broke playback outright —
 * `readyState=0 network=2 시간=0.0 버퍼=0`, a player with nothing loaded and
 * nothing drawn. YouTube's player cannot be told no about its own video: denied
 * the state change it asked for, its state machine and the element disagree
 * forever after, and it stops rendering. The repository's own notes said as much
 * about the first attempt at this, in as many words, and it was reintroduced
 * anyway.
 *
 * What is left changes nothing and still answers the question. Every call is
 * logged with the mode and with whose call it is, so the thing that asks for
 * `inline` five seconds into a departure names itself. Knowing that is worth a log
 * line; acting on it cost the video.
 */
function tracePresentation(): void {
  const proto = (
    window as unknown as {
      HTMLVideoElement?: { prototype: Record<string, unknown> }
    }
  ).HTMLVideoElement?.prototype
  if (!proto) return
  const native = proto.webkitSetPresentationMode
  if (typeof native !== 'function') return

  proto.webkitSetPresentationMode = function (this: HTMLVideoElement, mode: string) {
    const root = document.documentElement
    // Whose call this is. The other world tags its own, so an untagged call is
    // the page's — and which of the two asks for `inline` five seconds into a
    // departure is the question this whole file exists to answer.
    const ours = root?.getAttribute(OURS_ATTR) === mode
    log(`표시모드 요청: ${mode} (${ours ? '우리' : '페이지'})`)
    return (native as (this: HTMLVideoElement, mode: string) => unknown).call(this, mode)
  }
}

export function deafenPlayer(): void {
  tracePresentation()

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
