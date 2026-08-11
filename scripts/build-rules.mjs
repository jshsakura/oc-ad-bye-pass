// 공개 광고·트래커 목록을 받아 declarativeNetRequest 룰로 변환한다.
//
//   node scripts/build-rules.mjs            # public/rules/ads.json 생성
//   node scripts/build-rules.mjs --stats    # 통계만 출력
//
// ── 왜 도메인만 다루나
//
// ABP 문법 전체(코스메틱, 정규식, 수십 개의 옵션)를 DNR 로 옮기는 건 별개 프로젝트다.
// 대신 **광고·트래커의 90% 를 차지하는 도메인 차단**만 정확히 옮긴다. 변환할 수 없는
// 규칙은 조용히 버리지 않고 몇 개를 왜 버렸는지 보고한다 — 조용히 버리면 "다 됐겠지"로
// 착각하게 된다.
//
// ── 라이선스
//
// 이 프로젝트는 GPLv3 다. 아래 목록들도 GPLv3(또는 호환)이라 그대로 쓸 수 있다.
// 출처는 생성물 안에 남긴다.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'public', 'rules')

/** DNR 정적 룰셋 한도. 크롬이 보장하는 최소치가 30,000 이다. */
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
 * 절대 차단하면 안 되는 도메인.
 *
 * 공개 목록은 대체로 안전하지만 한 줄만 잘못 들어와도 로그인이나 결제가 통째로
 * 막힌다. 그런 사고는 "광고가 안 막힌다"와 차원이 다르므로 우리 쪽에서 한 번 더 막는다.
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
  // 자기 자신이든 상위 도메인이든 보호 목록에 걸리면 버린다
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    if (NEVER_BLOCK.has(parts.slice(i).join('.'))) return false
  }
  return true
}

/**
 * 한 줄을 해석한다. 우리가 다루는 것만 인식하고 나머지는 null 을 돌려준다.
 *
 * 다루는 형태:
 *   ||example.com^                 → 차단
 *   ||example.com^$third-party     → 3rd-party 일 때만 차단
 *   @@||example.com^               → 예외 (차단하지 않음)
 *   0.0.0.0 example.com            → 차단 (hosts 형식)
 */
function parseLine(raw) {
  const line = raw.trim()
  if (!line || line.startsWith('!') || line.startsWith('#') || line.startsWith('[')) return null

  // 코스메틱 규칙은 DNR 이 다루지 않는다
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) {
    return { kind: 'cosmetic' }
  }

  // hosts 형식
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

  // 우리가 표현할 수 있는 옵션만 통과시킨다
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
    console.error(`  ${source.name}: 실패 — ${e.message}`)
    stats.push({ ...source, error: e.message })
    continue
  }

  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed) continue
    counts[parsed.kind] = (counts[parsed.kind] ?? 0) + 1

    if (parsed.kind === 'block') {
      // 이미 무조건 차단이면 third-party 한정으로 낮추지 않는다
      const existing = block.get(parsed.domain)
      block.set(parsed.domain, existing === false ? false : (parsed.thirdParty ?? false))
    } else if (parsed.kind === 'allow') {
      allow.add(parsed.domain)
    }
  }

  stats.push({ name: source.name, license: source.license, url: source.url, counts })
  console.log(
    `  ${source.name.padEnd(22)} 차단 ${String(counts.block).padStart(6)} · 예외 ${String(counts.allow).padStart(5)} · 코스메틱 ${String(counts.cosmetic).padStart(6)} · 미지원 ${counts.unsupported}`,
  )
}

// 예외 목록에 있는 도메인은 차단에서 뺀다
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

console.log(`\n도메인 ${domains.length}개 → 룰 ${rules.length}개`)
if (dropped > 0) {
  // 조용히 자르면 "다 막힌다"고 착각하게 된다
  console.log(`한도(${MAX_RULES})를 넘어 ${dropped}개를 버렸다`)
}
console.log(`출력: ${path.join(OUT_DIR, 'ads.json')}`)
