// 설정 정의와 chrome.storage 접근을 한곳에 모은다.
// MAIN world 는 chrome.* 를 못 쓰므로 이 모듈을 import 하지 않는다.

export const TOGGLE_KEYS = [
  'videoAds',
  'generalAds',
  'shortsAds',
  'merchandise',
  'getPremium',
  'fullscreenAds',
  'playerFallback',
  'antiAdblockNag',
  'appPromo',
] as const

export type ToggleKey = (typeof TOGGLE_KEYS)[number]

export interface ToggleMeta {
  key: ToggleKey
  label: string
  hint: string
  /** 1 = 응답 프루닝, 2 = 컴포넌트 필터, 3 = 플레이어 폴백 */
  layer: 1 | 2 | 3
}

/** 이름은 ReVanced 패치명을 따랐다 (video-ads, hide-general-ads, …) */
export const TOGGLE_META: readonly ToggleMeta[] = [
  { key: 'videoAds', label: '동영상 광고 차단', hint: '플레이어 응답에서 광고를 제거합니다', layer: 1 },
  { key: 'generalAds', label: '피드·배너 광고 숨김', hint: '홈/검색/추천의 광고 카드', layer: 2 },
  { key: 'shortsAds', label: 'Shorts 광고 숨김', hint: 'Shorts 피드에 섞인 광고', layer: 2 },
  { key: 'merchandise', label: '상품·머천다이즈 숨김', hint: '영상 하단 상품 선반, 쇼핑 패널', layer: 2 },
  { key: 'getPremium', label: 'Premium 권유 숨김', hint: '하단 배너, 가입 유도 팝업', layer: 2 },
  { key: 'fullscreenAds', label: '전면·오버레이 광고 닫기', hint: '재생 중 겹쳐 뜨는 광고', layer: 2 },
  { key: 'antiAdblockNag', label: '애드블록 경고창 무시', hint: '"광고 차단기를 사용 중입니다" 안내', layer: 2 },
  { key: 'appPromo', label: '앱으로 열기 유도 숨김', hint: '상단 스마트 앱 배너, "앱에서 보기" 바', layer: 2 },
  { key: 'playerFallback', label: '광고 자동 스킵 (폴백)', hint: '위 차단이 뚫렸을 때만 동작', layer: 3 },
]

export interface Settings {
  /** 마스터 스위치 */
  enabled: boolean
  toggles: Record<ToggleKey, boolean>
  /** 원격 필터 리스트 사용 여부 */
  listEnabled: boolean
  listUrl: string
  /** 내 규칙 — 한 줄에 셀렉터 하나 */
  customRules: string
}

export const DEFAULT_LIST_URL =
  'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/filters/youtube.json'

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  toggles: {
    videoAds: true,
    generalAds: true,
    shortsAds: true,
    merchandise: true,
    getPremium: true,
    fullscreenAds: true,
    playerFallback: true,
    antiAdblockNag: true,
    appPromo: true,
  },
  listEnabled: true,
  listUrl: DEFAULT_LIST_URL,
  customRules: '',
}

export interface Stats {
  /** 응답에서 잘라낸 광고 필드 수 (1계층) */
  pruned: number
  /** 자동 스킵/닫기 횟수 (2·3계층) */
  skipped: number
  since: number
}

export const DEFAULT_STATS: Stats = { pruned: 0, skipped: 0, since: 0 }

export const SETTINGS_KEY = 'settings'
export const STATS_KEY = 'stats'
export const CACHE_KEY = 'filterCache'

function mergeSettings(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Settings>
  const toggles = { ...DEFAULT_SETTINGS.toggles }
  const raw = (s.toggles ?? {}) as Partial<Record<ToggleKey, unknown>>
  for (const key of TOGGLE_KEYS) {
    if (typeof raw[key] === 'boolean') toggles[key] = raw[key]
  }
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
    toggles,
    listEnabled: typeof s.listEnabled === 'boolean' ? s.listEnabled : DEFAULT_SETTINGS.listEnabled,
    listUrl: typeof s.listUrl === 'string' && s.listUrl ? s.listUrl : DEFAULT_SETTINGS.listUrl,
    customRules: typeof s.customRules === 'string' ? s.customRules : DEFAULT_SETTINGS.customRules,
  }
}

// 설정은 sync 와 local **양쪽에** 쓰고, 읽을 때 sync 를 우선한다.
//
// 왜: Orion(WebKit)은 `storage.sync` 가 Partial support 다 — API 는 있는데 기기 간
// 동기화가 보장되지 않는다. sync 에만 쓰면 조용히 안 저장돼서 사용자 눈에는 설정이
// 매번 초기화되는 것처럼 보인다. 실패해도 티가 안 나는 종류라 더 나쁘다.
// (`storage.local` 은 Orion macOS·iOS 모두 Full support 다.)
//
// 양쪽에 쓰는 비용은 무시할 만하다 — 설정은 작고 자주 바뀌지 않는다.

const AREAS = ['sync', 'local'] as const
type AreaName = (typeof AREAS)[number]

async function areaGet(area: AreaName, key: string): Promise<unknown> {
  const got = await chrome.storage[area].get(key)
  return got[key]
}

async function areaSet(area: AreaName, key: string, value: unknown): Promise<void> {
  await chrome.storage[area].set({ [key]: value })
}

export async function loadSettings(): Promise<Settings> {
  for (const area of AREAS) {
    try {
      const value = await areaGet(area, SETTINGS_KEY)
      if (value !== undefined) return mergeSettings(value)
    } catch {
      // 이 영역을 못 쓰면 다음 영역으로
    }
  }
  return mergeSettings(undefined)
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await loadSettings()), ...patch })
  const results = await Promise.allSettled(AREAS.map((area) => areaSet(area, SETTINGS_KEY, next)))
  if (results.every((r) => r.status === 'rejected')) {
    throw new Error('설정을 저장할 수 없습니다')
  }
  return next
}

/** 설치 직후 기본값 심기. 이미 저장된 값이 있으면 건드리지 않는다. */
export async function seedDefaultSettings(): Promise<void> {
  for (const area of AREAS) {
    try {
      if ((await areaGet(area, SETTINGS_KEY)) !== undefined) return
    } catch {
      // 못 읽는 영역은 없는 셈 친다
    }
  }
  await saveSettings({})
}

/**
 * 설정 변경을 구독한다. 해제 함수를 돌려준다.
 *
 * 두 영역을 다 보므로 한 번의 저장에 콜백이 두 번 올 수 있다. 받는 쪽이
 * 멱등이라(스타일시트를 다시 만들 뿐) 중복 제거는 하지 않는다.
 */
export function watchSettings(cb: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if ((area === 'sync' || area === 'local') && changes[SETTINGS_KEY]) {
      cb(mergeSettings(changes[SETTINGS_KEY].newValue))
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export async function loadStats(): Promise<Stats> {
  const got = await chrome.storage.local.get(STATS_KEY)
  const s = (got[STATS_KEY] ?? {}) as Partial<Stats>
  return {
    pruned: typeof s.pruned === 'number' ? s.pruned : 0,
    skipped: typeof s.skipped === 'number' ? s.skipped : 0,
    since: typeof s.since === 'number' && s.since > 0 ? s.since : Date.now(),
  }
}

/**
 * 내 규칙 텍스트를 셀렉터 배열로. 빈 줄과 `!` 주석은 버린다.
 * 주석 문자로 `#` 을 쓰지 않는 이유: `#masthead-ad` 처럼 ID 셀렉터와 겹친다 (ABP 도 `!` 를 쓴다).
 */
export function parseCustomRules(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('!'))
}
