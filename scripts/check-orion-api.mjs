// 우리가 쓰는 chrome.* API 가 Orion(WebKit)에서 지원되는지 대조한다.
//
//   node scripts/check-orion-api.mjs
//
// Orion 은 Chrome/Firefox/Safari 확장을 다 받지만 WebExtensions API 를 약 70%만
// 구현했다. 안 되는 API 를 쓰면 **오류 없이 조용히** 기능만 죽는다 — 그게 제일 나쁘다.
// Chrome 에서 멀쩡히 도니까 아무도 눈치를 못 챈다.
//
// Kagi 가 공개하는 지원 표를 받아 코드가 실제로 호출하는 API 와 맞춰본다.
// 표를 못 받으면(네트워크·시트 이동) 실패시키지 않고 건너뛴다 — 남의 인프라에
// 우리 CI 를 묶어두지 않는다.

import { execFileSync } from 'node:child_process'

const SHEET_ID = '14IgSRVop4psUTgtLZlvYJYrAArhvL3WvRlUdzdQbIoQ'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`

/**
 * "Full support 가 아니지만 우리가 알고 대응해 둔" 것들.
 * 여기 적을 때는 반드시 대응 방법을 같이 적는다.
 */
const HANDLED = {
  'storage.sync':
    'Orion 은 Partial. settings.ts 가 sync/local 양쪽에 쓰고 읽을 때 sync 를 우선한다',
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

// --- 1. 코드가 실제로 호출하는 API 수집 -------------------------------------

const grepped = execFileSync(
  'grep',
  ['-rhoE', String.raw`chrome\.[a-zA-Z]+\.[a-zA-Z]+`, 'src/'],
  { encoding: 'utf8' },
)
/** 런타임 API 가 아니라 타입 이름이라 지원 여부와 무관하다 (빌드 때 지워진다) */
const TYPES_ONLY = new Set(['storage.AreaName', 'storage.StorageChange'])

const used = [...new Set(grepped.split('\n').filter(Boolean))]
  .map((call) => call.replace(/^chrome\./, ''))
  .filter((call) => !TYPES_ONLY.has(call))
  .sort()

console.log(`코드가 호출하는 API: ${used.length}개`)

// --- 2. Orion 지원 표 받기 ---------------------------------------------------

let csv
try {
  const res = await fetch(SHEET_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  csv = await res.text()
} catch (e) {
  console.log(`\n지원 표를 받지 못했습니다 (${e.message}) — 검사를 건너뜁니다.`)
  process.exit(0)
}

const rows = parseCsv(csv)
const header = rows[0] ?? []
const macCol = header.findIndex((h) => /Orion\s*macOS/i.test(h))
const iosCol = header.findIndex((h) => /Orion\s*iOS/i.test(h))
if (macCol < 0 || iosCol < 0) {
  console.log('\n표 형식이 바뀌었습니다 (Orion 열을 못 찾음) — 검사를 건너뜁니다.')
  process.exit(0)
}

/** api(소문자) → { component(소문자) → [macOS, iOS] } */
const table = new Map()
let currentApi = null
for (const row of rows) {
  if (row.length <= iosCol) continue
  if (row[1]?.trim()) currentApi = row[1].trim().toLowerCase()
  const component = row[2]?.trim()
  if (!currentApi || !component) continue
  if (!table.has(currentApi)) table.set(currentApi, new Map())
  table.get(currentApi).set(component.toLowerCase(), [row[macCol]?.trim(), row[iosCol]?.trim()])
}

// --- 3. 대조 ------------------------------------------------------------------

const problems = []
const unlisted = []

for (const call of used) {
  const [api, component] = call.split('.')
  const entry = table.get(api.toLowerCase())
  const support = entry?.get(component.toLowerCase())

  if (!support) {
    unlisted.push(call)
    continue
  }

  const [mac, ios] = support
  const ok = (v) => /full support/i.test(v ?? '')
  if (ok(mac) && ok(ios)) continue

  if (HANDLED[call]) {
    console.log(`  대응됨  ${call.padEnd(32)} macOS=${mac} iOS=${ios}`)
    console.log(`          → ${HANDLED[call]}`)
    continue
  }
  problems.push({ call, mac, ios })
}

if (unlisted.length) {
  console.log(`\n표에 없는 항목 (사람이 확인 필요): ${unlisted.join(', ')}`)
}

if (problems.length) {
  console.log('\n=== Orion 에서 지원되지 않는 API ===')
  for (const p of problems) {
    console.log(`  ${p.call.padEnd(32)} macOS=${p.mac || '없음'}  iOS=${p.ios || '없음'}`)
  }
  console.log('\n대응 방법을 만든 뒤 이 스크립트의 HANDLED 에 적어 주세요.')
  console.log('안 되는 API 는 Orion 에서 오류 없이 조용히 죽습니다.')
  process.exit(1)
}

console.log('\n우리가 쓰는 API 는 Orion macOS/iOS 에서 모두 사용 가능합니다.')
