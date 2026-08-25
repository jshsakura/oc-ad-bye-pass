// Protocol between the MAIN world and the ISOLATED world.
//
// The MAIN world cannot reach chrome.*, so ISOLATED reads the settings and
// hands them over via window.postMessage; pruning counts travel back the other
// way. Page scripts can see the same channel, so `ns` only separates traffic —
// anything that needs trust flows one way only, ISOLATED to MAIN.

export const NS = 'oc-ad-bye-pass'

/**
 * Marker set on documentElement once the MAIN world entry point has run in the
 * page's own world.
 *
 * ISOLATED cannot see the page's window but does share its DOM, so this one
 * attribute answers "did we really reach the page context?" — which is what
 * decides whether Safari falls back to script injection.
 *
 * On the video site that is the same question as "did layer 1 attach", because
 * the hooks always install there. Away from it the entry point installs only
 * the pop-up guard, and the marker means that much and no more.
 */
export const INSTALLED_ATTR = 'data-oc-ad-bye-pass'




/**
 * Marker with the caption picker's outcome for the current video
 * (korean / translated / no-korean / no-captions / set-failed), written by the
 * MAIN world so diagnostics in ISOLATED can read it across the world boundary.
 */
export const CAPTIONS_ATTR = 'data-oc-ad-bye-pass-captions'

/**
 * Marker with the audio-track pin's outcome for the current video, written by
 * the MAIN world so diagnostics in ISOLATED can read it across the boundary.
 * Same arrangement as CAPTIONS_ATTR, and for the same reason: on a phone there
 * is no console to ask.
 */
export const AUDIO_ATTR = 'data-oc-ad-bye-pass-audio'

/** The minimum the MAIN world actually needs to know. */
export interface MainConfig {
  enabled: boolean
  videoAds: boolean
  /**
   * Whether to auto-select captions. The target language is not carried here:
   * the MAIN world reads the browser locale itself (navigator.language), which
   * is the language the user actually browses in.
   */
  autoCaptions: boolean
  /**
   * Whether to pin the audio track to the viewer's language. The language is
   * not carried here either — the MAIN world reads the browser's own list, the
   * same one the caption picker uses.
   */
  audioLanguage: boolean
  prunePaths: string[]
  /** Whether to refuse `window.open` calls that no gesture asked for. */
  popups: boolean
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

export interface PopupBlockedMessage {
  ns: typeof NS
  type: 'popup-blocked'
  /** Where it wanted to go, truncated. For the log only. */
  url: string
}

export type BridgeMessage = ConfigMessage | PrunedMessage | PopupBlockedMessage

const BRIDGE_TYPES = new Set(['config', 'pruned', 'popup-blocked'])

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Partial<BridgeMessage>
  return m.ns === NS && typeof m.type === 'string' && BRIDGE_TYPES.has(m.type)
}

/**
 * How the popup asks a page to start the element picker.
 *
 * Written to `chrome.storage.local`, not sent with `chrome.tabs.sendMessage`.
 * Messaging a tab needs host permission for that tab, and this extension asks
 * for host permissions **optionally** — so the obvious route works only after
 * the user has granted a permission they were never prompted for, and fails
 * silently when they have not. `activeTab` is supposed to cover it; on the
 * WebKit build it is one more thing that is "partially supported", which is the
 * category that has cost this project the most time.
 *
 * Storage needs no permission beyond the one already held, reaches the content
 * script through the same `onChanged` channel every other setting travels on,
 * and behaves the same everywhere.
 *
 * The page checks the URL and the timestamp, so a stale key cannot open a
 * picker on a page nobody asked about.
 */
export interface PickerRequest {
  /** The page that should start picking. */
  url: string
  at: number
}

export const PICKER_KEY = 'pickerRequest'

/** How long a request stays good. Long enough to survive the popup closing. */
export const PICKER_TTL_MS = 5000

/** Runtime messages sent to the background service worker. */
export type RuntimeRequest =
  | { type: 'stats:bump'; pruned?: number; skipped?: number }
  | { type: 'filters:update'; force?: boolean }
  | { type: 'filters:status' }

/** One subscribed list's standing, as the options page shows it. */
export interface ListStatus {
  url: string
  /** The name the list gives itself, once we have fetched it at least once. */
  name: string | null
  version: number | null
  fetchedAt: number | null
  error: string | null
  dropped: number
  /** False when the user switched this subscription off. */
  enabled: boolean
}

/**
 * The filter layer's standing, rolled up.
 *
 * `lists` is the truth and the options page renders it row by row. The four
 * flattened fields above it answer "is anything wrong" for the callers that
 * only want that — the popup's diagnostics and the update button's one-line
 * result — and are derived, never stored.
 */
export interface FilterStatus {
  ok: boolean
  /** Newest version across the lists, for a one-line answer. */
  version: number | null
  /** Newest successful fetch across the lists. */
  fetchedAt: number | null
  source: 'remote' | 'bundled'
  /** The first error any list reported, or null when they all succeeded. */
  error: string | null
  /** Total entries validation threw away, across every list. */
  dropped: number
  lists: ListStatus[]
}
