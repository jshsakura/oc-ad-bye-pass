// Protocol between the MAIN world and the ISOLATED world.
//
// The MAIN world cannot reach chrome.*, so ISOLATED reads the settings and
// hands them over via window.postMessage; pruning counts travel back the other
// way. Page scripts can see the same channel, so `ns` only separates traffic —
// anything that needs trust flows one way only, ISOLATED to MAIN.

export const NS = 'oc-ad-bye-pass'

/**
 * Marker set on documentElement once the MAIN world hooks are installed.
 *
 * ISOLATED cannot see the page's window but does share its DOM, so this one
 * attribute answers "did layer 1 really attach in the page context?" — which
 * is what decides whether Safari falls back to script injection.
 */
export const INSTALLED_ATTR = 'data-oc-ad-bye-pass'

/**
 * "The user is leaving", passed from MAIN to ISOLATED as a DOM event.
 *
 * Background playback swallows `visibilitychange` with stopImmediatePropagation
 * so the page never pauses itself. That flag lives on the event rather than on a
 * world, and both worlds share one listener list per target — so it silenced the
 * extension's own listener too, and picture-in-picture, which waits for exactly
 * that event, never heard the user leave. Two features on by default, one
 * quietly cancelling the other.
 *
 * So MAIN re-announces it under a private name after swallowing it. A DOM event
 * rather than postMessage because it has to arrive on the same tick: iOS stops
 * running the page within a frame of the app going away, and a message that
 * lands in a later task lands after everything is over.
 */
export const LEAVING_EVENT = 'oc-ad-bye-pass:leaving'

/**
 * Set on the document element while the user is away with the video floating.
 *
 * The page's own `webkitSetPresentationMode('inline')` is refused while it is up —
 * see src/main/holdPresentation.ts. An attribute rather than a message because
 * both worlds share the DOM and nothing else, and because it has to be readable
 * synchronously inside a call the page is making right now.
 */
export const HOLD_ATTR = 'data-oc-abp-hold'

/** The minimum the MAIN world actually needs to know. */
export interface MainConfig {
  enabled: boolean
  videoAds: boolean
  prunePaths: string[]
  /** Keep the page believing it is visible, so the player does not pause. */
  backgroundPlay: boolean
}

export interface ConfigMessage {
  ns: typeof NS
  type: 'config'
  config: MainConfig
}

export interface PrunedMessage {
  ns: typeof NS
  type: 'pruned'
  count: number
  /** Where it was pruned, for debugging (json-parse / fetch / xhr / global). */
  source: string
}

export type BridgeMessage = ConfigMessage | PrunedMessage

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Partial<BridgeMessage>
  return m.ns === NS && (m.type === 'config' || m.type === 'pruned')
}

/** Runtime messages sent to the background service worker. */
export type RuntimeRequest =
  | { type: 'stats:bump'; pruned?: number; skipped?: number }
  | { type: 'filters:update'; force?: boolean }
  | { type: 'filters:status' }

export interface FilterStatus {
  ok: boolean
  version: number | null
  fetchedAt: number | null
  source: 'remote' | 'bundled'
  error: string | null
  dropped: number
}
