// Mirror the Korean filter lists and render them into our own format.
//
//   node scripts/build-filters.mjs          # mirror, convert, merge
//   node scripts/build-filters.mjs --check  # exit 1 if the result differs from disk
//
// **We take cosmetic rules only.** These lists carry network blocking, scriptlet
// injection and anti-adblock counters as well; none of that fits an extension
// that ships data rather than code, and MV3 forbids the interesting half of it
// anyway. What converts cleanly is `##selector` — an element to hide — which is
// exactly what layer 2 already does.
//
// Everything they carry that we cannot express is dropped rather than
// approximated. A rule half-understood is worse than a rule absent: it hides
// something on somebody's screen for a reason nobody can reconstruct.
//
// The three lists and why each is here:
//
//   List-KR    the standard one. Korean portals, news, blogs, webtoon and
//              torrent sites. GPL-3.0, same as this repository.
//   YousList   the older one, still maintained, and almost entirely cosmetic —
//              the best fit of the three for what we can use. CC BY 4.0.
//   갤러리 필터  community sites: dcinside, fmkorea, arca.live, namu.wiki.
//              Small and dense. Apache-2.0.
//
// Attribution is not decoration here — two of these licences require it. It goes
// in the generated file's header, and the file is committed so that what ships is
// reviewable rather than fetched at install time.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const FILTERS = path.resolve(import.meta.dirname, '..', 'filters')
const OUT = path.join(FILTERS, 'korea.json')

/**
 * What the extension actually fetches.
 *
 * The remote list already updates on its own schedule, independent of any
 * release, so a mirrored rule reaches people without a release. This is every
 * list in `filters/` merged into the one file the extension asks for.
 *
 * Every `.json` in that directory that is not generated is a source, so adding
 * one is dropping a file in — nothing here names a site.
 */
const MERGED = path.join(FILTERS, 'list.json')
const GENERATED = new Set(['korea.json', 'list.json'])

const SOURCES = [
  {
    name: 'List-KR',
    url: 'https://cdn.jsdelivr.net/npm/@list-kr/filterslists@latest/dist/filterslist-AdGuard.txt',
    home: 'https://github.com/List-KR/List-KR',
    licence: 'GPL-3.0',
  },
  {
    name: 'YousList',
    url: 'https://raw.githubusercontent.com/yous/YousList/master/youslist.txt',
    home: 'https://github.com/yous/YousList',
    licence: 'CC BY 4.0',
  },
  {
    name: '애드가드 갤러리 필터',
    url: 'https://raw.githubusercontent.com/hooray804/adguard-gallery-filter/main/filter.txt',
    home: 'https://github.com/hooray804/adguard-gallery-filter',
    licence: 'Apache-2.0',
  },
]

/**
 * What the extension's own validator will refuse anyway, refused here so the
 * committed file does not carry rules that silently vanish at runtime.
 *
 * `{` `}` `@` `<` and comment markers can break out of the stylesheet the
 * selectors are pasted into; the rest are extended syntaxes — `:has-text`,
 * `:xpath`, `##^` element removal — that are not CSS and cannot be rendered as
 * `display: none`.
 */
const UNSAFE = /[{}@<>]|\/\*|\*\//
const EXTENDED = /:(-abp-|has-text|matches-css|xpath|contains|min-text-length|watch-attr|nth-ancestor|upward|remove\b|style\b)/
const TOO_BROAD = new Set(['*', 'html', ':root', 'body', 'head'])

/** Cosmetic hide, and nothing else. `#@#` is an exception, `#%#` a scriptlet. */
const RULE = /^([^#$]*)##([^+].*)$/

const MAX_PER_DOMAIN = 300
const MAX_GENERIC = 1200
const MAX_DOMAINS = 900

function usable(selector) {
  const s = selector.trim()
  if (!s || s.length > 512) return null
  if (UNSAFE.test(s)) return null
  if (EXTENDED.test(s)) return null
  if (TOO_BROAD.has(s)) return null
  // A bare tag name points at a class of content rather than an ad.
  if (/^[a-z][a-z0-9]*$/.test(s)) return null
  return s
}

async function fetchList(source) {
  const response = await fetch(source.url, { headers: { 'user-agent': 'oc-ad-bye-pass' } })
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`)
  const text = await response.text()
  if (text.length < 1000) throw new Error(`${source.name}: 응답이 너무 짧습니다 (${text.length}B)`)
  return text
}

/**
 * Split one list into rules that apply everywhere and rules that apply to named
 * domains.
 *
 * A domain-scoped rule applied everywhere is how a filter list breaks unrelated
 * sites, so the scope is kept rather than flattened. Negations (`~foo.com##…`)
 * are dropped entirely: we have no way to say "everywhere except", and guessing
 * would apply the rule to the one place its author excluded.
 */
function parse(text, into) {
  let kept = 0
  let dropped = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue
    const match = RULE.exec(trimmed)
    if (!match) continue

    const selector = usable(match[2])
    if (!selector) {
      dropped += 1
      continue
    }

    const scope = match[1].trim()
    if (!scope) {
      into.generic.add(selector)
      kept += 1
      continue
    }
    if (scope.includes('~')) {
      dropped += 1
      continue
    }
    for (const domain of scope.split(',')) {
      const host = domain.trim().toLowerCase()
      if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue
      if (!into.domains.has(host)) into.domains.set(host, new Set())
      into.domains.get(host).add(selector)
      kept += 1
    }
  }
  return { kept, dropped }
}

/** Newest first, so a domain that outgrows the cap keeps its most specific rules. */
function capped(set, limit) {
  return [...set].slice(0, limit).sort()
}

async function main() {
  const check = process.argv.includes('--check')
  const into = { generic: new Set(), domains: new Map() }
  const credits = []

  for (const source of SOURCES) {
    const text = await fetchList(source)
    const { kept, dropped } = parse(text, into)
    const version = /^! Version:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '?'
    credits.push(`${source.name} (${source.licence}) — ${source.home}`)
    console.log(`${source.name}: v${version} · 가져옴 ${kept} · 버림 ${dropped}`)
  }

  const domains = {}
  for (const [host, set] of [...into.domains].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.keys(domains).length >= MAX_DOMAINS) break
    domains[host] = capped(set, MAX_PER_DOMAIN)
  }

  const list = {
    name: '한국 사이트 광고 차단',
    version: Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')),
    updatedAt: new Date().toISOString().slice(0, 10),
    _readme:
      '자동 생성 파일입니다. 직접 고치지 마세요 — scripts/build-filters.mjs 가 하루에 한 번 다시 만듭니다. ' +
      '출처: ' + credits.join(' · '),
    rules: {
      hide: { genericAds: capped(into.generic, MAX_GENERIC) },
      domains,
      prune: [],
      allow: [],
    },
  }

  const rendered = JSON.stringify(list, null, 2) + '\n'
  const selectorCount =
    list.rules.hide.genericAds.length + Object.values(domains).reduce((n, v) => n + v.length, 0)
  console.log(`도메인 ${Object.keys(domains).length}개 · 셀렉터 ${selectorCount}개 · ${Math.round(rendered.length / 1024)}KB`)

  if (check) {
    let current = ''
    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      /* not written yet */
    }
    // The version and date move every run; the rules are what a change means.
    const rules = (text) => (text ? JSON.stringify(JSON.parse(text).rules) : '')
    if (rules(current) === rules(rendered)) {
      console.log('바뀐 규칙 없음')
      process.exit(0)
    }
    console.log('규칙이 바뀌었습니다')
    process.exit(1)
  }

  writeFileSync(OUT, rendered)
  console.log(`썼습니다: ${path.relative(process.cwd(), OUT)}`)

  writeMerged()
}

/**
 * Every list in `filters/` folded into the one the extension fetches.
 *
 * Hand-written entries are added first so a deliberate rule is never displaced
 * by a mirrored one when a cap is reached.
 */
function writeMerged() {
  const sources = readdirSync(FILTERS)
    .filter((f) => f.endsWith('.json') && !GENERATED.has(f))
    .sort()
  const names = []
  const hide = {}
  const domains = {}
  const prune = new Set()
  const click = new Set()
  const allow = new Set()
  let version = 0

  for (const file of [...sources, 'korea.json']) {
    const list = JSON.parse(readFileSync(path.join(FILTERS, file), 'utf8'))
    names.push(list.name)
    version = Math.max(version, Number(list.version) || 0)
    for (const [group, selectors] of Object.entries(list.rules.hide ?? {})) {
      hide[group] = [...new Set([...(hide[group] ?? []), ...selectors])]
    }
    for (const [host, selectors] of Object.entries(list.rules.domains ?? {})) {
      domains[host] = [...new Set([...(domains[host] ?? []), ...selectors])]
    }
    for (const p of list.rules.prune ?? []) prune.add(p)
    for (const c of list.rules.click ?? []) click.add(c)
    for (const a of list.rules.allow ?? []) allow.add(a)
  }

  const merged =
    JSON.stringify(
      {
        name: names.join(' + '),
        version,
        updatedAt: new Date().toISOString().slice(0, 10),
        _readme:
          '자동 생성 파일입니다. filters/ 안의 모든 리스트를 scripts/build-filters.mjs 가 합친 것이고, ' +
          '확장이 받아가는 것은 이 파일입니다.',
        rules: { hide, domains, prune: [...prune], click: [...click], allow: [...allow] },
      },
      null,
      2,
    ) + '\n'
  writeFileSync(MERGED, merged)
  console.log(`썼습니다: ${path.relative(process.cwd(), MERGED)} (${Math.round(merged.length / 1024)}KB)`)
}

await main()
