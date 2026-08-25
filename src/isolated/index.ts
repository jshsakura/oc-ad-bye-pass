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

import { log } from '../shared/log.ts'
import { buildStylesheet, resolveRules, type ResolvedRules } from '../shared/filterlist.ts'
import { listsFrom, loadCaches, watchCaches, type FilterCaches } from '../shared/cache.ts'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseCustomRules,
  watchSettings,
  type Settings,
} from '../shared/settings.ts'
import { isAllowlisted, siteKindFor, type SiteKind } from '../shared/sites.ts'
import { translateComments } from './comments.ts'
import { applyStylesheet, clickCloseButtons, dismissAdblockNag } from './cosmetic.ts'
import { noteTranslated, reportDiagnostics, watchCaptionOutcome } from './diagnostics.ts'
import { disablePictureInPicture, enablePictureInPicture } from './pip.ts'
import { handleAdState } from './player.ts'
import {
  bumpStats,
  listenForBlockedPopups,
  listenForPruneReports,
  requestFreshFilters,
  sendConfigToMain,
} from './bridge.ts'
import { stopWatchingAppBannerHints, watchAppBannerHints } from './appbanner.ts'
import { injectMainWorldFallback } from './injectMain.ts'
import { startPicker, stopPicker } from './picker.ts'
import { PICKER_KEY, PICKER_TTL_MS, type PickerRequest } from '../shared/messages.ts'

const SITE: SiteKind = siteKindFor(location.hostname)
const IS_YOUTUBE = SITE === 'youtube'

let settings: Settings = DEFAULT_SETTINGS
let rules: ResolvedRules = resolveRules([], [])
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
  stopPicker()
  // The MAIN world cannot be unloaded, so it is told to stand down instead.
  // Sent on every site, not just the video one: the pop-up guard lives there
  // too now, and a site the user switched off has to get its windows back.
  sendConfigToMain({
    enabled: false,
    videoAds: false,
    autoCaptions: false,
    audioLanguage: false,
    prunePaths: rules.prune,
    popups: false,
  })
}

function recompute(caches: FilterCaches) {
  standDown = isAllowlisted(location.hostname, settings.allowlist)
  const active = settings.enabled && !standDown

  if (!active) {
    detach()
    return
  }

  attachObservers()

  const remotes = settings.listEnabled
    ? listsFrom(
        caches,
        settings.lists.filter((sub) => sub.enabled).map((sub) => sub.url),
      )
    : []
  rules = resolveRules(remotes, parseCustomRules(settings.customRules))
  applyStylesheet(buildStylesheet(rules, settings.toggles, SITE, location.hostname, settings.lang))

  sendConfigToMain({
    enabled: true,
    videoAds: settings.toggles.videoAds,
    autoCaptions: settings.toggles.autoCaptions,
    audioLanguage: settings.toggles.audioLanguage,
    prunePaths: rules.prune,
    popups: settings.toggles.popups,
  })

  // Away from the video site the MAIN world is only wanted for the pop-up
  // guard, so the injection fallback waits until the settings say it is on.
  // On the video site it cannot wait — a hook installed after the first parse
  // is a hook that missed the pre-roll — which is why that call is in `start`.
  //
  // On Chrome this costs nothing either way: the registered MAIN script has
  // already run and the fallback returns immediately. It is WebKit, where
  // `world: "MAIN"` is ignored, that actually injects here.
  if (!IS_YOUTUBE && settings.toggles.popups) injectMainWorldFallback()

  if (IS_YOUTUBE) {
    // The smart app banner comes from a <meta> tag, beyond the reach of a stylesheet.
    if (settings.toggles.appPromo) watchAppBannerHints(onBannerRemoved)
    else stopWatchingAppBannerHints()

    // Just the button — a shortcut to the browser's own picture-in-picture.
    // Everything that tried to make leaving automatic is gone; it never worked
    // on this platform and cost more than it saved.
    if (settings.toggles.pipButton) enablePictureInPicture({ button: true })
    else disablePictureInPicture()

  }

  sweep()

  // Written after the layers are in place, so what it reports is the state the
  // user is actually in. Cheap enough to redo on every recompute.
  reportDiagnostics()
  if (IS_YOUTUBE) watchCaptionOutcome()
}

async function refresh() {
  const [nextSettings, caches] = await Promise.all([loadSettings(), loadCaches()])
  settings = nextSettings
  recompute(caches)
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

  // Not counted with the above: pressing a translate control is a convenience,
  // not an ad that was skipped, and the popup's number means blocked ads.
  if (settings.toggles.commentTranslate) noteTranslated(translateComments())
}

function onBannerRemoved(count: number) {
  bumpStats({ skipped: count })
}

function start() {
  // Only the top document's start is worth a line — subframe logs are never
  // reported (see reportDiagnostics) and would only be dead writes here.
  if (window.top === window) log(`시작: ${SITE}`)
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

  // A refused window is an ad that never loaded, so it counts where the others
  // do. Listened for on every site, because that is where pop-unders are.
  listenForBlockedPopups((count) => bumpStats({ skipped: count }))

  // The popup asks for the picker by writing a key; see PickerRequest.
  //
  // Only the top document answers. Every frame on the page runs this listener,
  // and a picker opening inside an ad iframe as well as on the page is two
  // overlays fighting over the same clicks.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[PICKER_KEY] || window.top !== window) return
    const request = changes[PICKER_KEY].newValue as PickerRequest | undefined
    if (!request || request.url !== location.href) return
    if (Date.now() - request.at > PICKER_TTL_MS) return
    if (!settings.enabled || standDown) return
    startPicker(settings.lang)
  })

  watchSettings((next) => {
    settings = next
    void loadCaches().then(recompute)
  })
  watchCaches(recompute)

  void refresh()
}

start()
