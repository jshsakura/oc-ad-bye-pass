// Fetches public ad and tracker lists and converts them into
// declarativeNetRequest rules.
//
//   node scripts/build-rules.mjs            # writes public/rules/ads.json
//   node scripts/build-rules.mjs --stats    # statistics only
//
// ── Why only domains
//
// Porting the whole ABP syntax (cosmetics, regex, dozens of options) to DNR is
// a separate project. Instead this converts, accurately, the **domain blocking
// that accounts for ~90% of ads and trackers**. Rules that cannot be converted
// are not dropped silently: the count and the reason are reported, because
// silent dropping leaves you believing everything was covered.
//
// ── Licensing
//
// This project is GPLv3. The lists below are GPLv3 (or compatible), so they can
// be used as-is. Their provenance is recorded in the generated output.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'public', 'rules')

/** Static ruleset limit. 30,000 is the minimum Chrome guarantees. */
const MAX_RULES = 30_000

const SOURCES = [
  {
    name: 'AdGuard DNS filter',
    license: 'GPL-3.0',
    url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
  },
  {
    name: 'EasyList',
    license: 'GPL-3.0 / CC BY-SA 3.0',
    url: 'https://easylist.to/easylist/easylist.txt',
  },
  {
    name: 'EasyPrivacy',
    license: 'GPL-3.0 / CC BY-SA 3.0',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
  },
  // The Korean gap. The three lists above are global and carry almost no Korean
  // ad servers, so Naver and the domestic portals went unblocked at the network
  // layer no matter how many rules there were. List-KR's AdGuard list is where
  // the `||veta.naver.com^`, `||adcr.naver.com^`, `||dable.io^` domains live.
  // We already mirror its *cosmetic* half into filters/ (that is the mobile
  // path, where declarativeNetRequest does not exist); this pulls its *network*
  // half into the desktop ruleset. Same list, same GPL-3.0, both halves used.
  {
    name: 'List-KR',
    license: 'GPL-3.0',
    url: 'https://cdn.jsdelivr.net/npm/@list-kr/filterslists@latest/dist/filterslist-AdGuard.txt',
  },
]

/**
 * Domains that must never be blocked.
 *
 * Public lists are generally safe, but one bad line is enough to break sign-in
 * or payment entirely. That failure is in a different class from "an ad got
 * through", so we guard against it on our side as well.
 */
const NEVER_BLOCK = new Set([
  'youtube.com',
  'youtu.be',
  'ytimg.com',
  'googlevideo.com',
  'google.com',
  'accounts.google.com',
  'gstatic.com',
  'github.com',
  'githubusercontent.com',
  'cloudflare.com',
  'paypal.com',
])

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
/** Bare IPs and numeric junk sneak into hosts-format lists; they are not domains. */
const IP_LIKE = /^[0-9.]+$/

/**
 * Networks that must survive the cut no matter what.
 *
 * The lists hold far more domains than the ruleset can (170k against 30k), so
 * something has to be dropped — and dropping the wrong thing is silent. These
 * are the handful whose absence would make the whole exercise pointless.
 */
const ALWAYS_KEEP = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'adsrvr.org',
  'casalemedia.com',
  'openx.net',
  'smartadserver.com',
  'teads.tv',
  'zedo.com',
  'bluekai.com',
  'demdex.net',
  'everesttech.net',
  'branch.io',
  'appsflyer.com',
  'adjust.com',
  'mixpanel.com',
  'hotjar.com',
  'fullstory.com',
  'segment.io',
  'crwdcntrl.net',
  'rlcdn.com',
  'agkn.com',
  'sharethrough.com',
  'yieldmo.com',
  '2mdn.net',
]

function isUsableDomain(domain) {
  if (!DOMAIN_RE.test(domain)) return false
  if (IP_LIKE.test(domain)) return false
  if (domain.length > 253) return false
  // Drop it if the domain or any parent of it is on the protected list
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (NEVER_BLOCK.has(parts.slice(i).join('.'))) return false
  }
  return true
}

/**
 * Parse one line. Recognises only the forms we handle and returns null otherwise.
 *
 * Handled forms:
 *   ||example.com^                 -> block
 *   ||example.com^$third-party     -> block third-party requests only
 *   @@||example.com^               -> exception (do not block)
 *   0.0.0.0 example.com            -> block (hosts format)
 */
function parseLine(raw) {
  const line = raw.trim()
  if (!line || line.startsWith('!') || line.startsWith('#') || line.startsWith('[')) return null

  // DNR does not handle cosmetic rules
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) {
    return { kind: 'cosmetic' }
  }

  // hosts format
  const hosts = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)/)
  if (hosts) {
    const domain = hosts[1].toLowerCase()
    return isUsableDomain(domain) ? { kind: 'block', domain } : { kind: 'skipped', why: 'domain' }
  }

  const exception = line.startsWith('@@')
  const body = exception ? line.slice(2) : line

  if (!body.startsWith('||')) return { kind: 'unsupported' }

  const [pattern, optionText = ''] = body.split('$', 2)
  const match = pattern.match(/^\|\|([^/^*|]+)\^?$/)
  if (!match) return { kind: 'unsupported' }

  const domain = match[1].toLowerCase()
  if (!isUsableDomain(domain)) return { kind: 'skipped', why: 'domain' }

  // Accept only the options we can actually express
  const options = optionText ? optionText.split(',').filter(Boolean) : []
  let thirdParty = false
  for (const option of options) {
    if (option === 'third-party' || option === '3p') thirdParty = true
    else if (option === 'all' || option === 'document') continue
    else return { kind: 'unsupported' }
  }

  return { kind: exception ? 'allow' : 'block', domain, thirdParty }
}

async function fetchList(source) {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`)
  return res.text()
}

// ---------------------------------------------------------------------------

const block = new Map() // domain -> { thirdPartyOnly, sources }
const allow = new Set()
const stats = []

for (const source of SOURCES) {
  const counts = { block: 0, allow: 0, cosmetic: 0, unsupported: 0, skipped: 0 }
  let text
  try {
    text = await fetchList(source)
  } catch (e) {
    console.error(`  ${source.name}: failed — ${e.message}`)
    stats.push({ ...source, error: e.message })
    continue
  }

  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed) continue
    counts[parsed.kind] = (counts[parsed.kind] ?? 0) + 1

    if (parsed.kind === 'block') {
      const existing = block.get(parsed.domain)
      if (existing) {
        // Never weaken an existing unconditional block to third-party only
        existing.thirdPartyOnly = existing.thirdPartyOnly && (parsed.thirdParty ?? false)
        existing.sources.add(source.name)
      } else {
        block.set(parsed.domain, {
          thirdPartyOnly: parsed.thirdParty ?? false,
          sources: new Set([source.name]),
        })
      }
    } else if (parsed.kind === 'allow') {
      allow.add(parsed.domain)
    }
  }

  stats.push({ name: source.name, license: source.license, url: source.url, counts })
  console.log(
    `  ${source.name.padEnd(22)} block ${String(counts.block).padStart(6)} · except ${String(counts.allow).padStart(5)} · cosmetic ${String(counts.cosmetic).padStart(6)} · unsupported ${counts.unsupported}`,
  )
}

// Remove exception-listed domains from the block set
for (const domain of allow) block.delete(domain)

// --- Preprocessing ----------------------------------------------------------
//
// Everything below exists because the lists hold ~170k domains and a static
// ruleset holds 30k. Cutting is unavoidable; cutting badly is silent, and a
// ruleset that looks like 30,000 rules of protection while missing
// doubleclick.net is worse than no ruleset at all.

// 1. Pinned networks are added whether or not any list names them.
//    googlesyndication.com, for one, never appears as a bare domain — the lists
//    carry pagead2.googlesyndication.com and friends instead. Checking that
//    pinned entries survived the cut therefore missed it entirely: it was never
//    a candidate.
for (const domain of ALWAYS_KEEP) {
  if (!block.has(domain)) {
    block.set(domain, { thirdPartyOnly: false, sources: new Set(['pinned']) })
  } else {
    block.get(domain).thirdPartyOnly = false
  }
}

// 2. Subsumption. `||example.com^` already matches every subdomain, so a rule
//    for ads.example.com next to one for example.com is dead weight. Dropping
//    the covered ones is free — identical blocking, a fraction of the rules —
//    and it is where nearly all of the compression comes from.
//
//    A third-party-only parent does not cover an unconditional child, so those
//    are kept.
function coveringAncestor(domain) {
  const labels = domain.split('.')
  for (let i = 1; i < labels.length - 1; i++) {
    const parent = labels.slice(i).join('.')
    const info = block.get(parent)
    if (info && !info.thirdPartyOnly) return parent
  }
  return null
}

let subsumed = 0
for (const domain of [...block.keys()]) {
  const info = block.get(domain)
  const parent = coveringAncestor(domain)
  if (!parent) continue
  // Keep an unconditional child under a conditional parent; otherwise it is covered.
  if (info.thirdPartyOnly || !block.get(parent).thirdPartyOnly) {
    block.delete(domain)
    subsumed++
  }
}

// 3. Rank whatever is still over budget by how much evidence there is that a
//    domain matters:
//      1. pinned networks
//      2. how many independent lists name it (agreement is the best signal)
//      3. shorter names first — ad networks sit at the registrable domain, the
//         long tail is per-campaign subdomains
function rank([domain, info]) {
  const pinned = ALWAYS_KEEP.includes(domain) ? 0 : 1
  return [pinned, -info.sources.size, domain.length, domain]
}

const domains = [...block.entries()].sort((a, b) => {
  const ra = rank(a)
  const rb = rank(b)
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] < rb[i]) return -1
    if (ra[i] > rb[i]) return 1
  }
  return 0
})

// 4. Batch into `requestDomains` rules.
//
//    One rule per domain wastes the budget: 30,000 rules buys 30,000 domains,
//    and the lists hold 166,000. But `condition.requestDomains` takes an array
//    and, like `||domain^`, matches subdomains — so one rule can carry
//    thousands of domains and the whole set fits with rules to spare.
//
//    Batched rather than one giant rule so a single bad entry cannot invalidate
//    everything, and so the ruleset stays diffable.
const BATCH_SIZE = 1000

const dropped = Math.max(0, domains.length - MAX_RULES * BATCH_SIZE)
const kept = domains.slice(0, MAX_RULES * BATCH_SIZE)

// Loud, not silent: a pinned network missing here means the ranking is broken.
const keptSet = new Set(kept.map(([domain]) => domain))
const missingPinned = ALWAYS_KEEP.filter((d) => !keptSet.has(d))
if (missingPinned.length) {
  console.error(`pinned domains missing from the ruleset: ${missingPinned.join(', ')}`)
  process.exit(1)
}

function batch(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const unconditional = kept.filter(([, info]) => !info.thirdPartyOnly).map(([domain]) => domain)
const thirdPartyOnly = kept.filter(([, info]) => info.thirdPartyOnly).map(([domain]) => domain)

let nextId = 1
const rules = [
  ...batch(unconditional, BATCH_SIZE).map((requestDomains) => ({
    id: nextId++,
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains },
  })),
  ...batch(thirdPartyOnly, BATCH_SIZE).map((requestDomains) => ({
    id: nextId++,
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains, domainType: 'thirdParty' },
  })),
]

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'ads.json'), JSON.stringify(rules))

const meta = {
  generatedFrom: stats,
  totalDomains: domains.length,
  blockedDomains: kept.length,
  ruleCount: rules.length,
  batchSize: BATCH_SIZE,
  droppedForLimit: dropped,
  subsumedBySubdomainRule: subsumed,
  maxRules: MAX_RULES,
  pinned: ALWAYS_KEEP.length,
  neverBlock: [...NEVER_BLOCK],
}
writeFileSync(path.join(OUT_DIR, 'ads.meta.json'), JSON.stringify(meta, null, 2) + '\n')

console.log(`\n${subsumed} domains covered by a parent rule and dropped`)
console.log(`${domains.length} domains -> ${rules.length} rules (batched ${BATCH_SIZE}/rule)`)
if (dropped > 0) {
  // Truncating silently would leave you believing everything is blocked
  console.log(`${dropped} dropped for exceeding the ${MAX_RULES} rule limit`)
}
console.log(`wrote: ${path.join(OUT_DIR, 'ads.json')}`)
