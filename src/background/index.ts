// 서비스 워커. 하는 일은 셋뿐이다: 기본값 시드, 필터 리스트 주기 갱신, 통계/배지.

import type { RuntimeRequest } from '../shared/messages.ts'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  STATS_KEY,
  loadStats,
  type Stats,
} from '../shared/settings.ts'
import { currentStatus, updateFilters } from './updater.ts'
import { ensureMainWorldScript } from './mainWorld.ts'

const ALARM_NAME = 'filters-update'
const PERIOD_MINUTES = 6 * 60

// --- 배지 ----------------------------------------------------------------------

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

async function setBadge(stats: Stats) {
  const total = stats.pruned + stats.skipped
  await chrome.action.setBadgeBackgroundColor({ color: '#e62117' })
  await chrome.action.setBadgeText({ text: total > 0 ? compact(total) : '' })
}

// --- 통계 ----------------------------------------------------------------------
// 탭 여러 개가 동시에 올려도 값이 뭉개지지 않게 쓰기를 한 줄로 세운다.

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

// --- 수명주기 -------------------------------------------------------------------

function scheduleUpdates(delayInMinutes?: number) {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES, delayInMinutes })
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY)
  if (!stored[SETTINGS_KEY]) await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS })

  const stats = await chrome.storage.local.get(STATS_KEY)
  if (!stats[STATS_KEY]) {
    await chrome.storage.local.set({ [STATS_KEY]: { pruned: 0, skipped: 0, since: Date.now() } })
  }

  scheduleUpdates(1)
  void updateFilters(true)
  void loadStats().then(setBadge)
})

chrome.runtime.onStartup.addListener(() => {
  scheduleUpdates()
  void updateFilters()
  void loadStats().then(setBadge)
})

// Safari 에서만 실제로 일한다 (Chrome 번들에서는 통째로 사라진다).
// onInstalled/onStartup 밖에서도 부르는 이유: 등록이 한 번 실패한 뒤 서비스 워커가
// 다른 이유로 깨어났을 때 다시 시도할 기회를 주기 위해서다. 이미 등록돼 있으면
// 조회 한 번으로 끝난다.
void ensureMainWorldScript()

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void updateFilters()
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
