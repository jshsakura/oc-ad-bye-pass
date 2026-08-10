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
