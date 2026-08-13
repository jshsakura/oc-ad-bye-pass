// Who asked for this — ISOLATED world.
//
// Two things in here undo a pause: background playback puts back what the engine
// took (src/isolated/keepPlaying.ts), and the floating-window watch keeps a
// picture-in-picture window from closing on a paused video (src/isolated/pip.ts).
// Both are right about the pause they were written for and both are wrong about
// the same one — the pause a person pressed.
//
// They told the two apart by where the page was: the engine's pause lands with
// the page already hidden, so a pause while hidden was the engine's. That reading
// has a hole exactly the size of the lock screen. The transport controls work
// *because* the page is hidden — pressing pause there is the most deliberate
// pause there is, and it arrived looking precisely like the one to overrule. It
// was overruled, reported from the phone: stop it in Control Centre and it starts
// itself again.
//
// So intent is recorded where it is known rather than inferred where it is not.
// The media-session handler is the one place in this extension that is told a
// person pressed something, and it is one line from here.

/** Set when a person pressed pause somewhere we were told about. */
let userPaused = false

/**
 * A person pressed pause. Nothing may undo it.
 *
 * It stays set until playback actually resumes, rather than expiring on a timer:
 * a pause that is still in force ten minutes later is still the user's pause, and
 * every timeout here would be a guess at how long someone is allowed to mean it.
 */
export function markUserPause(): void {
  userPaused = true
}

/** Playing again, by whatever route. Whatever they meant by pausing is spent. */
export function clearUserPause(): void {
  userPaused = false
}

export function pausedByUser(): boolean {
  return userPaused
}
