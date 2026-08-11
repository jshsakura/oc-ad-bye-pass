// Settings definitions and all chrome.storage access, in one place.
// The MAIN world cannot use chrome.*, so it never imports this module.

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
  'genericAds',
  'backgroundPlay',
  'pictureInPicture',
] as const

export type ToggleKey = (typeof TOGGLE_KEYS)[number]

export interface ToggleMeta {
  key: ToggleKey
  label: string
  hint: string
  /**
   * 1 = response pruning, 2 = component filter, 3 = player fallback.
   * Absent for what is not a blocking layer at all.
   */
  layer?: 1 | 2 | 3
}

/** Named after the ReVanced patches (video-ads, hide-general-ads, …). */
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
  {
    key: 'genericAds',
    label: '다른 사이트 광고 숨김',
    hint: '유튜브 밖에서도 광고 자리를 숨깁니다',
    layer: 2,
  },
  {
    key: 'backgroundPlay',
    label: '탭을 옮겨도 계속 재생',
    // Deliberately not "화면을 나가도". On iPhone, leaving the app suspends
    // media at the system level and no amount of lying to the page about its
    // visibility changes that. What this does defeat is the page pausing
    // itself, which is what happens on a tab switch, on desktop and on Android.
    hint: '페이지가 스스로 멈추는 것을 막습니다 (아이폰에서 홈으로 나갈 때는 PiP 쪽)',
  },
  {
    key: 'pictureInPicture',
    label: '나갈 때 작은 창으로',
    // One switch, because there was never more than one thing being asked for.
    // It was briefly two — a button, and the arming that makes leaving work —
    // which is two settings for one intention and a control on the player nobody
    // asked to see.
    hint: '재생 중 화면을 한 번 누르면 준비됩니다 (iOS 설정의 "자동으로 PiP 시작" 필요)',
  },
]

export interface Settings {
  /** Master switch. */
  enabled: boolean
  toggles: Record<ToggleKey, boolean>
  /** Whether to use the remote filter list. */
  listEnabled: boolean
  listUrl: string
  /** The user's own rules — one selector per line. */
  customRules: string
  /**
   * Hosts where the extension stands down entirely.
   *
   * Injecting everywhere means we can break anything, so this is the escape
   * hatch that makes that defensible. An entry covers its subdomains.
   */
  allowlist: string[]
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
    genericAds: true,
    // On, and the reason the extension is on a phone at all: the mobile web
    // player stops when you leave, and the app that does not is the one with the
    // ads in it.
    backgroundPlay: true,
    // Off. It puts a control on someone else's player and changes what a tap
    // does — that is not something to help yourself to on their behalf.
    pictureInPicture: false,
  },
  listEnabled: true,
  listUrl: DEFAULT_LIST_URL,
  customRules: '',
  allowlist: [],
}

export interface Stats {
  /** Ad fields cut from responses (layer 1). */
  pruned: number
  /** Automatic skips and dismissals (layers 2 and 3). */
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
    allowlist: Array.isArray(s.allowlist)
      ? [...new Set(s.allowlist.filter((h): h is string => typeof h === 'string' && !!h))]
      : [...DEFAULT_SETTINGS.allowlist],
  }
}

// Settings are written to **both** sync and local, and reads take whichever was
// **saved most recently**.
//
// Why write to both: Orion (WebKit) lists `storage.sync` as partial support —
// the API is there but synchronisation is not guaranteed. Writing only to sync
// means it silently fails to persist, and to the user the settings look like
// they reset every time. (`local` is fully supported on Orion.)
//
// Why "newest wins" rather than "sync wins" — this actually lost user data:
//
//   `storage.sync` caps an item at 8KB (QUOTA_BYTES_PER_ITEM). With long
//   `customRules`, the sync write is rejected while the local write succeeds.
//   But the code only threw when *both* failed, so the save looked successful —
//   and since reads preferred sync, **the old value came back**. Paste rules,
//   save, see success, reload, find them gone. Worse, from then on even a single
//   toggle change repeated the cycle and the settings froze wholesale.
//
// The cause was "which area accepted the write" and "which area reads first"
// being decided independently. Recording the save time and taking the larger
// one means a partial failure still yields the newest value.

const AREAS = ['sync', 'local'] as const
type AreaName = (typeof AREAS)[number]

/** What actually gets stored. `savedAt` decides the winner when the two areas disagree. */
type StoredSettings = Settings & { savedAt?: number }

/**
 * Largest payload we will even attempt to put in sync, in bytes.
 * `QUOTA_BYTES_PER_ITEM` is 8192B, so this leaves headroom.
 *
 * Measured in bytes rather than characters: non-ASCII comments run three bytes
 * per character, so a character count sails straight past the real limit.
 *
 * Over budget, we **skip the sync write entirely.** Letting it throw would look
 * to the user like the save failed, when local can hold it perfectly well.
 */
const SYNC_ITEM_BUDGET_BYTES = 7500

/** Local is not unbounded either. This is ample for hand-written rules. */
export const MAX_CUSTOM_RULES_CHARS = 20_000

async function areaGet(area: AreaName, key: string): Promise<unknown> {
  const got = await chrome.storage[area].get(key)
  return got[key]
}

async function areaSet(area: AreaName, key: string, value: unknown): Promise<void> {
  await chrome.storage[area].set({ [key]: value })
}

export async function loadSettings(): Promise<Settings> {
  let best: { value: unknown; savedAt: number } | null = null

  for (const area of AREAS) {
    try {
      const value = await areaGet(area, SETTINGS_KEY)
      if (value === undefined) continue
      const savedAt = (value as StoredSettings).savedAt ?? 0
      // On a tie the earlier area (sync) stays — iteration order doubles as precedence
      if (!best || savedAt > best.savedAt) best = { value, savedAt }
    } catch {
      // If this area is unusable, try the next one
    }
  }

  return mergeSettings(best?.value)
}

export interface SaveResult {
  settings: Settings
  /** Areas the write failed for. Empty means a clean save. */
  failedAreas: AreaName[]
}

/** Variant that reports where it landed, so the UI can surface a partial failure. */
export async function saveSettingsDetailed(patch: Partial<Settings>): Promise<SaveResult> {
  const merged = mergeSettings({ ...(await loadSettings()), ...patch })

  if (merged.customRules.length > MAX_CUSTOM_RULES_CHARS) {
    throw new Error(
      `내 규칙이 너무 깁니다 (${merged.customRules.length} / ${MAX_CUSTOM_RULES_CHARS}자)`,
    )
  }

  const stored: StoredSettings = { ...merged, savedAt: Date.now() }
  const bytes = new TextEncoder().encode(JSON.stringify(stored)).length
  // Over the sync budget we don't even try — it would be rejected, and local will take it
  const targets = AREAS.filter((area) => area !== 'sync' || bytes <= SYNC_ITEM_BUDGET_BYTES)

  const results = await Promise.allSettled(targets.map((area) => areaSet(area, SETTINGS_KEY, stored)))
  const failedAreas = [
    ...AREAS.filter((area) => !targets.includes(area)),
    ...targets.filter((_, i) => results[i].status === 'rejected'),
  ]

  if (failedAreas.length === AREAS.length) {
    const reason = results.find((r) => r.status === 'rejected')
    throw new Error(
      `설정을 저장할 수 없습니다${reason?.status === 'rejected' ? `: ${String(reason.reason)}` : ''}`,
    )
  }

  return { settings: merged, failedAreas }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return (await saveSettingsDetailed(patch)).settings
}

/** Seed defaults on install. Leaves any existing stored value alone. */
export async function seedDefaultSettings(): Promise<void> {
  for (const area of AREAS) {
    try {
      if ((await areaGet(area, SETTINGS_KEY)) !== undefined) return
    } catch {
      // An area we cannot read counts as absent
    }
  }
  await saveSettings({})
}

/**
 * Subscribe to settings changes. Returns an unsubscribe function.
 *
 * Both areas are watched, so one save can fire the callback twice. The
 * receiving side is idempotent (it just rebuilds the stylesheet), so no
 * de-duplication is done.
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
 * Turn the user's rule text into a selector array, dropping blank lines and
 * `!` comments. `#` is not the comment character because it collides with ID
 * selectors like `#masthead-ad` — ABP uses `!` for the same reason.
 */
export function parseCustomRules(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('!'))
}
