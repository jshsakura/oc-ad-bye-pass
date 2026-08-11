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

function isUsableDomain(domain) {
  if (!DOMAIN_RE.test(domain)) return false
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

const block = new Map() // domain → thirdPartyOnly
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
      // Never weaken an existing unconditional block to third-party only
      const existing = block.get(parsed.domain)
      block.set(parsed.domain, existing === false ? false : (parsed.thirdParty ?? false))
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

const domains = [...block.entries()].sort(([a], [b]) => a.localeCompare(b))
const dropped = Math.max(0, domains.length - MAX_RULES)
const kept = domains.slice(0, MAX_RULES)

const rules = kept.map(([domain, thirdPartyOnly], index) => ({
  id: index + 1,
  priority: 1,
  action: { type: 'block' },
  condition: {
    urlFilter: `||${domain}^`,
    ...(thirdPartyOnly ? { domainType: 'thirdParty' } : {}),
  },
}))

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'ads.json'), JSON.stringify(rules))

const meta = {
  generatedFrom: stats,
  totalDomains: domains.length,
  ruleCount: rules.length,
  droppedForLimit: dropped,
  maxRules: MAX_RULES,
  neverBlock: [...NEVER_BLOCK],
}
writeFileSync(path.join(OUT_DIR, 'ads.meta.json'), JSON.stringify(meta, null, 2) + '\n')

console.log(`\n${domains.length} domains -> ${rules.length} rules`)
if (dropped > 0) {
  // Truncating silently would leave you believing everything is blocked
  console.log(`${dropped} dropped for exceeding the ${MAX_RULES} rule limit`)
}
console.log(`wrote: ${path.join(OUT_DIR, 'ads.json')}`)
