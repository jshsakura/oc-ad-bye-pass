// 서비스 워커. 하는 일은 셋뿐이다: 기본값 시드, 필터 리스트 주기 갱신, 통계/배지.

import type { RuntimeRequest } from '../shared/messages.ts'
import {
  STATS_KEY,
  loadStats,
  seedDefaultSettings,
  type Stats,
} from '../shared/settings.ts'
import { currentStatus, updateFilters } from './updater.ts'
import { ensureMainWorldScript } from './mainWorld.ts'

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
//
// 주기 알람은 쓰지 않는다. 갱신은 **유튜브 탭이 열릴 때** 콘텐츠 스크립트가 찔러서
// 일어나고(`filters:update`, force=false), 낡지 않았으면 updater 가 바로 돌려보낸다.
//
// 알람을 뺀 이유 둘:
//   - 유튜브를 안 보는 동안 서비스 워커를 깨울 이유가 없다
//   - `alarms` 권한이 통째로 사라진다 (설치 경고가 하나 준다)
//
// 호환성 때문은 아니다 — Orion API 표를 확인해보니 `alarms` 는 macOS·iOS 모두
// Full support 다. 순전히 "안 깨워도 되는 걸 깨우지 말자"는 얘기다.
//
// 자주 찔러도 싸다 — ETag 조건부 요청이라 바뀐 게 없으면 304 로 끝난다.

chrome.runtime.onInstalled.addListener(async () => {
  await seedDefaultSettings()

  const stats = await chrome.storage.local.get(STATS_KEY)
  if (!stats[STATS_KEY]) {
    await chrome.storage.local.set({ [STATS_KEY]: { pruned: 0, skipped: 0, since: Date.now() } })
  }

  void updateFilters(true)
  void loadStats().then(setBadge)
})

chrome.runtime.onStartup.addListener(() => {
  void updateFilters()
  void loadStats().then(setBadge)
})

// Safari 에서만 실제로 일한다 (Chrome 번들에서는 통째로 사라진다).
// onInstalled/onStartup 밖에서도 부르는 이유: 등록이 한 번 실패한 뒤 서비스 워커가
// 다른 이유로 깨어났을 때 다시 시도할 기회를 주기 위해서다. 이미 등록돼 있으면
// 조회 한 번으로 끝난다.
void ensureMainWorldScript()

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
