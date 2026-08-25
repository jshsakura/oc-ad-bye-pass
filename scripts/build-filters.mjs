// Mirror the upstream filter lists and render them into our own format.
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
// Two corpora come out of this, and they are separate files on purpose. One
// list is capped at MAX_LIST_BYTES (256KB) and the Korean mirror already fills
// two thirds of that, so folding cookie rules into the same file would mean
// throwing away rules from both. They are two subscriptions instead; see
// `Settings.lists`.
//
// The lists and why each is here:
//
//   List-KR    the standard one. Korean portals, news, blogs, webtoon and
//              torrent sites. GPL-3.0, same as this repository.
//   YousList   the older one, still maintained, and almost entirely cosmetic —
//              the best fit of the three for what we can use. CC BY 4.0.
//   갤러리 필터  community sites: dcinside, fmkorea, arca.live, namu.wiki.
//              Small and dense. Apache-2.0.
//
//   Easylist Cookie List   the cookie-wall corpus everyone else builds on.
//                          GPL-3.0 / CC BY-SA 3.0, same terms as EasyList.
//   AdGuard Cookie Notices the second opinion, and the one with better coverage
//                          outside English-language sites. GPL-3.0.
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

/**
 * Files this script writes. Everything else in `filters/` is a hand-written
 * source that gets folded into the merged list.
 *
 * `annoyances.json` is generated *and* excluded from the merge: it is its own
 * subscription, not part of the file the ad rules ship in.
 */
const GENERATED = new Set(['korea.json', 'annoyances.json', 'list.json'])

const KR_SOURCES = [
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

const ANNOYANCE_SOURCES = [
  {
    name: 'Easylist Cookie List',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
    home: 'https://easylist.to/',
    licence: 'GPL-3.0 / CC BY-SA 3.0',
  },
  {
    name: 'AdGuard Cookie Notices',
    url: 'https://filters.adtidy.org/extension/ublock/filters/18.txt',
    home: 'https://github.com/AdguardTeam/AdguardFilters',
    licence: 'GPL-3.0',
  },
]

/**
 * The two things this script builds.
 *
 * `group` is the toggle that switches the corpus off, and it is carried into
 * the generated file rather than assumed at runtime — which is what lets the
 * cookie rules answer to the cookie switch instead of the ad switch.
 *
 * `lang` marks a corpus whose **host** rules only mean something in one UI
 * language. The Korean mirror names Korean portals; carrying those host rules
 * for an English reader is a stylesheet on every page for sites they will never
 * open. Generic selectors are never language-gated.
 */
const CORPORA = [
  {
    file: 'korea.json',
    name: '한국 사이트 광고 차단',
    group: 'genericAds',
    lang: 'ko',
    sources: KR_SOURCES,
    caps: { generic: 1200, perDomain: 300, domains: 4000 },
    // Smaller than the other corpus because this one is merged with video.json
    // into list.json, and it is *that* file the extension fetches and validates
    // against MAX_LIST_BYTES.
    budget: 200 * 1024,
  },
  {
    file: 'annoyances.json',
    name: '쿠키 동의창·성가신 배너',
    group: 'cookieBanners',
    lang: null,
    sources: ANNOYANCE_SOURCES,
    caps: { generic: 1200, perDomain: 40, domains: 3600 },
    budget: 230 * 1024,
  },
]

/*
 * On the byte budgets above.
 *
 * `MAX_LIST_BYTES` is 256KB and a list one byte over it is not truncated at
 * runtime — it is **refused**, wholesale, leaving the user on whatever was
 * cached before. So the trimming happens here, where it can be deliberate and
 * shows up in a diff, rather than as a silent refusal on somebody's phone.
 *
 * The domain caps are set high enough that the budget is what actually binds.
 * A count cap would cut on the wrong axis: it stops at N hosts regardless of
 * what they cost, which is how the Korean corpus once traded 2,000 selectors
 * for 900 hosts that happened to be cheap.
 */

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
const EXTENDED =
  /:(-abp-|has\(|has-text|matches-css|xpath|contains|min-text-length|watch-attr|nth-ancestor|upward|remove\b|style\b)/
const TOO_BROAD = new Set(['*', 'html', ':root', 'body', 'head', 'html *', ':root *'])

/** Cosmetic hide, and nothing else. `#@#` is an exception, `#%#` a scriptlet. */
const RULE = /^([^#$]*)##([^+].*)$/

function usable(selector) {
  const s = selector.trim()
  if (!s || s.length > 512) return null
  if (UNSAFE.test(s)) return null
  if (EXTENDED.test(s)) return null
  if (TOO_BROAD.has(s)) return null
  // Long inline-style matches are brittle and the validator refuses them anyway.
  if (s.length > 200 && /style="/.test(s)) return null
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

/**
 * Which hosts make the cut when there are more than the budget allows.
 *
 * **Cheapest first, then alphabetical.** The obvious ordering is alphabetical
 * alone, and it is wrong: the cookie corpus has more hosts than fit, so a plain
 * alphabetical cut means no rules at all for any site past the letter it stops
 * at. Ordering by how many selectors a host costs buys the most sites per
 * kilobyte, and a host with two rules is not a less important host — usually
 * the opposite, since a long rule list means somebody fought that site for
 * years. The name is the tie-break so the ordering is stable and a rebuild
 * produces a readable diff rather than a reshuffle.
 */
function byCostThenName([hostA, setA], [hostB, setB]) {
  return setA.size - setB.size || hostA.localeCompare(hostB)
}

function render(corpus, into, credits) {
  const domains = {}
  for (const [host, set] of [...into.domains].sort(byCostThenName)) {
    if (Object.keys(domains).length >= corpus.caps.domains) break
    domains[host] = capped(set, corpus.caps.perDomain)
  }

  // Cost order decided *which* hosts are in; the file itself is alphabetical,
  // because that is the order a person looking for one reads in.
  const sorted = {}
  for (const host of Object.keys(domains).sort()) sorted[host] = domains[host]

  return {
    name: corpus.name,
    version: Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')),
    updatedAt: new Date().toISOString().slice(0, 10),
    ...(corpus.lang ? { lang: corpus.lang } : {}),
    _readme:
      '자동 생성 파일입니다. 직접 고치지 마세요 — scripts/build-filters.mjs 가 하루에 한 번 다시 만듭니다. ' +
      '출처: ' + credits.join(' · '),
    rules: {
      hide: { [corpus.group]: capped(into.generic, corpus.caps.generic) },
      domains: { [corpus.group]: sorted },
      prune: [],
      allow: [],
    },
  }
}

/**
 * Drop hosts from the end until the file fits.
 *
 * The end, specifically: hosts are sorted alphabetically, so this is arbitrary
 * with respect to how useful a rule is — but it is *stable*, which matters more.
 * A trim that reshuffles on every run would put the whole corpus in every diff
 * and make a real change impossible to see.
 */
function fitToBudget(list, label, budget) {
  const hosts = list.rules.domains[Object.keys(list.rules.domains)[0]]
  let text = JSON.stringify(list, null, 2) + '\n'
  let removed = 0
  // The most expensive host goes first, for the same reason `byCostThenName`
  // orders them: the budget should buy as many sites as it can.
  while (text.length > budget) {
    const keys = Object.keys(hosts)
    if (!keys.length) break
    const worst = keys.reduce((a, b) => (hosts[b].length > hosts[a].length ? b : a))
    delete hosts[worst]
    removed += 1
    text = JSON.stringify(list, null, 2) + '\n'
  }
  if (removed) console.log(`${label}: 예산(${Math.round(budget / 1024)}KB)에 맞추려 도메인 ${removed}개를 뺐습니다`)
  return text
}

function countOf(list) {
  const hide = Object.values(list.rules.hide).reduce((n, v) => n + v.length, 0)
  const domains = Object.values(list.rules.domains).reduce(
    (n, hosts) => n + Object.values(hosts).reduce((m, v) => m + v.length, 0),
    0,
  )
  return { hide, domains, hosts: Object.values(list.rules.domains).reduce((n, h) => n + Object.keys(h).length, 0) }
}

async function buildCorpus(corpus) {
  const into = { generic: new Set(), domains: new Map() }
  const credits = []

  for (const source of corpus.sources) {
    const text = await fetchList(source)
    const { kept, dropped } = parse(text, into)
    const version = /^! Version:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '?'
    credits.push(`${source.name} (${source.licence}) — ${source.home}`)
    console.log(`${source.name}: v${version} · 가져옴 ${kept} · 버림 ${dropped}`)
  }

  const list = render(corpus, into, credits)
  const rendered = fitToBudget(list, corpus.file, corpus.budget)
  const { hide, domains, hosts } = countOf(list)
  console.log(
    `${corpus.file}: 도메인 ${hosts}개 · 셀렉터 ${hide + domains}개 · ${Math.round(rendered.length / 1024)}KB`,
  )
  return { path: path.join(FILTERS, corpus.file), rendered }
}

async function main() {
  const check = process.argv.includes('--check')
  const built = []
  for (const corpus of CORPORA) built.push(await buildCorpus(corpus))

  if (check) {
    // The version and date move every run; the rules are what a change means.
    const rules = (text) => (text ? JSON.stringify(JSON.parse(text).rules) : '')
    const changed = built.filter((b) => {
      let current = ''
      try {
        current = readFileSync(b.path, 'utf8')
      } catch {
        /* not written yet */
      }
      return rules(current) !== rules(b.rendered)
    })
    if (!changed.length) {
      console.log('바뀐 규칙 없음')
      process.exit(0)
    }
    console.log(`규칙이 바뀌었습니다: ${changed.map((b) => path.basename(b.path)).join(', ')}`)
    process.exit(1)
  }

  for (const b of built) {
    writeFileSync(b.path, b.rendered)
    console.log(`썼습니다: ${path.relative(process.cwd(), b.path)}`)
  }

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

  let lang = null

  for (const file of [...sources, 'korea.json']) {
    const list = JSON.parse(readFileSync(path.join(FILTERS, file), 'utf8'))
    names.push(list.name)
    version = Math.max(version, Number(list.version) || 0)
    // The merged file carries the language of whichever source declared one.
    // Only korea.json does, and only its half has host rules — so the merged
    // list ends up saying exactly what was true before this was expressible:
    // Korean host rules, generic selectors for everyone.
    if (list.lang) lang = list.lang
    for (const [group, selectors] of Object.entries(list.rules.hide ?? {})) {
      hide[group] = [...new Set([...(hide[group] ?? []), ...selectors])]
    }
    for (const [group, hosts] of Object.entries(list.rules.domains ?? {})) {
      const into = (domains[group] ??= {})
      for (const [host, selectors] of Object.entries(hosts)) {
        into[host] = [...new Set([...(into[host] ?? []), ...selectors])]
      }
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
        ...(lang ? { lang } : {}),
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
