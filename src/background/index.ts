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
// Two ways to show the count, picked by what the browser supports:
//
//   Chrome/Edge — `displayActionCountAsBadgeText` lets declarativeNetRequest
//   drive the badge itself. It counts *blocked requests on the current tab* and
//   updates live as they happen, on every site — which is the whole point: the
//   old cumulative badge only ever moved on YouTube (the only place stats:bump
//   fires), so on an ordinary page it stayed empty while ads were being blocked
//   by the hundred. Allow / allowAllRequests rules do not count, so a site the
//   user switched off shows nothing.
//
//   Orion/Safari — no declarativeNetRequest at all, so nothing to count from the
//   network side. There we fall back to the cumulative pruned+skipped total,
//   which is exactly the YouTube activity those targets do have.
//
// Red ground, white text — legible on either theme, and the colour of "stopped".

const HAS_DNR_BADGE =
  typeof chrome.declarativeNetRequest?.setExtensionActionOptions === 'function'

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

async function paintBadgeChrome() {
  await chrome.action.setBadgeBackgroundColor({ color: '#e62117' })
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' })
}

/** Let declarativeNetRequest own the badge — a live, per-tab blocked count. */
function enableLiveBadge() {
  if (!HAS_DNR_BADGE) return
  try {
    chrome.declarativeNetRequest.setExtensionActionOptions({
      displayActionCountAsBadgeText: true,
    })
  } catch {
    // Older builds may lack it despite the type — the manual path still runs.
  }
}

async function setBadge(stats: Stats) {
  await paintBadgeChrome()
  // When the network layer drives the badge, don't also stamp a global total —
  // a manual setBadgeText would shadow the per-tab count on tabs with no blocks.
  if (HAS_DNR_BADGE) return
  const total = stats.pruned + stats.skipped
  await chrome.action.setBadgeText({ text: total > 0 ? compact(total) : '' })
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
      await setBadge(next)
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

  enableLiveBadge()
  void updateFilters(true)
  void loadStats().then(setBadge)
  void loadSettings().then((settings) => syncAllowlistRules(settings.allowlist))
})

// Dynamic rules survive restarts, but the allowlist is the source of truth —
// re-deriving them on every startup costs one storage read and removes a whole
// class of "they drifted apart somehow" bugs.
chrome.runtime.onStartup.addListener(() => {
  enableLiveBadge()
  void updateFilters()
  void loadStats().then(setBadge)
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
