// Settings definitions and all chrome.storage access, in one place.
// The MAIN world cannot use chrome.*, so it never imports this module.

import { BASE_LANG, LANGS, type Lang, detectLang } from './i18n.ts'

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
  'cookieBanners',
  'popups',
  'pipButton',
  'autoCaptions',
] as const

export type ToggleKey = (typeof TOGGLE_KEYS)[number]

export interface ToggleMeta {
  key: ToggleKey
  /**
   * 0 = network blocking, 1 = response pruning, 2 = component filter,
   * 3 = player fallback. Absent for what is not a blocking layer at all.
   *
   * Label and hint are not here — they are translated. Look them up with
   * `t('toggle.<key>.label')` / `.hint` from ./i18n.
   */
  layer?: 0 | 1 | 2 | 3
  /**
   * Whether this means anything away from the video site.
   *
   * The popup leads with what applies where you are standing, and that split
   * used to be hard-coded as "everything except genericAds is YouTube's". It is
   * no longer true — cookie banners and popups are the whole web — so the fact
   * lives on the entry instead of in the popup's head.
   */
  everywhere?: boolean
}

/** Named after the ReVanced patches (video-ads, hide-general-ads, …). */
export const TOGGLE_META: readonly ToggleMeta[] = [
  { key: 'videoAds', layer: 1 },
  { key: 'generalAds', layer: 2 },
  { key: 'shortsAds', layer: 2 },
  { key: 'merchandise', layer: 2 },
  { key: 'getPremium', layer: 2 },
  { key: 'fullscreenAds', layer: 2 },
  { key: 'antiAdblockNag', layer: 2 },
  { key: 'appPromo', layer: 2 },
  { key: 'playerFallback', layer: 3 },
  { key: 'genericAds', layer: 2, everywhere: true },
  // Cookie consent walls and the newsletter/app-install nags that come with
  // them. Same mechanism as the group above, kept separate because it is the
  // one people most often want off on its own: some sites are unusable until
  // the banner is answered, and a hidden banner cannot be answered.
  { key: 'cookieBanners', layer: 2, everywhere: true },
  // Layer 0 in the sense the README's diagram means it — the request never
  // happens. Not declarativeNetRequest though: a popunder is `window.open`
  // from the page's own script, which no request-level rule can see.
  { key: 'popups', layer: 0, everywhere: true },
  // The floating window and the fullscreen hand-off are the browser's own; all
  // this adds is a shortcut to open the window, which the mobile site hides.
  // Nothing here makes leaving automatic — not possible for a web page on this
  // platform, and pretending otherwise was the whole of a very long detour.
  { key: 'pipButton' },
  // Not a blocking layer either: picks the caption track in the UI language
  // (or auto-translation into it) once per video, then leaves the player alone.
  { key: 'autoCaptions' },
]

export interface Settings {
  /** Master switch. */
  enabled: boolean
  /** UI language for the popup and settings page. */
  lang: Lang
  toggles: Record<ToggleKey, boolean>
  /** Master switch for remote lists. Off means bundled rules only. */
  listEnabled: boolean
  /**
   * The lists to fetch, in order.
   *
   * This was a single `listUrl` until the annoyance list arrived and would not
   * fit: one list is capped at `MAX_LIST_BYTES`, the Korean mirror already
   * fills two thirds of that, and merging a second corpus into the same file
   * would have meant throwing away rules from both. Separate subscriptions cost
   * one conditional request each — an unchanged list ends at a 304 — and let
   * someone drop a corpus they do not want without losing the other.
   */
  lists: Subscription[]
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

/** One subscribed list. `enabled` is off rather than removed so the URL survives. */
export interface Subscription {
  url: string
  enabled: boolean
}

/** Beyond this many the settings stop fitting in sync storage and nobody reads them. */
export const MAX_LISTS = 8

const RAW = 'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/filters'

export const DEFAULT_LIST_URL = `${RAW}/list.json`

/**
 * Cookie walls and the nags that travel with them, mirrored from the annoyance
 * lists. A separate subscription rather than a section of the list above, for
 * the size reason in `Settings.lists`.
 */
export const ANNOYANCE_LIST_URL = `${RAW}/annoyances.json`

export const DEFAULT_LISTS: Subscription[] = [
  { url: DEFAULT_LIST_URL, enabled: true },
  { url: ANNOYANCE_LIST_URL, enabled: true },
]

/**
 * Old default list URLs that no longer exist. A build seeds its default into the
 * user's settings, and settings outlive the build — so someone who installed
 * back when the list was `youtube.json` kept fetching a file that has since been
 * renamed, and every refresh 404'd. Anyone still holding one of these is moved
 * to the current default on load.
 */
const LEGACY_LIST_URLS = new Set([
  'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/filters/youtube.json',
])

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // Overwritten from the browser locale on first seed. The base locale is the
  // fallback until then, because a default is what a reader gets when nothing
  // is known about them, and that must not be one particular reader's language.
  lang: BASE_LANG,
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
    cookieBanners: true,
    // On. A popup that opens without the user having touched anything was not
    // asked for by definition, and that is the only case this blocks.
    popups: true,
    // On, and the reason the extension is on a phone at all: the mobile web
    // player stops when you leave, and the app that does not is the one with the
    // On. Leaving the app with the sound still going is the point of installing
    // this on a phone, and picture-in-picture is the only mechanism iOS gives a
    /*
     * On, because it is the only thing that works.
     *
     * It was off as the one control that adds something to somebody's screen,
     * and that was right while leaving the app was expected to float the video by
     * itself. It does not and cannot: WebKit grants a floating window only inside
     * a live user activation, and a departure has none — measured on the device
     * across a day of releases, every automatic call taken and silently ignored.
     *
     * A real tap works, every time, and the window survives leaving the app. So
     * the button is not an extra: it is the feature. Off by default meant the
     * only working way in was hidden behind a setting nobody had reason to find.
     */
    pipButton: true,
    // Off: it changes what plays on screen, and unlike blocking there is no
    // harm in leaving it to opt in.
    autoCaptions: false,
  },
  listEnabled: true,
  lists: DEFAULT_LISTS,
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

/** Only http(s). A `file:` or `data:` list would be fetched by the service worker. */
export function isListUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The subscription list, from whatever shape storage holds.
 *
 * Settings outlive builds, so this has to answer for three of them: the current
 * array, the single `listUrl` string that came before it, and nothing at all.
 *
 * **A `listUrl` upgrade gains the annoyance list.** That is deliberate and it is
 * the same bargain as any new default-on group: someone who never chose a list
 * gets the new corpus, and someone who dislikes it turns off `cookieBanners`
 * (or the subscription) once. What it must not do is *lose* a list somebody
 * typed in, so a custom URL is carried over as the first entry and keeps its
 * place at the front.
 */
function mergeLists(s: Partial<Settings> & { listUrl?: unknown }): Subscription[] {
  const out: Subscription[] = []
  const seen = new Set<string>()
  const add = (url: string, enabled: boolean) => {
    if (seen.has(url) || out.length >= MAX_LISTS) return
    seen.add(url)
    out.push({ url, enabled })
  }

  if (Array.isArray(s.lists)) {
    for (const raw of s.lists) {
      if (typeof raw !== 'object' || raw === null) continue
      const { url, enabled } = raw as Partial<Subscription>
      if (!isListUrl(url) || LEGACY_LIST_URLS.has(url)) continue
      add(url, enabled !== false)
    }
    // An array that survived validation with nothing in it is a real state —
    // the user removed every list — and must not be re-seeded with defaults.
    if (out.length || s.lists.length === 0) return out
  }

  if (isListUrl(s.listUrl) && !LEGACY_LIST_URLS.has(s.listUrl)) add(s.listUrl, true)
  for (const entry of DEFAULT_LISTS) add(entry.url, entry.enabled)
  return out
}

function mergeSettings(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Settings>
  const toggles = { ...DEFAULT_SETTINGS.toggles }
  const raw = (s.toggles ?? {}) as Partial<Record<ToggleKey, unknown>>
  for (const key of TOGGLE_KEYS) {
    if (typeof raw[key] === 'boolean') toggles[key] = raw[key]
  }
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
    // Against the shipped list, not a pair written out here. A hardcoded
    // `'ko' || 'en'` silently discards every language added after it.
    lang: LANGS.includes(s.lang as Lang) ? (s.lang as Lang) : DEFAULT_SETTINGS.lang,
    toggles,
    listEnabled: typeof s.listEnabled === 'boolean' ? s.listEnabled : DEFAULT_SETTINGS.listEnabled,
    lists: mergeLists(s),
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

/**
 * A storage read must not be able to hang the UI. On Orion, `storage.sync` is
 * only partially implemented and a read of it sometimes never settles — and
 * `loadSettings` awaits both areas on the popup's first open, so that hang is
 * the "spins forever when I first open it". Time each read out and treat a slow
 * area as absent; the other area (or the defaults) still answers.
 */
const STORAGE_READ_TIMEOUT_MS = 1500

async function areaGet(area: AreaName, key: string): Promise<unknown> {
  const got = await Promise.race([
    chrome.storage[area].get(key),
    new Promise<Record<string, unknown>>((_, reject) =>
      setTimeout(() => reject(new Error(`storage.${area} read timed out`)), STORAGE_READ_TIMEOUT_MS),
    ),
  ])
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
  // First run: take the browser's language as the starting point.
  await saveSettings({ lang: detectLang() })
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

/**
 * Settings as a file somebody can keep.
 *
 * This exists because of how the extension is installed, not because backups
 * are a nice feature. Orion cannot install over an existing extension — the
 * update is delete-then-add — and Chrome's unpacked route means keeping a
 * folder alive by hand. Either way the allowlist and the hand-written rules,
 * the two things nobody can reconstruct, go with it.
 *
 * Stats and the fetched lists are deliberately absent: one is a scoreboard and
 * the other is re-downloaded within a minute. What is here is only what the
 * user themselves put in.
 */
export interface SettingsBackup {
  app: typeof BACKUP_APP
  /** The extension version that wrote it. Informational — import never gates on it. */
  version: string
  exportedAt: string
  settings: Settings
}

const BACKUP_APP = 'oc-ad-bye-pass'

export function exportSettings(settings: Settings, appVersion: string): string {
  const backup: SettingsBackup = {
    app: BACKUP_APP,
    version: appVersion,
    exportedAt: new Date().toISOString(),
    settings,
  }
  return JSON.stringify(backup, null, 2) + '\n'
}

/** A filename that sorts by date and says what it is without being opened. */
export function backupFilename(appVersion: string): string {
  return `oc-ad-bye-pass-settings-v${appVersion}-${new Date().toISOString().slice(0, 10)}.json`
}

export type ParsedBackup = { ok: true; settings: Settings } | { ok: false; error: string }

/**
 * Read a backup file back.
 *
 * Everything goes through `mergeSettings`, which is the same gate a stored
 * value passes: unknown keys are dropped, bad types fall back to defaults, and
 * a file from an older build is migrated exactly as storage would have been.
 * So a hand-edited or truncated file cannot produce a broken settings object —
 * at worst it produces a defaulted one.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 을 읽지 못했습니다: ${(e as Error).message}` }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '설정 파일이 아닙니다' }
  }
  const backup = raw as Partial<SettingsBackup>
  if (backup.app !== BACKUP_APP) {
    return { ok: false, error: '이 확장의 설정 파일이 아닙니다' }
  }
  if (typeof backup.settings !== 'object' || backup.settings === null) {
    return { ok: false, error: 'settings 가 없습니다' }
  }
  return { ok: true, settings: mergeSettings(backup.settings) }
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
