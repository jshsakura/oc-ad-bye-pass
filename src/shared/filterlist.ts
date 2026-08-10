// 원격 필터 리스트의 스키마 · 검증 · 병합.
//
// 원격에서 가져오는 것은 **데이터일 뿐 코드가 아니다.** eval 도, 원격 스크립트 주입도
// 하지 않는다 (MV3 가 금지하기도 하고, 리스트 저장소가 털렸을 때 유튜브 세션에서
// 임의 코드가 도는 사태를 막기 위해서다).
//
// 그래도 남는 위험이 있다: 셀렉터는 결국 스타일시트에 들어가므로 악의적인 리스트가
// youtube.com 의 임의 요소를 숨길 수 있다. 그래서 아래를 강제한다.
//   - `{` `}` `@` `<` 주석 등 스타일시트를 탈출할 수 있는 문자는 거부
//   - 실제로 파싱되는 셀렉터만 통과 (브라우저에서 시험 파싱)
//   - 크기·개수 상한
//   - version 이 캐시본보다 낮으면 거부 (롤백 공격)

import { TOGGLE_KEYS, type ToggleKey } from './settings.ts'
import { BUNDLED_CLICK, BUNDLED_HIDE, BUNDLED_PRUNE } from './selectors.ts'

export const MAX_LIST_BYTES = 256 * 1024
export const MAX_SELECTOR_LENGTH = 512
export const MAX_SELECTORS_PER_GROUP = 2000
export const MAX_SELECTORS_TOTAL = 8000
export const MAX_PRUNE_PATHS = 200

export interface FilterRules {
  hide: Partial<Record<ToggleKey, string[]>>
  prune: string[]
  click: string[]
  /** 오탐 제거용 예외 — 여기 적힌 셀렉터는 최종 결과에서 문자열 일치로 빠진다 */
  allow: string[]
}

export interface FilterList {
  name: string
  version: number
  updatedAt: string
  rules: FilterRules
}

export interface ValidateOptions {
  /** 이 값보다 낮은 version 은 거부한다 */
  minVersion?: number
  /** 셀렉터 파싱 검사기. 기본값은 DOM 이 있으면 DOM, 없으면 통과 */
  canParseSelector?: (selector: string) => boolean
}

export type ValidateResult =
  | { ok: true; list: FilterList; dropped: string[] }
  | { ok: false; error: string }

const FORBIDDEN_IN_SELECTOR = /[{}<@;]|\/\*|\*\/|javascript:/i
const PRUNE_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** 브라우저에서는 실제로 파싱해 보고, 그 외(테스트/워커)에서는 문자 검사까지만 한다. */
export function defaultCanParseSelector(selector: string): boolean {
  if (typeof document === 'undefined') return true
  try {
    document.createDocumentFragment().querySelector(selector)
    return true
  } catch {
    return false
  }
}

/** 제어문자 검사. 정규식에 리터럴 제어문자를 넣지 않으려고 코드포인트로 본다. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export function isSafeSelector(selector: string, canParse = defaultCanParseSelector): boolean {
  if (typeof selector !== 'string') return false
  const s = selector.trim()
  if (!s || s.length > MAX_SELECTOR_LENGTH) return false
  if (hasControlChar(s)) return false
  if (FORBIDDEN_IN_SELECTOR.test(s)) return false
  return canParse(s)
}

export function isSafePrunePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!PRUNE_PATH_RE.test(path)) return false
  return path.split('.').every((seg) => !FORBIDDEN_PATH_SEGMENTS.has(seg))
}

function sanitizeSelectors(
  input: unknown,
  canParse: (s: string) => boolean,
  dropped: string[],
  label: string,
): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    if (out.length >= MAX_SELECTORS_PER_GROUP) {
      dropped.push(`${label}: 그룹당 상한(${MAX_SELECTORS_PER_GROUP}) 초과분 제외`)
      break
    }
    if (typeof raw !== 'string') continue
    const s = raw.trim()
    if (isSafeSelector(s, canParse)) out.push(s)
    else dropped.push(`${label}: ${s.slice(0, 80)}`)
  }
  return out
}

/** JSON 텍스트 → 검증된 리스트. 크기 상한은 파싱 전에 본다. */
export function parseFilterList(text: string, opts: ValidateOptions = {}): ValidateResult {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_LIST_BYTES) {
    return { ok: false, error: `리스트가 너무 큽니다 (${bytes} > ${MAX_LIST_BYTES} bytes)` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` }
  }
  return validateFilterList(raw, opts)
}

export function validateFilterList(raw: unknown, opts: ValidateOptions = {}): ValidateResult {
  const canParse = opts.canParseSelector ?? defaultCanParseSelector
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '최상위가 객체가 아닙니다' }
  }
  const obj = raw as Record<string, unknown>

  const version = obj.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, error: 'version 은 0 이상의 정수여야 합니다' }
  }
  if (opts.minVersion !== undefined && version < opts.minVersion) {
    return { ok: false, error: `version ${version} 은 캐시본(${opts.minVersion})보다 낮습니다` }
  }

  const rulesRaw = obj.rules
  if (typeof rulesRaw !== 'object' || rulesRaw === null || Array.isArray(rulesRaw)) {
    return { ok: false, error: 'rules 객체가 없습니다' }
  }
  const r = rulesRaw as Record<string, unknown>
  const dropped: string[] = []

  const hide: Partial<Record<ToggleKey, string[]>> = {}
  let total = 0
  if (typeof r.hide === 'object' && r.hide !== null && !Array.isArray(r.hide)) {
    for (const [key, value] of Object.entries(r.hide as Record<string, unknown>)) {
      if (!(TOGGLE_KEYS as readonly string[]).includes(key)) {
        dropped.push(`hide: 알 수 없는 그룹 "${key}"`)
        continue
      }
      const list = sanitizeSelectors(value, canParse, dropped, `hide.${key}`)
      total += list.length
      if (total > MAX_SELECTORS_TOTAL) {
        return { ok: false, error: `셀렉터 총량 상한(${MAX_SELECTORS_TOTAL}) 초과` }
      }
      if (list.length) hide[key as ToggleKey] = list
    }
  }

  const click = sanitizeSelectors(r.click, canParse, dropped, 'click')
  const allow = sanitizeSelectors(r.allow, canParse, dropped, 'allow')

  const prune: string[] = []
  if (Array.isArray(r.prune)) {
    for (const p of r.prune) {
      if (prune.length >= MAX_PRUNE_PATHS) {
        dropped.push(`prune: 상한(${MAX_PRUNE_PATHS}) 초과분 제외`)
        break
      }
      if (isSafePrunePath(p)) prune.push(p)
      else dropped.push(`prune: ${String(p).slice(0, 80)}`)
    }
  }

  return {
    ok: true,
    dropped,
    list: {
      name: typeof obj.name === 'string' ? obj.name.slice(0, 200) : 'unnamed',
      version,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt.slice(0, 40) : '',
      rules: { hide, prune, click, allow },
    },
  }
}

// ---------------------------------------------------------------------------
// 병합
// ---------------------------------------------------------------------------

export interface ResolvedRules {
  /** 토글 그룹별 숨김 셀렉터 */
  hide: Partial<Record<ToggleKey, string[]>>
  /** 내 규칙 — 토글과 무관하게 항상 적용 */
  custom: string[]
  click: string[]
  prune: string[]
}

function union(...lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    for (const item of list) seen.add(item)
  }
  return [...seen]
}

/**
 * 우선순위: 내 규칙 > 원격 리스트 > 번들 기본. 실제로는 합집합이라 "우선순위"가
 * 문제되는 건 allow(예외) 뿐인데, allow 는 원격/번들 결과에만 적용하고
 * 내 규칙은 건드리지 않는다 — 사용자가 직접 넣은 건 언제나 이긴다.
 */
export function resolveRules(remote: FilterList | null, customRules: string[]): ResolvedRules {
  const allow = new Set(remote?.rules.allow ?? [])
  // 여기서 한 번 더 isSafeSelector 를 태운다. 리스트를 받아 검증한 곳(서비스 워커)에는
  // document 가 없어서 "실제로 파싱되는 셀렉터인가"까지는 못 봤기 때문이다.
  const keep = (list: string[]) => list.filter((s) => !allow.has(s) && isSafeSelector(s))

  const hide: Partial<Record<ToggleKey, string[]>> = {}
  for (const key of TOGGLE_KEYS) {
    const merged = keep(union(BUNDLED_HIDE[key], remote?.rules.hide[key]))
    if (merged.length) hide[key] = merged
  }

  return {
    hide,
    custom: customRules.filter((s) => isSafeSelector(s)),
    click: keep(union(BUNDLED_CLICK, remote?.rules.click)),
    prune: union(BUNDLED_PRUNE, remote?.rules.prune),
  }
}

/**
 * 켜진 그룹만 골라 스타일시트를 만든다.
 *
 * 셀렉터 하나당 규칙 하나로 뽑는 이유: 콤마로 묶으면 셀렉터 하나가
 * (예: 미지원 문법) 무효일 때 규칙 전체가 통째로 무시된다.
 */
export function buildStylesheet(
  rules: ResolvedRules,
  toggles: Record<ToggleKey, boolean>,
): string {
  const selectors = new Set<string>()
  for (const key of TOGGLE_KEYS) {
    if (!toggles[key]) continue
    for (const s of rules.hide[key] ?? []) selectors.add(s)
  }
  for (const s of rules.custom) selectors.add(s)
  if (!selectors.size) return ''
  return [...selectors].map((s) => `${s} { display: none !important; }`).join('\n')
}
