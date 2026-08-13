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

/*
 * Refusing the page its own `setActionHandler` was tried here and taken out.
 *
 * It is exact and it works on paper — the page cannot own a handler it was never
 * allowed to set — and on the device leaving stopped carrying the sound and
 * coming back gave an endless spinner. Every change this week that reached into
 * the page to take something away from the player has done that, without
 * exception, and this was the fourth.
 *
 * Ours are re-registered on a timer instead (src/isolated/mediaSession.ts). It is
 * polling and it looks like polling; it is also the only arrangement measured to
 * keep both halves working at once.
 */

/**
 * The transport controls are ours, and the page may not take them back.
 *
 * setActionHandler keeps one registration per action for the whole document and
 * the last caller wins. YouTube sets its own whenever its player reinitialises,
 * so ours vanish within seconds of any navigation — and ours is the only place
 * this extension is told a person pressed pause. Without it, background playback
 * has nothing but document.hidden, true the entire time you are away, so it
 * resumes the pause you pressed on the lock screen exactly like the engine's.
 *
 * Blamed once for breaking playback, but that release also had background
 * playback listening on an empty reserve <video> (fixed later); the breakage was
 * most likely that. Re-tested clean: refuse the page the four actions we provide.
 */
const HELD: ReadonlySet<string> = new Set(['play', 'pause', 'seekbackward', 'seekforward'])

function holdMediaSession(): void {
  const proto = (window as unknown as { MediaSession?: { prototype: Record<string, unknown> } })
    .MediaSession?.prototype
  if (!proto) return
  const native = proto.setActionHandler
  if (typeof native !== 'function') return

  let refused = 0
  proto.setActionHandler = function (this: unknown, action: string, handler: unknown) {
    if (HELD.has(action)) {
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
