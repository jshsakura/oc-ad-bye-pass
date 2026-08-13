// The one decision background playback makes, as a pure state machine — ISOLATED.
//
// "나갈 때 소리 유지" reduces to a single hard question: a <video> just fired
// `pause` while the page is hidden — put it back, or leave it? On iPhone the
// engine's own stop (the app went to the background) and a person's press on the
// lock screen arrive the same way: both while hidden, both after playing. The
// media-session handler that would say which is *the user's* is one the site keeps
// taking back, so it cannot be relied on.
//
// The distinction that survives without it is not *who* but *how many times this
// absence*. The engine stops once as the app backgrounds; on this browser the page
// keeps running, so once it is put back it stays. So the first pause of an absence
// is the engine's and is resumed; every pause after that is deliberate and is
// left. Coming back to the front arms the next absence.
//
// It is a state machine and nothing else here touches the DOM, so it runs in node
// and the iPhone sequence can be played out in a test rather than on a phone.

/** A pause landing more than this after playback is stale — not the departure's. */
export const ENGINE_PAUSE_GRACE_MS = 1400

export interface ResumeState {
  /** True while the page is hidden. */
  hidden: boolean
  /** Whether this absence's one resume has already been spent. */
  spent: boolean
  /** When the video was last known to be advancing (ms epoch). */
  lastPlayingAt: number
}

export function initialResumeState(): ResumeState {
  return { hidden: false, spent: false, lastPlayingAt: 0 }
}

export type ResumeEvent =
  | { type: 'hidden' }
  | { type: 'visible' }
  | { type: 'playing'; at: number }
  /** The video fired `pause`. `at` is now. */
  | { type: 'pause'; at: number }

/**
 * Fold an event into the state, and say whether this event means "put it back".
 *
 * `resume` is only ever true for a `pause` event, and only for the first
 * qualifying one of an absence.
 */
export function reduceResume(
  state: ResumeState,
  event: ResumeEvent,
): { state: ResumeState; resume: boolean } {
  switch (event.type) {
    case 'visible':
      // Back in front. Whatever pauses now are the user's, and the next absence
      // is armed again.
      return { state: { ...state, hidden: false, spent: false }, resume: false }

    case 'hidden':
      return { state: { ...state, hidden: true }, resume: false }

    case 'playing':
      return { state: { ...state, lastPlayingAt: event.at }, resume: false }

    case 'pause': {
      // Visible → the player is in front of them; the pause is theirs.
      if (!state.hidden) return { state, resume: false }
      // Already spent this absence → a later pause → deliberate. This is the whole
      // of the "무한재생" fix: not who paused it, but that it is the second time.
      if (state.spent) return { state, resume: false }
      // Stale — the video was not playing just before this, so nothing to keep.
      if (event.at - state.lastPlayingAt > ENGINE_PAUSE_GRACE_MS) {
        return { state, resume: false }
      }
      return { state: { ...state, spent: true }, resume: true }
    }
  }
}
