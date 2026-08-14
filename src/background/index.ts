// Service worker. Three jobs only: seed defaults, refresh the filter list, keep stats and the badge.

import type { RuntimeRequest } from '../shared/messages.ts'
import {
  STATS_KEY,
  loadSettings,
  loadStats,
  seedDefaultSettings,
  watchSettings,
  type Stats,
} from '../shared/settings.ts'
import { currentStatus, updateFilters } from './updater.ts'
import { ensureMainWorldScript } from './mainWorld.ts'
import { syncAllowlistRules } from './network.ts'

// --- Badge ---------------------------------------------------------------------
//
// There is no toolbar badge. Every version of one was worse than none: the
// per-tab declarativeNetRequest count climbed on its own on single-page sites
// until it buried the icon, and the cumulative total only ever grew and sat
// there. The count lives in the popup, where it can be read on purpose rather
// than stared at. This clears any badge a previous build left, and turns off
// the per-tab count flag (which persists per-profile) for upgraders.

const HAS_DNR_BADGE =
  typeof chrome.declarativeNetRequest?.setExtensionActionOptions === 'function'

async function clearBadge() {
  if (HAS_DNR_BADGE) {
    try {
      chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: false,
      })
    } catch {
      // Not supported here — nothing to undo.
    }
  }
  await chrome.action.setBadgeText({ text: '' })
}

// --- Stats ---------------------------------------------------------------------
// Writes are serialised so counts from several tabs at once don't clobber each other.

let writeChain: Promise<void> = Promise.resolve()

function bumpStats(patch: { pruned?: number; skipped?: number }): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const stats = await loadStats()
      const next: Stats = {
        pruned: stats.pruned + (patch.pruned ?? 0),
        skipped: stats.skipped + (patch.skipped ?? 0),
        since: stats.since,
      }
      await chrome.storage.local.set({ [STATS_KEY]: next })
    })
    .catch(() => {})
  return writeChain
}

// --- Lifecycle -----------------------------------------------------------------
//
// No periodic alarm. A refresh happens when **a YouTube tab opens** and the
// content script pokes us (`filters:update`, force=false); if the cache is
// fresh the updater returns immediately.
//
// Two reasons the alarm went away:
//   - no point waking the service worker while nobody is watching YouTube
//   - the `alarms` permission disappears entirely (one less install warning)
//
// Not a compatibility call — the Orion API table lists `alarms` as fully
// supported on both macOS and iOS. It is purely "don't wake what needn't wake".
//
// Frequent pokes are cheap: the request is conditional on ETag, so an unchanged
// list ends at a 304.

chrome.runtime.onInstalled.addListener(async () => {
  await seedDefaultSettings()

  const stats = await chrome.storage.local.get(STATS_KEY)
  if (!stats[STATS_KEY]) {
    await chrome.storage.local.set({ [STATS_KEY]: { pruned: 0, skipped: 0, since: Date.now() } })
  }

  void clearBadge()
  void updateFilters(true)
  void loadSettings().then((settings) => syncAllowlistRules(settings.allowlist))
})

// Dynamic rules survive restarts, but the allowlist is the source of truth —
// re-deriving them on every startup costs one storage read and removes a whole
// class of "they drifted apart somehow" bugs.
chrome.runtime.onStartup.addListener(() => {
  void clearBadge()
  void updateFilters()
  void loadSettings().then((settings) => syncAllowlistRules(settings.allowlist))
})

// Only does anything on Safari (it vanishes from the Chrome bundle entirely).
// Called outside onInstalled/onStartup as well, so that a registration which
// failed once gets another chance whenever the worker wakes for any reason.
// If it is already registered this costs a single lookup.
void ensureMainWorldScript()

watchSettings((settings) => {
  void syncAllowlistRules(settings.allowlist)
})

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  switch (message?.type) {
    case 'stats:bump':
      void bumpStats(message).then(() => sendResponse({ ok: true }))
      return true
    case 'filters:update':
      void updateFilters(message.force ?? true).then(sendResponse)
      return true
    case 'filters:status':
      void currentStatus().then(sendResponse)
      return true
    default:
      return false
  }
})
