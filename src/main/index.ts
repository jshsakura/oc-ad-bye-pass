// 1계층 진입점 — MAIN world, document_start.
// 유튜브 스크립트가 한 줄이라도 돌기 전에 훅이 걸려 있어야 한다.

import { installHooks } from './hooks.ts'

const FLAG = '__ocAdByePassInstalled'

declare global {
  interface Window {
    __ocAdByePassInstalled?: boolean
  }
}

if (!window[FLAG]) {
  window[FLAG] = true
  installHooks()
}
