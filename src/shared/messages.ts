// MAIN world ↔ ISOLATED world 통신 프로토콜.
//
// MAIN world 는 chrome.* 에 접근할 수 없다. 그래서 설정은 ISOLATED 가 읽어
// window.postMessage 로 넘겨주고, 프루닝 카운터는 반대 방향으로 올라온다.
// 페이지 스크립트도 같은 채널을 볼 수 있으므로 ns 로 구분만 하고
// 신뢰가 필요한 값(예: 설정)은 ISOLATED → MAIN 단방향으로만 흐르게 한다.

export const NS = 'oc-ad-bye-pass'

/**
 * MAIN world 훅이 설치되면 documentElement 에 붙는 표시.
 *
 * ISOLATED 는 페이지의 window 를 볼 수 없지만 DOM 은 공유한다. 그래서 "1계층이 정말
 * 페이지 컨텍스트에 걸렸는가"를 이 속성 하나로 판정한다 — Safari 에서 MAIN world
 * 등록이 실패했을 때 폴백 주입을 할지 말지가 여기서 갈린다.
 */
export const INSTALLED_ATTR = 'data-oc-ad-bye-pass'

/** MAIN world 가 실제로 필요로 하는 최소 설정 */
export interface MainConfig {
  enabled: boolean
  videoAds: boolean
  prunePaths: string[]
}

export interface ConfigMessage {
  ns: typeof NS
  type: 'config'
  config: MainConfig
}

export interface PrunedMessage {
  ns: typeof NS
  type: 'pruned'
  count: number
  /** 어디서 잘렸는지 — 디버깅용 (json-parse / fetch / xhr / global) */
  source: string
}

export type BridgeMessage = ConfigMessage | PrunedMessage

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Partial<BridgeMessage>
  return m.ns === NS && (m.type === 'config' || m.type === 'pruned')
}

/** 백그라운드 서비스 워커에게 보내는 런타임 메시지 */
export type RuntimeRequest =
  | { type: 'stats:bump'; pruned?: number; skipped?: number }
  | { type: 'filters:update'; force?: boolean }
  | { type: 'filters:status' }

export interface FilterStatus {
  ok: boolean
  version: number | null
  fetchedAt: number | null
  source: 'remote' | 'bundled'
  error: string | null
  dropped: number
}
