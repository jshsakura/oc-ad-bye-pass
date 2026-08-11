// 진짜 유튜브에 대고 "광고가 아직 보이는가"를 실측한다. CI 가 주기적으로 돌린다.
//
//   node scripts/audit-ads.mjs [--json report.json]
//
// ── 왜 이 방식인가
//
// 처음엔 "내 셀렉터가 매칭되는가"를 셌다. 그건 틀린 질문이었다. 실측해보니 번들
// 셀렉터 57개 중 7개만 매칭됐는데, 그렇다고 광고가 새는 게 아니었다. 유튜브가
// ytd-*-renderer 에서 *-view-model 체계로 옮겨갔지만 **새 요소들이 전부 우리가 이미
// 잡는 컨테이너 안에** 있었기 때문이다.
//
//   ad-badge-view-model < … < ytd-in-feed-ad-layout-renderer < ytd-ad-slot-renderer
//                                                              └ 우리가 잡는 것
//
// 그래서 질문을 바꿨다. **확장을 켠 채로 광고성 요소가 화면에 보이는가.**
// 셀렉터 이름이 뭐든, 유튜브가 태그를 어떻게 바꾸든, 이 질문의 답은 항상 유효하다.
//
// ── 대조군이 필요한 이유
//
// "광고가 안 보인다"만으로는 아무것도 증명하지 못한다. 그 페이지에 원래 광고가
// 안 붙었을 수도 있다. 그래서 확장 없이 먼저 열어 광고가 실제로 있는지 확인하고,
// 있을 때만 차단 여부를 판정한다. 대조군에 광고가 없으면 '판정 불가'로 남긴다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')

const PAGES = [
  { id: 'home', label: '홈', url: 'https://www.youtube.com/' },
  { id: 'watch', label: '시청', url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' },
  { id: 'watch2', label: '시청2', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' },
  { id: 'search', label: '검색', url: 'https://www.youtube.com/results?search_query=laptop' },
]

/**
 * 광고성으로 볼 커스텀 엘리먼트 이름.
 * 하이픈이 든 커스텀 엘리먼트만 본다 — 유튜브 UI 는 전부 커스텀 엘리먼트다.
 */
const AD_TAG = /(^|-)(ad|ads|promo|promoted|sponsor|merch|shopping|mealbar)(-|$)/i

/**
 * 이름에 광고 단어가 들어가지만 광고가 아닌 것들. 여기 안 넣으면 오탐으로
 * 전체 UI 를 숨기자는 제안이 나온다 — ytd-masthead 는 상단 네비게이션 바다.
 */
const NOT_ADS = new Set([
  'ytd-masthead',
  'ytd-masthead-skeleton',
  'yt-masthead',
  'ytd-rich-grid-media', // 일반 영상 카드
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

/** 한 페이지에서 광고성 요소를 수집한다 */
async function collect(context, target) {
  const page = await context.newPage()
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: PASS_TIMEOUT })
    await page.waitForTimeout(3000)
    // 지연 로딩되는 피드 광고를 끌어낸다
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

          // 조상 중에 이미 잡힌 게 있으면 그건 중복이다 — 가장 바깥것만 센다
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

          // 껍데기째 지울 때 필요한 조상 사슬
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

console.log('대조군 (확장 없음) …')
const control = await runPass({ withExtension: false })
console.log('실험군 (확장 있음) …')
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
    // 원래 광고가 없던 페이지 — 차단 여부를 판정할 수 없다
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

// 우리 규칙이 모르는 태그 — 유튜브가 이름을 바꿨을 때 여기 뜬다.
// 번들(코드)과 배포용 필터 리스트를 **둘 다** 봐야 한다. 리스트에만 추가한 규칙을
// 계속 "모른다"고 보고하면 알림이 무뎌진다.
const { BUNDLED_HIDE } = await import('../src/shared/selectors.ts')
const listPath = path.resolve(import.meta.dirname, '..', 'filters', 'youtube.json')
const shippedList = JSON.parse(readFileSync(listPath, 'utf8'))

const known = new Set(
  [...Object.values(BUNDLED_HIDE).flat(), ...Object.values(shippedList.rules.hide).flat()]
    .flatMap((selector) => [
      selector.match(/^[a-z0-9-]+/)?.[0],
      // :has(...) 안에 적힌 태그도 "안다"로 친다 — 껍데기째 잡는 규칙이다
      ...[...selector.matchAll(/:has\(\s*>?\s*([a-z0-9-]+)/g)].map((m) => m[1]),
    ])
    .filter(Boolean),
)
report.unknownTags = [...seenControlTags].filter((t) => !known.has(t)).sort()

// ---------------------------------------------------------------------------

console.log('\n=== 페이지별 판정 ===')
for (const p of report.pages) {
  const mark =
    p.verdict === 'blocked' ? 'OK  ' : p.verdict === 'leak' ? 'LEAK' : p.verdict === 'no-ads' ? '판정불가' : '오류'
  console.log(
    `  ${mark.padEnd(8)} ${p.label.padEnd(6)} 대조군 ${p.controlVisible ?? '-'} → 실험군 ${p.treatedVisible ?? '-'}`,
  )
}

if (report.leaks.length) {
  console.log('\n=== 새는 광고 (확장을 켰는데도 보임) ===')
  for (const leak of report.leaks) {
    console.log(`  ${leak.tag}  [${leak.pages.join(', ')}]`)
    console.log(`      조상: ${leak.chain.join(' < ')}`)
  }
}

if (report.unknownTags.length) {
  console.log('\n=== 규칙이 모르는 광고성 태그 (참고) ===')
  console.log('  ' + report.unknownTags.join('\n  '))
}

const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  const out = path.resolve(process.argv[jsonIndex + 1])
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\n리포트: ${out}`)
}

const blocked = report.pages.filter((p) => p.verdict === 'blocked').length
const leaked = report.pages.filter((p) => p.verdict === 'leak').length
console.log(`\n요약: 차단 ${blocked} · 누출 ${leaked} · 판정불가 ${report.pages.length - blocked - leaked}`)

// 누출이 있으면 실패시킨다 — CI 가 알려주는 게 목적이다
process.exit(leaked > 0 ? 1 : 0)
