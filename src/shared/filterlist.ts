// Schema, validation and merging for the remote filter list.
//
// What we fetch is **data, never code.** No eval, no remote script injection —
// MV3 forbids it, and it would mean a compromised list repository could run
// arbitrary code inside the user's session.
//
// A risk remains: selectors end up in a stylesheet, so a hostile list could
// still hide or act on things it shouldn't. Hence the rules below.
//   - reject characters that could escape the stylesheet (`{` `}` `@` `<`, comments)
//   - only selectors that actually parse (test-parsed in the browser)
//   - only selectors whose subject is identifiable (see hasSpecificAnchor)
//   - size and count caps
//   - reject a version older than the cached one (rollback attack)

import { TOGGLE_KEYS, type ToggleKey } from './settings.ts'
import type { Lang } from './i18n.ts'
import type { SiteKind } from './sites.ts'
import { BUNDLED_CLICK, BUNDLED_HIDE, BUNDLED_PRUNE } from './selectors.ts'

export const MAX_LIST_BYTES = 256 * 1024
export const MAX_SELECTOR_LENGTH = 512
export const MAX_SELECTORS_PER_GROUP = 2000
export const MAX_SELECTORS_TOTAL = 8000
export const MAX_PRUNE_PATHS = 200

/**
 * `click` sits at a different trust level than `hide`: it does not hide an
 * element, it **presses it as the user**. So remote lists get no say — only
 * the bundled selectors are ever clicked.
 *
 * A name-based allowlist was tried first and abandoned. It admitted any
 * selector containing `close|skip|dismiss`, which is no defence when the
 * attacker owns the whole string: keep the target, bolt on a harmless clause.
 *
 *     #danger:not([data-close])      ← still the "confirm delete" button
 *     a[href*="signout"]:not(.skip)
 *
 * You cannot filter by name when the attacker writes the name. Rather than
 * keep playing that game, the attack surface is gone. The only thing lost is
 * "fix a changed close button via the list" — that ships in an extension update.
 */
export const MAX_CLICK_SELECTORS = 25

/**
 * Selectors that wipe the document. A compromised list would blank the page
 * for every user, and the rule persists in cache until the extension is off.
 */
const TOO_BROAD = new Set(['*', 'html', ':root', 'body', 'head', 'html *', ':root *'])

/**
 * A plain HTML tag. A selector made only of one points at an entire class of
 * document content rather than a single ad (`div`, `body > *`, `body span`).
 */
const GENERIC_TAG = /^[a-z][a-z0-9]*$/

/** A plain hostname and nothing else — no scheme, no path, no wildcard. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export interface FilterRules {
  hide: Partial<Record<ToggleKey, string[]>>
  /**
   * Selectors that apply only on named hosts, grouped by the toggle that
   * controls them.
   *
   * The Korean lists this mirrors are mostly domain-scoped — `dcinside.com##.ad`
   * — and flattening that scope is how a filter list breaks sites it was never
   * pointed at. So the scope survives into the format and is matched at runtime
   * against the page's own hostname.
   *
   * The grouping arrived with the annoyance list: cookie-wall rules are also
   * domain-scoped, and folding them in with the ad rules would have put them
   * under a switch that says "광고" and hidden them from the switch that says
   * cookies. A bare `Record<host, string[]>` is still accepted and read as
   * `genericAds`, which is every list written before this.
   */
  domains?: Partial<Record<ToggleKey, Record<string, string[]>>>
  prune: string[]
  click: string[]
  /** Escape hatch for false positives: removed from the result by exact string match. */
  allow: string[]
}

export interface FilterList {
  name: string
  version: number
  updatedAt: string
  /**
   * The language this list's **domain** rules are for, if any.
   *
   * The Korean mirror names Korean portals and community sites; carrying those
   * host rules for someone reading in English is a stylesheet on every page for
   * sites they are not on. Declared by the list rather than inferred, so a list
   * that is not language-bound simply omits it and applies to everyone. Generic
   * (non-host) selectors are never language-gated — an ad slot is an ad slot.
   */
  lang?: Lang
  rules: FilterRules
}

export interface ValidateOptions {
  /** Reject any list whose version is below this. */
  minVersion?: number
  /** Selector parse check. Defaults to the DOM when there is one, otherwise a no-op. */
  canParseSelector?: (selector: string) => boolean
}

export type ValidateResult =
  | { ok: true; list: FilterList; dropped: string[] }
  | { ok: false; error: string }

const FORBIDDEN_IN_SELECTOR = /[{}<@;]|\/\*|\*\/|javascript:/i
const PRUNE_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** In a browser, actually parse it. Elsewhere (tests, worker) character checks are all we have. */
export function defaultCanParseSelector(selector: string): boolean {
  if (typeof document === 'undefined') return true
  try {
    document.createDocumentFragment().querySelector(selector)
    return true
  } catch {
    return false
  }
}

/** Control-character check, done by code point so no literal control chars sit in a regex. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * Does this selector match the document root (or body)?
 *
 * A string blocklist alone cannot cover `html:has(body)`, `:has(*)` or
 * `*:not(#nope)`. Where a DOM exists, actually matching against it is certain.
 */
function matchesDocumentRoot(selector: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    if (document.documentElement?.matches(selector)) return true
    if (document.body?.matches(selector)) return true
  } catch {
    return false
  }
  return false
}

/**
 * Extract the selector's **subject** — its rightmost compound.
 *
 * Combinators can appear inside parentheses, as in
 * `ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)`, so this
 * tracks depth while scanning. Splitting naively would mistake the inside of
 * `:has()` for the subject.
 */
function rightmostCompound(selector: string): string {
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || c === ',')) {
      start = i + 1
    }
  }
  return selector.slice(start).trim()
}

/**
 * Does the selector name what it targets?
 *
 * The subject must carry an id, class or attribute, or be a custom element
 * (contains `-`). In other words, we only hide elements that actually bear a
 * mark identifying them as an ad.
 *
 * Without this you can empty a page without ever touching the root — this was
 * an actual bypass:
 *
 *     body > *   body *   div   span
 *
 * None of those match `html` or `body`, so a root check waves them through,
 * yet they erase the content. The test moved from "does it point at the root"
 * to "does it say what it points at".
 */
function hasSpecificAnchor(selector: string): boolean {
  const subject = rightmostCompound(selector)
  if (!subject) return false

  // Strip pseudo-classes so only the element part remains (`:has(...)`, `:not(...)`, …)
  const bare = subject.replace(/:[^\s(]+(\([^)]*\))?/g, '').trim()
  if (!bare || bare === '*') return false
  if (bare.includes('#') || bare.includes('.') || bare.includes('[')) return true
  // For a custom element the tag name is itself the mark (ytd-ad-slot-renderer)
  return bare.includes('-') && !GENERIC_TAG.test(bare)
}

export function isSafeSelector(selector: string, canParse = defaultCanParseSelector): boolean {
  if (typeof selector !== 'string') return false
  const s = selector.trim()
  if (!s || s.length > MAX_SELECTOR_LENGTH) return false
  if (hasControlChar(s)) return false
  if (FORBIDDEN_IN_SELECTOR.test(s)) return false
  if (TOO_BROAD.has(s.toLowerCase())) return false
  if (!hasSpecificAnchor(s)) return false
  if (!canParse(s)) return false
  // No list, from any source, gets to blank the page.
  return !matchesDocumentRoot(s)
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

/** JSON text to a validated list. The size cap is checked before parsing. */
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

  /*
   * Domain-scoped selectors, held to the same rules as the rest.
   *
   * The host is checked as strictly as the selectors are: anything that is not a
   * plain hostname is dropped rather than normalised, because a host we guessed
   * at is a rule applied somewhere its author never named.
   */
  const domains: Partial<Record<ToggleKey, Record<string, string[]>>> = {}
  let overflowed = false

  const takeHosts = (group: ToggleKey, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
    for (const [host, value] of Object.entries(raw as Record<string, unknown>)) {
      if (overflowed) return
      if (!HOSTNAME.test(host)) {
        dropped.push(`domains: 호스트가 아닙니다 "${host.slice(0, 60)}"`)
        continue
      }
      const list = sanitizeSelectors(value, canParse, dropped, `domains.${host}`)
      total += list.length
      if (total > MAX_SELECTORS_TOTAL) {
        overflowed = true
        return
      }
      if (!list.length) continue
      const into = (domains[group] ??= {})
      into[host] = into[host] ? [...new Set([...into[host], ...list])] : list
    }
  }

  if (typeof r.domains === 'object' && r.domains !== null && !Array.isArray(r.domains)) {
    for (const [key, value] of Object.entries(r.domains as Record<string, unknown>)) {
      // Grouped shape: the key is a toggle and the value is a host map. Anything
      // else is the old flat shape, where the key is the host itself.
      if ((TOGGLE_KEYS as readonly string[]).includes(key) && !Array.isArray(value)) {
        takeHosts(key as ToggleKey, value)
      } else {
        takeHosts(DEFAULT_DOMAIN_GROUP, { [key]: value })
      }
      if (overflowed) break
    }
  }
  if (overflowed) {
    return { ok: false, error: `셀렉터 총량 상한(${MAX_SELECTORS_TOTAL}) 초과` }
  }

  // Remote lists never get click rules. See MAX_CLICK_SELECTORS above for why.
  const click: string[] = []
  if (Array.isArray(r.click) && r.click.length > 0) {
    dropped.push(`click: ${r.click.length} rule(s) ignored — remote click rules are not accepted`)
  }

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
      ...(obj.lang === 'ko' || obj.lang === 'en' ? { lang: obj.lang as Lang } : {}),
      rules: { hide, domains, prune, click, allow },
    },
  }
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** One host's worth of selectors, with everything needed to decide if it applies. */
export interface DomainRule {
  host: string
  /** The toggle that switches it off. */
  group: ToggleKey
  /** The UI language it is meant for, or null for every language. */
  lang: Lang | null
  selectors: string[]
}

export interface ResolvedRules {
  /** Hide selectors, grouped by the toggle that controls them. */
  hide: Partial<Record<ToggleKey, string[]>>
  /**
   * Host-scoped selectors, flattened out of every subscribed list.
   *
   * A flat array rather than a map: this is only ever iterated, and a map keyed
   * by host would have to drop either the group or the language when two lists
   * name the same site — which is exactly the case that matters, since a Korean
   * portal has both ad rules and a cookie wall.
   */
  domains: DomainRule[]
  /** The user's own rules. Always applied, regardless of toggles. */
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
 * Precedence: user rules > remote list > bundled defaults. Since the merge is
 * a union, precedence only really matters for `allow`, which applies to the
 * remote and bundled sets but never to the user's own rules — what the user
 * typed always wins.
 */
export function resolveRules(remotes: FilterList[], customRules: string[]): ResolvedRules {
  // `allow` is every list's escape hatch pooled together. A list that names a
  // false positive gets it dropped from the others too — which is the point:
  // the person seeing the broken site does not know which list broke it.
  const allow = new Set(remotes.flatMap((list) => list.rules.allow))
  // Re-run isSafeSelector here. The service worker that validated the list on
  // arrival has no document, so it could not check that a selector really parses.
  const keep = (list: string[]) => list.filter((s) => !allow.has(s) && isSafeSelector(s))

  const hide: Partial<Record<ToggleKey, string[]>> = {}
  for (const key of TOGGLE_KEYS) {
    const merged = keep(union(BUNDLED_HIDE[key], ...remotes.map((list) => list.rules.hide[key])))
    if (merged.length) hide[key] = merged
  }

  const domains: DomainRule[] = []
  for (const list of remotes) {
    for (const [key, value] of Object.entries(list.rules.domains ?? {})) {
      // Both shapes reach here, and not only from old files. `validateFilterList`
      // normalises on the way in, but the cache is written by whichever build
      // fetched the list — so on the first run after an upgrade this is reading
      // the flat map an older build stored. Iterating it as if it were grouped
      // hands `keep` a host name instead of a selector array, and the whole
      // stylesheet dies with it.
      const grouped = !Array.isArray(value) && (TOGGLE_KEYS as readonly string[]).includes(key)
      const group = (grouped ? key : DEFAULT_DOMAIN_GROUP) as ToggleKey
      const hosts = grouped ? (value as Record<string, string[]>) : { [key]: value as string[] }
      for (const [host, selectors] of Object.entries(hosts)) {
        if (!Array.isArray(selectors)) continue
        const kept = keep(selectors)
        if (kept.length) {
          domains.push({ host, group, lang: list.lang ?? null, selectors: kept })
        }
      }
    }
  }

  return {
    hide,
    domains,
    custom: customRules.filter((s) => isSafeSelector(s)),
    // Bundled only — a cache written by an older build may still hold remote
    // click rules, so this is enforced here too, not just at validation time.
    click: keep(BUNDLED_CLICK).slice(0, MAX_CLICK_SELECTORS),
    prune: union(BUNDLED_PRUNE, ...remotes.map((list) => list.rules.prune)),
  }
}

/**
 * The one group that applies away from YouTube.
 *
 * Off YouTube we emit this and nothing else. The `ytd-*` selectors would never
 * match there anyway, but not emitting them keeps the stylesheet small on every
 * page on the web — which is the difference between a cost paid once and a cost
 * paid everywhere.
 */
const GENERIC_GROUPS: readonly ToggleKey[] = ['genericAds', 'cookieBanners']

/** Where a list's host rules land when it does not say which group they belong to. */
const DEFAULT_DOMAIN_GROUP: ToggleKey = 'genericAds'

/**
 * Build the stylesheet from the enabled groups only.
 *
 * One rule per selector, deliberately: joined by commas, a single invalid
 * selector (unsupported syntax, say) makes the browser discard the whole rule.
 */
/** Does this page belong to a host the list named? Subdomains count. */
export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function buildStylesheet(
  rules: ResolvedRules,
  toggles: Record<ToggleKey, boolean>,
  kind: SiteKind = 'youtube',
  hostname = '',
  lang: Lang = 'ko',
): string {
  const groups = kind === 'youtube' ? TOGGLE_KEYS : GENERIC_GROUPS

  const selectors = new Set<string>()
  for (const key of groups) {
    if (!toggles[key]) continue
    for (const s of rules.hide[key] ?? []) selectors.add(s)
  }
  // Host-scoped rules, each answering to its own switch and its own language.
  // A list that declares a language carries rules for that language's sites —
  // the Korean mirror names Korean portals and community sites — and applying
  // those for someone reading in English is a stylesheet on every page for
  // sites they will never open. Generic (non-host) selectors above are never
  // language-gated: an ad slot is an ad slot.
  if (hostname) {
    for (const rule of rules.domains) {
      if (!toggles[rule.group]) continue
      if (rule.lang !== null && rule.lang !== lang) continue
      if (!hostMatches(hostname, rule.host)) continue
      for (const s of rule.selectors) selectors.add(s)
    }
  }
  // The user's own rules are theirs — they apply wherever they put them.
  for (const s of rules.custom) selectors.add(s)
  if (!selectors.size) return ''
  return [...selectors].map((s) => `${s} { display: none !important; }`).join('\n')
}
