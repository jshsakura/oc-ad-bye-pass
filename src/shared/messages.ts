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
 * Marker with the caption picker's outcome for the current video
 * (korean / translated / no-korean / no-captions / set-failed), written by the
 * MAIN world so diagnostics in ISOLATED can read it across the world boundary.
 */
export const CAPTIONS_ATTR = 'data-oc-ad-bye-pass-captions'

/** The minimum the MAIN world actually needs to know. */
export interface MainConfig {
  enabled: boolean
  videoAds: boolean
  /** UI language to pick captions in, or null when the toggle is off. */
  captionsLang: string | null
  prunePaths: string[]
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
