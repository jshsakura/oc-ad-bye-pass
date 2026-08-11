// ISOLATED world entry point — document_start.
// Reads the settings, builds the stylesheet, hands the settings to the MAIN
// world, and watches the DOM.

import { buildStylesheet, resolveRules, type ResolvedRules } from '../shared/filterlist.ts'
import { loadCache, watchCache, type FilterCache } from '../shared/cache.ts'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseCustomRules,
  watchSettings,
  type Settings,
} from '../shared/settings.ts'
import { applyStylesheet, clickCloseButtons, dismissAdblockNag } from './cosmetic.ts'
import { handleAdState } from './player.ts'
import {
  bumpStats,
  listenForPruneReports,
  requestFreshFilters,
  sendConfigToMain,
} from './bridge.ts'
import { stopWatchingAppBannerHints, watchAppBannerHints } from './appbanner.ts'
import { injectMainWorldFallback } from './injectMain.ts'

let settings: Settings = DEFAULT_SETTINGS
let rules: ResolvedRules = resolveRules(null, [])

// --- Applying settings ---------------------------------------------------------

function recompute(cache: FilterCache | null) {
  const remote = settings.listEnabled && cache?.url === settings.listUrl ? cache.list : null
  rules = resolveRules(remote, parseCustomRules(settings.customRules))
  applyStylesheet(settings.enabled ? buildStylesheet(rules, settings.toggles) : '')
  sendConfigToMain({
    enabled: settings.enabled,
    videoAds: settings.toggles.videoAds,
    prunePaths: rules.prune,
  })
  // The smart app banner comes from a <meta> tag, beyond the reach of a stylesheet — its own observer handles it.
  if (settings.enabled && settings.toggles.appPromo) watchAppBannerHints(onBannerRemoved)
  else stopWatchingAppBannerHints()
  sweep()
}

async function refresh() {
  const [nextSettings, cache] = await Promise.all([loadSettings(), loadCache()])
  settings = nextSettings
  recompute(cache)
}

// --- Watching the DOM ----------------------------------------------------------

let scheduled = false
let playerObserver: MutationObserver | null = null
let observedPlayer: Element | null = null

function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    sweep()
  })
}

/** A dedicated observer watches #movie_player's class (.ad-showing) — watching attributes document-wide is far too expensive. */
function attachPlayerObserver() {
  const player = document.querySelector('#movie_player')
  if (!player || player === observedPlayer) return
  playerObserver?.disconnect()
  playerObserver = new MutationObserver(schedule)
  playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
  observedPlayer = player
}

function sweep() {
  if (!settings.enabled) return
  attachPlayerObserver()

  let acted = 0
  if (settings.toggles.fullscreenAds) acted += clickCloseButtons(rules.click)
  if (settings.toggles.antiAdblockNag) acted += dismissAdblockNag()
  if (settings.toggles.playerFallback) acted += handleAdState()
  if (acted) bumpStats({ skipped: acted })
}

function onBannerRemoved(count: number) {
  bumpStats({ skipped: count })
}

function start() {
  // Only does anything when the Safari MAIN world registration failed. Called
  // before everything else — layer 1 installed late is layer 1 wasted.
  // (This call disappears from the Chrome bundle.)
  injectMainWorldFallback()

  // Block first, ask the settings later. The smart app banner is drawn during
  // parsing, so waiting for a storage round trip (hundreds of ms) is already too
  // late. Someone who turned the extension off briefly seeing less is better
  // than someone who left it on seeing the banner — the same principle as the
  // stylesheet default.
  watchAppBannerHints(onBannerRemoved)

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  // Safety net for state changes the observer missed. It is a handful of querySelector calls, so the cost is nil.
  setInterval(sweep, 3000)

  // Tell the background to refresh if the rules are stale. This stands in for a
  // periodic alarm — the background enforces its own minimum interval, so
  // calling on every page load is fine.
  requestFreshFilters()

  listenForPruneReports((count) => bumpStats({ pruned: count }))
  watchSettings((next) => {
    settings = next
    void loadCache().then(recompute)
  })
  watchCache(recompute)

  void refresh()
}

start()
