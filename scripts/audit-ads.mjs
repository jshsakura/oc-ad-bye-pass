// Measures, against real YouTube, whether ads are still visible. CI runs it on
// a schedule.
//
//   node scripts/audit-ads.mjs [--json report.json]
//
// ── Why this approach
//
// The first version counted "do my selectors match anything?". That was the
// wrong question. Measured for real, only 7 of 57 bundled selectors matched —
// and yet no ads were leaking. YouTube had moved from ytd-*-renderer to a
// *-view-model scheme, but **every new element sat inside a container we
// already catch**:
//
//   ad-badge-view-model < … < ytd-in-feed-ad-layout-renderer < ytd-ad-slot-renderer
//                                                              └ the one we catch
//
// So the question changed to: **with the extension on, is any ad-ish element
// visible on screen?** Whatever the selectors are called, however YouTube
// renames its tags, the answer to that stays meaningful.
//
// ── Why a control group is required
//
// "No ads visible" on its own proves nothing — the page may never have carried
// ads. So we open it without the extension first to confirm ads are really
// there, and only then judge whether they were blocked. No ads in the control
// means the run is recorded as inconclusive.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')

const PAGES = [
  { id: 'home', label: 'home', url: 'https://www.youtube.com/' },
  { id: 'watch', label: 'watch', url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' },
  { id: 'watch2', label: 'watch2', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' },
  { id: 'search', label: 'search', url: 'https://www.youtube.com/results?search_query=laptop' },
]

/**
 * Custom element names we treat as ad-ish.
 * Only hyphenated custom elements are considered — YouTube's UI is built
 * entirely from them.
 */
const AD_TAG = /(^|-)(ad|ads|promo|promoted|sponsor|merch|shopping|mealbar)(-|$)/i

/**
 * Names that contain an ad word but are not ads. Without this list the audit
 * produces false positives that read as "hide the entire UI" — ytd-masthead is
 * the top navigation bar.
 */
const NOT_ADS = new Set([
  'ytd-masthead',
  'ytd-masthead-skeleton',
  'yt-masthead',
  'ytd-rich-grid-media', // an ordinary video card
])

const PASS_TIMEOUT = 60_000

async function launch({ withExtension }) {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      ...(withExtension
        ? [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
        : []),
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
}

/** Collect the ad-ish elements on one page. */
async function collect(context, target) {
  const page = await context.newPage()
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: PASS_TIMEOUT })
    await page.waitForTimeout(3000)
    // Draw out lazily loaded feed ads
    await page.evaluate(() => window.scrollBy(0, 3000))
    await page.waitForTimeout(2500)

    return await page.evaluate(
      ({ adTagSource, notAds }) => {
        const adTag = new RegExp(adTagSource, 'i')
        const skip = new Set(notAds)
        const found = []

        for (const el of document.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase()
          if (!tag.includes('-') || skip.has(tag) || !adTag.test(tag)) continue

          // An already-counted ancestor makes this a duplicate — count only the outermost
          let hasAdAncestor = false
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const parentTag = p.tagName.toLowerCase()
            if (parentTag.includes('-') && !skip.has(parentTag) && adTag.test(parentTag)) {
              hasAdAncestor = true
              break
            }
          }
          if (hasAdAncestor) continue

          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0

          // The ancestor chain, needed when hiding the wrapper as well
          const chain = []
          for (let p = el.parentElement; p && p !== document.body && chain.length < 5; p = p.parentElement) {
            const parentTag = p.tagName.toLowerCase()
            if (parentTag.includes('-')) chain.push(parentTag)
          }

          found.push({ tag, visible, width: Math.round(rect.width), height: Math.round(rect.height), chain })
        }
        return found
      },
      { adTagSource: AD_TAG.source, notAds: [...NOT_ADS] },
    )
  } finally {
    await page.close()
  }
}

async function runPass({ withExtension }) {
  const context = await launch({ withExtension })
  const results = {}
  try {
    for (const target of PAGES) {
      try {
        results[target.id] = await collect(context, target)
      } catch (e) {
        results[target.id] = { error: String(e).split('\n')[0] }
      }
    }
  } finally {
    await context.close()
  }
  return results
}

// ---------------------------------------------------------------------------

console.log('control (no extension) …')
const control = await runPass({ withExtension: false })
console.log('treatment (extension on) …')
const treated = await runPass({ withExtension: true })

const report = { checkedAt: new Date().toISOString(), pages: [], leaks: [], unknownTags: [] }
const leakTags = new Map()
const seenControlTags = new Set()

for (const target of PAGES) {
  const before = control[target.id]
  const after = treated[target.id]

  if (before?.error || after?.error) {
    report.pages.push({ ...target, verdict: 'error', detail: before?.error ?? after?.error })
    continue
  }

  const beforeVisible = before.filter((f) => f.visible)
  const afterVisible = after.filter((f) => f.visible)
  for (const f of before) seenControlTags.add(f.tag)

  let verdict
  if (beforeVisible.length === 0) {
    // No ads on this page to begin with — blocking cannot be judged
    verdict = afterVisible.length === 0 ? 'no-ads' : 'leak'
  } else {
    verdict = afterVisible.length === 0 ? 'blocked' : 'leak'
  }

  if (verdict === 'leak') {
    for (const f of afterVisible) {
      const key = f.tag
      if (!leakTags.has(key)) leakTags.set(key, { tag: f.tag, pages: [], chain: f.chain })
      leakTags.get(key).pages.push(target.id)
    }
  }

  report.pages.push({
    ...target,
    verdict,
    controlVisible: beforeVisible.length,
    treatedVisible: afterVisible.length,
  })
}

report.leaks = [...leakTags.values()]

// Tags our rules do not know about — where a YouTube rename shows up first.
// Both sources must be consulted: the bundle (code) and the shipped filter
// list. Reporting a rule added only to the list as "unknown" forever would blunt
// the signal.
const { BUNDLED_HIDE } = await import('../src/shared/selectors.ts')
const listPath = path.resolve(import.meta.dirname, '..', 'filters', 'video.json')
const shippedList = JSON.parse(readFileSync(listPath, 'utf8'))

const known = new Set(
  [...Object.values(BUNDLED_HIDE).flat(), ...Object.values(shippedList.rules.hide).flat()]
    .flatMap((selector) => [
      selector.match(/^[a-z0-9-]+/)?.[0],
      // Tags named inside :has(...) count as known too — those rules catch the wrapper
      ...[...selector.matchAll(/:has\(\s*>?\s*([a-z0-9-]+)/g)].map((m) => m[1]),
    ])
    .filter(Boolean),
)
report.unknownTags = [...seenControlTags].filter((t) => !known.has(t)).sort()

// ---------------------------------------------------------------------------

console.log('\n=== verdict per page ===')
for (const p of report.pages) {
  const mark =
    p.verdict === 'blocked' ? 'OK  ' : p.verdict === 'leak' ? 'LEAK' : p.verdict === 'no-ads' ? 'INCONCL' : 'ERROR'
  console.log(
    `  ${mark.padEnd(8)} ${p.label.padEnd(7)} control ${p.controlVisible ?? '-'} -> treated ${p.treatedVisible ?? '-'}`,
  )
}

if (report.leaks.length) {
  console.log('\n=== leaking ads (visible with the extension on) ===')
  for (const leak of report.leaks) {
    console.log(`  ${leak.tag}  [${leak.pages.join(', ')}]`)
    console.log(`      ancestors: ${leak.chain.join(' < ')}`)
  }
}

if (report.unknownTags.length) {
  console.log('\n=== ad-ish tags our rules do not know (informational) ===')
  console.log('  ' + report.unknownTags.join('\n  '))
}

const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  const out = path.resolve(process.argv[jsonIndex + 1])
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\nreport: ${out}`)
}

const blocked = report.pages.filter((p) => p.verdict === 'blocked').length
const leaked = report.pages.filter((p) => p.verdict === 'leak').length
console.log(`\n요약: 차단 ${blocked} · 누출 ${leaked} · 판정불가 ${report.pages.length - blocked - leaked}`)

// Fail on a leak — the whole point is for CI to tell us
process.exit(leaked > 0 ? 1 : 0)
