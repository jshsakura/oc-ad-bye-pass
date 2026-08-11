// Checks the chrome.* APIs we call against Orion's (WebKit) support table.
//
//   node scripts/check-orion-api.mjs
//
// Orion accepts Chrome, Firefox and Safari extensions but implements only about
// 70% of the WebExtensions APIs. Calling one it lacks kills the feature
// **silently, with no error** — the worst kind of failure, because it works
// fine on Chrome and nobody notices.
//
// This fetches the support table Kagi publishes and lines it up against what
// the code actually calls. If the table cannot be fetched (network, moved
// sheet) the check is skipped rather than failed — our CI should not hang on
// somebody else's infrastructure.

import { execFileSync } from 'node:child_process'

const SHEET_ID = '14IgSRVop4psUTgtLZlvYJYrAArhvL3WvRlUdzdQbIoQ'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`

/**
 * Things that are not "Full support" but which we know about and have handled.
 * Every entry must state how it is handled.
 */
const HANDLED = {
  // Network blocking simply does not exist on these targets; the manifest
  // generator strips the key and the ruleset, and network.ts checks for the API
  // before calling it. YouTube is unaffected — layers 1-3 never touch DNR.
  'declarativeNetRequest.getDynamicRules':
    'Absent on Safari/Orion. network.ts returns early when the API is missing; the Safari manifest drops the key entirely.',
  'declarativeNetRequest.updateDynamicRules':
    'Absent on Safari/Orion. Same guard as above — no network layer on those targets, so nothing to exempt.',
  'storage.sync':
    'Partial on Orion. settings.ts writes to both sync and local and reads whichever was saved most recently.',
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

// --- 1. Collect the APIs the code actually calls -----------------------------

const grepped = execFileSync(
  'grep',
  ['-rhoE', String.raw`chrome\.[a-zA-Z]+\.[a-zA-Z]+`, 'src/'],
  { encoding: 'utf8' },
)
/** Type names, not runtime APIs — support is irrelevant since they vanish at build time. */
const TYPES_ONLY = new Set([
  'storage.AreaName',
  'storage.StorageChange',
  'declarativeNetRequest.Rule',
  'declarativeNetRequest.RuleActionType',
  'declarativeNetRequest.ResourceType',
])

const used = [...new Set(grepped.split('\n').filter(Boolean))]
  .map((call) => call.replace(/^chrome\./, ''))
  .filter((call) => !TYPES_ONLY.has(call))
  .sort()

console.log(`APIs called by the code: ${used.length}`)

// --- 2. Fetch Orion's support table ------------------------------------------

let csv
try {
  const res = await fetch(SHEET_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  csv = await res.text()
} catch (e) {
  console.log(`\nCould not fetch the support table (${e.message}) — skipping the check.`)
  process.exit(0)
}

const rows = parseCsv(csv)
const header = rows[0] ?? []
const macCol = header.findIndex((h) => /Orion\s*macOS/i.test(h))
const iosCol = header.findIndex((h) => /Orion\s*iOS/i.test(h))
if (macCol < 0 || iosCol < 0) {
  console.log('\nTable layout changed (no Orion column found) — skipping the check.')
  process.exit(0)
}

/** api (lowercase) -> { component (lowercase) -> [macOS, iOS] } */
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

// --- 3. Compare ---------------------------------------------------------------

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
    console.log(`  handled  ${call.padEnd(32)} macOS=${mac} iOS=${ios}`)
    console.log(`          → ${HANDLED[call]}`)
    continue
  }
  problems.push({ call, mac, ios })
}

if (unlisted.length) {
  console.log(`\nNot listed in the table (needs a human): ${unlisted.join(', ')}`)
}

if (problems.length) {
  console.log('\n=== APIs not supported on Orion ===')
  for (const p of problems) {
    console.log(`  ${p.call.padEnd(32)} macOS=${p.mac || 'absent'}  iOS=${p.ios || 'absent'}`)
  }
  console.log('\nWork out a fallback, then record it in HANDLED in this script.')
  console.log('An unsupported API dies silently on Orion, with no error.')
  process.exit(1)
}

console.log('\nEvery API we use is available on Orion macOS and iOS.')
