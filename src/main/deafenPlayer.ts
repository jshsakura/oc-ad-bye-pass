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
 * The transport controls are ours, and the page may not take them back.
 *
 * `setActionHandler` keeps one registration per action for the whole document and
 * the last caller owns it. YouTube sets its own whenever its player reinitialises,
 * so ours were gone within seconds of any navigation — and ours is the only place
 * this extension is ever *told* that a person pressed pause.
 *
 * Losing them is not cosmetic. Without the telling, background playback has to
 * infer whose pause it was, and the only thing it can look at is
 * `document.hidden` — which is true for the whole time somebody is away, so the
 * engine's stop and a press on the lock screen are the same event to it. It
 * resumed both. That is the video starting itself again after you stopped it.
 *
 * A two-second timer re-registering them was tried and is polling against a page
 * that will always be faster; at the DOM sweep's rate it rebuilt the session
 * faster than iOS would answer for it and left the lock-screen button dead.
 * Refusing the registration is the same trick already used above for the
 * presentation event, and it is exact: the page cannot own a handler it was never
 * allowed to set.
 *
 * Only the four we provide. Anything else the page registers is its own business,
 * and taking it would remove buttons from the lock screen for nothing.
 */
const OURS: ReadonlySet<string> = new Set(['play', 'pause', 'seekbackward', 'seekforward'])

function holdMediaSession(): void {
  const proto = (
    window as unknown as { MediaSession?: { prototype: Record<string, unknown> } }
  ).MediaSession?.prototype
  if (!proto) return
  const native = proto.setActionHandler
  if (typeof native !== 'function') return

  let refused = 0
  proto.setActionHandler = function (this: unknown, action: string, handler: unknown) {
    if (OURS.has(action)) {
      // Said once. The interesting fact is that it happened at all.
      if (refused === 0) log('플레이어의 재생 컨트롤 가로채기를 막았습니다')
      refused += 1
      return
    }
    return (native as (this: unknown, a: string, h: unknown) => unknown).call(this, action, handler)
  }
}

export function deafenPlayer(): void {
  holdMediaSession()
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
