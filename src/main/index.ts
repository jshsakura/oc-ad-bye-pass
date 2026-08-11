// 1계층 진입점 — MAIN world, document_start.
// 유튜브 스크립트가 한 줄이라도 돌기 전에 훅이 걸려 있어야 한다.

import { INSTALLED_ATTR } from '../shared/messages.ts'
import { installHooks } from './hooks.ts'

const FLAG = '__ocAdByePassInstalled'

declare global {
  interface Window {
    __ocAdByePassInstalled?: boolean
  }
}

// 이 가드가 Safari 폴백의 안전장치다. MAIN world 등록과 <script> 주입이 둘 다
// 성공해도 훅은 한 번만 걸린다 (두 번 걸리면 프루닝 카운터가 두 배로 뛴다).
if (!window[FLAG]) {
  window[FLAG] = true
  installHooks()
  // ISOLATED 에게 "1계층 살아 있음"을 알린다. document_start 라 아직 head 도 없을 수
  // 있지만 documentElement 는 이 시점에 이미 존재한다.
  document.documentElement?.setAttribute(INSTALLED_ATTR, '1')
}
