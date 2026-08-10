// MAIN world 훅. 유튜브 스크립트보다 먼저, 동기적으로 설치돼야 한다.
//
// 후킹 지점을 최소로 잡았다 — 건드리는 네이티브가 많을수록 유튜브가 깨질 확률이 올라간다.
//
//   1) JSON.parse            : 유튜브가 응답 본문을 파싱하는 거의 모든 경로가 여기를 지난다
//                              (fetch → res.text() → JSON.parse, XHR responseText → JSON.parse,
//                               인라인 스크립트의 JSON.parse('{...}') 포함).
//   2) Response.prototype.json: 이것만 JSON.parse 를 거치지 않고 내부에서 파싱한다.
//   3) 전역 변수 setter       : ytInitialPlayerResponse / ytInitialData 는 인라인 스크립트의
//                              객체 리터럴이라 파싱 훅에 걸리지 않는다. 첫 재생 광고를 막는
//                              데 이 훅이 결정적이다.
//
// fetch / XMLHttpRequest 자체는 감싸지 않는다. 위 3개로 이미 덮이고, 요청 계층까지
// 건드리면 유튜브의 재시도·스트리밍 로직과 부딪힐 수 있다.

import { NS, isBridgeMessage, type MainConfig } from '../shared/messages.ts'
import { BUNDLED_PRUNE } from '../shared/selectors.ts'
import { pruneAdFields } from './prune.ts'

// 설정이 도착하기 전 기본값은 "차단". MAIN world 는 chrome.storage 를 못 읽어서
// ISOLATED 가 설정을 넘겨줄 때까지 수백 ms 가 비는데, 그동안 광고가 새는 것보다
// 확장을 꺼둔 사람이 잠깐 더 차단되는 쪽이 낫다.
const config: MainConfig = {
  enabled: true,
  videoAds: true,
  prunePaths: BUNDLED_PRUNE,
}

const isActive = () => config.enabled && config.videoAds

// --- 통계 보고 (묶어서 보낸다) -------------------------------------------------

let pendingCount = 0
let pendingSource = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  flushTimer = null
  if (!pendingCount) return
  window.postMessage({ ns: NS, type: 'pruned', count: pendingCount, source: pendingSource }, '*')
  pendingCount = 0
}

function report(count: number, source: string) {
  if (count <= 0) return
  pendingCount += count
  pendingSource = source
  if (flushTimer === null) flushTimer = setTimeout(flush, 1000)
}

function tryPrune(data: unknown, source: string) {
  if (!isActive()) return
  try {
    report(pruneAdFields(data, config.prunePaths), source)
  } catch {
    // 프루닝이 실패해도 페이지는 그대로 굴러가야 한다
  }
}

// --- toString 위장 -------------------------------------------------------------
// 후킹한 함수를 toString() 하면 원본 네이티브 코드가 보이게 한다.
// 유튜브의 애드블록 탐지가 흔히 쓰는 확인 방법이다.

const originals = new WeakMap<object, object>()
const nativeToString = Function.prototype.toString

function disguise<T extends object>(hooked: T, original: object): T {
  originals.set(hooked, original)
  return hooked
}

function installToStringGuard() {
  const patched = function (this: unknown) {
    const original = typeof this === 'object' || typeof this === 'function' ? originals.get(this as object) : undefined
    return nativeToString.call(original ?? this)
  }
  Function.prototype.toString = disguise(patched, nativeToString)
}

// --- 1) JSON.parse -------------------------------------------------------------

function installJsonParseHook() {
  const native = JSON.parse
  const patched = function (this: unknown, text: string, reviver?: (key: string, value: unknown) => unknown) {
    const data = native.call(JSON, text, reviver as never)
    if (data !== null && typeof data === 'object') tryPrune(data, 'json-parse')
    return data
  }
  JSON.parse = disguise(patched, native) as typeof JSON.parse
}

// --- 2) Response.prototype.json ------------------------------------------------

const INNERTUBE_PATH = /\/youtubei\/v1\/(player|browse|next|search|reel_watch_sequence|get_watch)/

function installResponseJsonHook() {
  const native = Response.prototype.json
  const patched = async function (this: Response) {
    const data = await native.call(this)
    let relevant = true
    try {
      relevant = !this.url || INNERTUBE_PATH.test(this.url)
    } catch {
      relevant = true
    }
    if (relevant && data !== null && typeof data === 'object') tryPrune(data, 'response-json')
    return data
  }
  Response.prototype.json = disguise(patched, native) as typeof Response.prototype.json
}

// --- 3) 전역 변수 setter --------------------------------------------------------

function guardGlobal(name: string) {
  try {
    const existing = Object.getOwnPropertyDescriptor(window, name)
    if (existing && !existing.configurable) return

    let stored: unknown = existing?.value
    if (stored !== undefined) tryPrune(stored, `global:${name}`)

    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() {
        return stored
      },
      set(value: unknown) {
        tryPrune(value, `global:${name}`)
        stored = value
      },
    })
  } catch {
    // 유튜브가 이미 non-configurable 로 박아뒀다면 포기한다 — JSON.parse 훅이 남아 있다
  }
}

// --- 설정 수신 ------------------------------------------------------------------
//
// 페이지 스크립트도 같은 채널에 메시지를 흘릴 수 있다. 최악의 경우 유튜브가 위조 메시지로
// 차단을 끌 수 있는데, 그건 확장 존재를 이미 안다는 뜻이라 실익이 없어 감수한다.
// 반대 방향(카운터)은 신뢰하지 않아도 되는 값이라 문제되지 않는다.

function listenForConfig() {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return
      if (!isBridgeMessage(event.data) || event.data.type !== 'config') return
      const next = event.data.config
      config.enabled = next.enabled
      config.videoAds = next.videoAds
      if (Array.isArray(next.prunePaths) && next.prunePaths.length) config.prunePaths = next.prunePaths
    },
    false,
  )
}

export function installHooks() {
  installToStringGuard()
  installJsonParseHook()
  installResponseJsonHook()
  guardGlobal('ytInitialPlayerResponse')
  guardGlobal('ytInitialData')
  listenForConfig()
}
