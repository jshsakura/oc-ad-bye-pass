// Relay: ISOLATED to and from MAIN, and ISOLATED to the background.

import { NS, isBridgeMessage, type MainConfig, type RuntimeRequest } from '../shared/messages.ts'

export function sendConfigToMain(config: MainConfig): void {
  window.postMessage({ ns: NS, type: 'config', config }, '*')
}

export function listenForPruneReports(onPruned: (count: number) => void): void {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return
      if (!isBridgeMessage(event.data) || event.data.type !== 'pruned') return
      onPruned(event.data.count)
    },
    false,
  )
}

/**
 * Blocked pop-ups, reported from the MAIN world.
 *
 * Batched by the caller like everything else — a page that fires a pop-under in
 * a loop would otherwise wake the service worker on every attempt, which is a
 * denial of service the ad network gets for free.
 */
export function listenForBlockedPopups(onBlocked: (count: number) => void): void {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return
      if (!isBridgeMessage(event.data) || event.data.type !== 'popup-blocked') return
      onBlocked(1)
    },
    false,
  )
}

// Stats are batched. One message per blocked ad would keep waking the service worker.
let pendingPruned = 0
let pendingSkipped = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  flushTimer = null
  if (!pendingPruned && !pendingSkipped) return
  const message: RuntimeRequest = { type: 'stats:bump', pruned: pendingPruned, skipped: pendingSkipped }
  pendingPruned = 0
  pendingSkipped = 0
  try {
    // If the worker is asleep or the extension just reloaded this simply fails — it's only stats.
    void chrome.runtime.sendMessage(message).catch(() => {})
  } catch {
    // Context invalidated (right after an extension update) — ignore.
  }
}

export function bumpStats(patch: { pruned?: number; skipped?: number }): void {
  pendingPruned += patch.pruned ?? 0
  pendingSkipped += patch.skipped ?? 0
  if (flushTimer === null) flushTimer = setTimeout(flush, 3000)
}

/**
 * Signal "a YouTube page opened". The background only fetches if the cache is stale.
 *
 * Why this instead of a periodic alarm:
 *   - no reason to wake the service worker while nobody is watching YouTube
 *   - the `alarms` permission disappears entirely (one less install warning)
 *
 * There is no hammering risk: the updater enforces a minimum interval, so a
 * hundred tab opens still amount to one network request per interval. That is
 * why `force` is passed explicitly as false — the background defaults it to true.
 */
export function requestFreshFilters(): void {
  try {
    void chrome.runtime.sendMessage({ type: 'filters:update', force: false }).catch(() => {})
  } catch {
    // Context invalidated — ignore.
  }
}
