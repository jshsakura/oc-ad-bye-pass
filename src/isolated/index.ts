// ISOLATED world 진입점 — document_start.
// 설정을 읽어 스타일시트를 만들고, MAIN world 에 설정을 넘기고, DOM 을 지켜본다.

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
import { bumpStats, listenForPruneReports, sendConfigToMain } from './bridge.ts'

let settings: Settings = DEFAULT_SETTINGS
let rules: ResolvedRules = resolveRules(null, [])

// --- 설정 반영 -----------------------------------------------------------------

function recompute(cache: FilterCache | null) {
  const remote = settings.listEnabled && cache?.url === settings.listUrl ? cache.list : null
  rules = resolveRules(remote, parseCustomRules(settings.customRules))
  applyStylesheet(settings.enabled ? buildStylesheet(rules, settings.toggles) : '')
  sendConfigToMain({
    enabled: settings.enabled,
    videoAds: settings.toggles.videoAds,
    prunePaths: rules.prune,
  })
  sweep()
}

async function refresh() {
  const [nextSettings, cache] = await Promise.all([loadSettings(), loadCache()])
  settings = nextSettings
  recompute(cache)
}

// --- DOM 감시 -------------------------------------------------------------------

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

/** #movie_player 의 class 변화(.ad-showing)는 전용 옵저버로 본다 — 문서 전체 속성 감시는 너무 비싸다 */
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

function start() {
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  // 옵저버가 놓친 상태 변화를 위한 안전망. 하는 일은 querySelector 몇 번이라 부담이 없다.
  setInterval(sweep, 3000)

  listenForPruneReports((count) => bumpStats({ pruned: count }))
  watchSettings((next) => {
    settings = next
    void loadCache().then(recompute)
  })
  watchCache(recompute)

  void refresh()
}

start()
