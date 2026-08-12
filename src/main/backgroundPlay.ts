// Keep playing when the screen goes away — MAIN world.
//
// YouTube's mobile web player stops when the tab is hidden. It is not a browser
// limitation: the page listens for visibilitychange and pauses in the handler.
// Background playback is what the app is for, and the app is where the ads are.
//
// So the page is told the document is always visible. Two halves, and both are
// needed:
//
//   the properties  document.hidden / document.visibilityState, which the page
//                   reads when deciding what to do
//   the event       visibilitychange, which is what actually prompts it to
//                   decide. Faking only the properties leaves the handler
//                   running and pausing on a value it never re-reads.
//
// This is off by default. It changes what YouTube does rather than what it
// shows, which is a different thing from blocking an ad, and the person running
// the extension should be the one who asks for it.
//
// **Not a paywall bypass.** Background playback is a property of the player on
// the page you already loaded; nothing here touches an entitlement, a licence
// or a server. It is the same thing a desktop browser does by simply having
// tabs.

import { LEAVING_EVENT, RETURNED_EVENT } from '../shared/messages.ts'
import { log } from '../shared/log.ts'

const state = { on: false }

/*
 * The lie does not stop while the video floats — that was tried and it cost
 * everything.
 *
 * The reasoning was sound: telling YouTube the page is visible while its video is
 * in a window somewhere else is a contradiction, and the player was resolving it
 * by pulling the video home. So the truth was told for the span of a departure.
 *
 * What the player does with the truth is worse. Told the page is hidden it takes
 * the whole player down: 77 milliseconds after the hand-over the element came back
 * at 0.0 seconds, paused, with webkitSupportsPresentationMode answering no —
 * nothing left to float and nothing left to play. Background playback went with
 * it, which is the feature this extension exists for.
 *
 * So the page keeps believing it is visible, and the player is kept from hearing
 * about presentation changes at all instead — src/main/deafenPlayer.ts, which
 * refuses it the listener rather than arguing with what it does after it fires.
 */

let installed = false

/**
 * Set while the return is being announced, so the swallow lets that one by.
 *
 * The swallow takes every visibilitychange, both directions, and the coming-back
 * one is the page's cue to draw itself again — YouTube never heard it, so it left
 * the player unrendered until something else happened to nudge it. That is the
 * black rectangle on every return that plain YouTube does not have.
 *
 * It cannot simply be let through: the page is being told it is visible the whole
 * time, so "which direction is this" is not a question the page's own state can
 * answer. The other world knows, because it can see the truth, and says so.
 */
let passingThrough = false

/**
 * Swallow the event before the page's own handler sees it — and tell our own
 * side, which was being swallowed with it.
 *
 * stopImmediatePropagation sets a flag on the event, not on a world. Both worlds
 * share one listener list per target, so this call also silenced the ISOLATED
 * world's listener — the one picture-in-picture uses to notice the user leaving.
 * Background playback was switching off automatic PiP, and both are on by
 * default.
 */
function swallow(event: Event): void {
  if (!state.on) return

  if (passingThrough) return
  event.stopImmediatePropagation()
  log('배경재생: visibilitychange 삼킴 → 우리 쪽으로 다시 알림')
  document.dispatchEvent(new CustomEvent(LEAVING_EVENT))
}

function install(): void {
  if (installed) return

  const proto = Object.getOwnPropertyDescriptor.bind(Object)
  const hidden = proto(Document.prototype, 'hidden')
  const visibility = proto(Document.prototype, 'visibilityState')

  // If the shape of the platform is not what we expect, do nothing at all
  // rather than half of it. A page that believes it is visible while the
  // property says otherwise is worse than one that pauses.
  if (!hidden?.get || !visibility?.get) return

  // Defined on `document` itself, shadowing the prototype's accessor. The
  // originals are still called when the toggle is off, so switching it back off
  // restores the real values rather than pinning them to a guess.
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => (state.on ? false : hidden.get?.call(document)),
  })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (state.on ? 'visible' : visibility.get?.call(document)),
  })

  // Capture phase, both targets: the event goes window → document → window, and
  // a handler on either one is enough to pause the video.
  window.addEventListener('visibilitychange', swallow, true)
  document.addEventListener('visibilitychange', swallow, true)

  // The other world tells us the user is actually back; the page is told the same,
  // once, and draws itself.
  document.addEventListener(RETURNED_EVENT, () => {
    passingThrough = true
    try {
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      passingThrough = false
    }
  })

  installed = true
}

/**
 * Turn background playback on or off.
 *
 * Installing is deferred to the first time it is switched on: a user who never
 * asks for it never gets a single redefined property on their document.
 */
export function setBackgroundPlay(on: boolean): void {
  if (on) install()
  state.on = on
}
