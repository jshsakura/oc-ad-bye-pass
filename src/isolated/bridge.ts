// ISOLATED ↔ MAIN, ISOLATED → background 중계.

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

// 통계는 묶어서 보낸다. 광고 하나에 메시지 하나씩 보내면 서비스 워커가 계속 깨어난다.
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
    // 서비스 워커가 자고 있거나 확장이 방금 리로드됐으면 그냥 실패한다 — 통계일 뿐이다
    void chrome.runtime.sendMessage(message).catch(() => {})
  } catch {
    // 컨텍스트 무효화(확장 업데이트 직후) — 무시
  }
}

export function bumpStats(patch: { pruned?: number; skipped?: number }): void {
  pendingPruned += patch.pruned ?? 0
  pendingSkipped += patch.skipped ?? 0
  if (flushTimer === null) flushTimer = setTimeout(flush, 3000)
}

/**
 * "유튜브 페이지가 열렸다"고 알린다. 백그라운드가 캐시가 낡았을 때만 받아온다.
 *
 * 주기 알람 대신 이걸 쓰는 이유:
 *   - 유튜브를 안 보는 동안 서비스 워커를 깨울 이유가 없다
 *   - `alarms` 권한이 통째로 필요 없어진다 (설치 경고가 하나 준다)
 *
 * 과하게 때릴 걱정은 없다 — updater 가 30분 최소 간격을 강제하므로, 탭을 백 번
 * 열어도 실제 네트워크 요청은 30분에 한 번이다. force 를 명시적으로 false 로
 * 보내는 게 그래서 중요하다 (백그라운드 기본값은 true 다).
 */
export function requestFreshFilters(): void {
  try {
    void chrome.runtime.sendMessage({ type: 'filters:update', force: false }).catch(() => {})
  } catch {
    // 컨텍스트 무효화 — 무시
  }
}
