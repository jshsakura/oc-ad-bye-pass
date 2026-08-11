// ISOLATED world entry point — document_start, on every site.
//
// Two things decide what this file does, both settled on the first line:
//
//   Which site is this?   YouTube gets all three layers. Everywhere else gets
//                         generic cosmetic rules and nothing more — no player
//                         logic, no app-banner observer, no anti-nag handling.
//   Are we welcome here?  If the user switched us off for this host we detach
//                         completely: no stylesheet, no observers, no timers.
//
// Injecting on every site means every cost is paid on every page, so the
// off-YouTube path deliberately stays as thin as it can be.

import { buildStylesheet, resolveRules, type ResolvedRules } from '../shared/filterlist.ts'
import { loadCache, watchCache, type FilterCache } from '../shared/cache.ts'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseCustomRules,
  watchSettings,
  type Settings,
} from '../shared/settings.ts'
import { isAllowlisted, siteKindFor, type SiteKind } from '../shared/sites.ts'
import { applyStylesheet, clickCloseButtons, dismissAdblockNag } from './cosmetic.ts'
import { reportDiagnostics } from './diagnostics.ts'
import { bindMediaSession, unbindMediaSession } from './mediaSession.ts'
import { disablePictureInPicture, enablePictureInPicture } from './pip.ts'
import { handleAdState } from './player.ts'
import {
  bumpStats,
  listenForPruneReports,
  requestFreshFilters,
  sendConfigToMain,
} from './bridge.ts'
import { stopWatchingAppBannerHints, watchAppBannerHints } from './appbanner.ts'
import { injectMainWorldFallback } from './injectMain.ts'

const SITE: SiteKind = siteKindFor(location.hostname)
const IS_YOUTUBE = SITE === 'youtube'

let settings: Settings = DEFAULT_SETTINGS
let rules: ResolvedRules = resolveRules(null, [])
/** Set once the user's allowlist is known. Until then we act, per the block-first rule. */
let standDown = false

/** Everything that has to be undone when the user switches this site off. */
let domObserver: MutationObserver | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null
let playerObserver: MutationObserver | null = null
let observedPlayer: Element | null = null

// --- Applying settings ---------------------------------------------------------

function detach() {
  applyStylesheet('')
  stopWatchingAppBannerHints()
  domObserver?.disconnect()
  domObserver = null
  playerObserver?.disconnect()
  playerObserver = null
  observedPlayer = null
  if (sweepTimer !== null) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  disablePictureInPicture()
  unbindMediaSession()
  // Layer 1 lives in the other world and cannot be unloaded, so it is told to stand down.
  if (IS_YOUTUBE) {
    sendConfigToMain({ enabled: false, videoAds: false, prunePaths: rules.prune, backgroundPlay: false })
  }
}

function recompute(cache: FilterCache | null) {
  standDown = isAllowlisted(location.hostname, settings.allowlist)
  const active = settings.enabled && !standDown

  if (!active) {
    detach()
    return
  }

  attachObservers()

  const remote = settings.listEnabled && cache?.url === settings.listUrl ? cache.list : null
  rules = resolveRules(remote, parseCustomRules(settings.customRules))
  applyStylesheet(buildStylesheet(rules, settings.toggles, SITE))

  if (IS_YOUTUBE) {
    sendConfigToMain({
      enabled: true,
      videoAds: settings.toggles.videoAds,
      prunePaths: rules.prune,
      backgroundPlay: settings.toggles.backgroundPlay,
    })
    // The smart app banner comes from a <meta> tag, beyond the reach of a stylesheet.
    if (settings.toggles.appPromo) watchAppBannerHints(onBannerRemoved)
    else stopWatchingAppBannerHints()

    // PiP adds a control rather than removing one, so it only runs when asked.
    if (settings.toggles.pictureInPicture) enablePictureInPicture()
    else disablePictureInPicture()

    // The transport controls are the way back once iOS has stopped the page.
    // Bound under the same setting as background playback, since that is the
    // problem it belongs to.
    if (settings.toggles.backgroundPlay) bindMediaSession()
    else unbindMediaSession()
  }

  sweep()

  // Written after the layers are in place, so what it reports is the state the
  // user is actually in. Cheap enough to redo on every recompute.
  reportDiagnostics()
}

async function refresh() {
  const [nextSettings, cache] = await Promise.all([loadSettings(), loadCache()])
  settings = nextSettings
  recompute(cache)
}

// --- Watching the DOM ----------------------------------------------------------

let scheduled = false

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

/**
 * Off YouTube there is nothing for a sweep to do — the work it drives (close
 * buttons, the ad-block nag, the player fallback) is all YouTube-specific, and
 * hiding is handled by the stylesheet alone. So no observer and no timer run
 * there: on every other site this extension costs one stylesheet and no
 * recurring work at all.
 */
function attachObservers() {
  if (!IS_YOUTUBE || domObserver) return

  domObserver = new MutationObserver(schedule)
  domObserver.observe(document.documentElement, { childList: true, subtree: true })
  // Safety net for state changes the observer missed. It is a handful of querySelector calls, so the cost is nil.
  sweepTimer = setInterval(sweep, 3000)
}

function sweep() {
  if (!IS_YOUTUBE || !settings.enabled || standDown) return
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
  if (IS_YOUTUBE) {
    // Runs whenever layer 1 has not marked itself installed — which covers the
    // registration failing outright, and the case that actually bit: a browser
    // ignoring world:"MAIN" and running main.js in this world instead, where
    // hooking JSON.parse reaches nobody. Called before everything else, because
    // layer 1 installed late is layer 1 wasted.
    injectMainWorldFallback()

    // Block first, ask the settings later. The smart app banner is drawn during
    // parsing, so waiting for a storage round trip (hundreds of ms) is already
    // too late. Someone who turned the extension off briefly seeing less is
    // better than someone who left it on seeing the banner — the same principle
    // as the stylesheet default.
    watchAppBannerHints(onBannerRemoved)

    attachObservers()

    // Tell the background to refresh if the rules are stale. This stands in for
    // a periodic alarm — the background enforces its own minimum interval, so
    // calling on every page load is fine.
    requestFreshFilters()

    listenForPruneReports((count) => bumpStats({ pruned: count }))
  }

  watchSettings((next) => {
    settings = next
    void loadCache().then(recompute)
  })
  watchCache(recompute)

  void refresh()
}

start()
