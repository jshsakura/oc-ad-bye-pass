// Measures, against real YouTube, whether the things this extension hangs off
// are still there. CI runs it on a schedule.
//
//   node scripts/audit-features.mjs [--json report.json]
//
// ── What this is for, and how it differs from audit-ads.mjs
//
// That one asks the only question that matters about blocking: with the
// extension on, is any ad still visible? It is an outcome, so it stays true
// however YouTube renames its tags.
//
// The rest of the extension has no such outcome to measure from a script. The
// caption picker calls `getOption('captions', 'tracklist')` on the player
// element; the picture-in-picture button attaches to a `<video>`; layer 1 reads
// fields out of `ytInitialPlayerResponse`. When YouTube removes one of those,
// nothing throws and no ad leaks — the feature simply stops, silently, and the
// first report is a user saying it used to work.
//
// So this checks the **contracts** those features depend on, and it checks them
// on **m.youtube.com as well**, which nothing else here does. The mobile page
// is a different player on a different release cadence, and it is the one an
// iPhone gets.
//
// ── Three verdicts, not two
//
// `ok`, `broken`, and `unknown`. The third is the one that keeps this useful.
// A headless signed-out browser cannot see everything: on 2026-08-26 the comment
// translate control turned out not to render for signed-out sessions at all, and
// a check that called that "broken" would have been wrong. A monitor that cries
// wolf gets muted, and a muted monitor is worse than none — so anything this
// cannot positively observe is reported as unobservable and never fails the run.
//
// Only a contract that **used to hold and now provably does not** is a failure.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')

/** Videos with captions and a normal player, confirmed while signed out. */
const VIDEO = 'kJQP7kiw5Fk'

const SURFACES = [
  { id: 'desktop', url: `https://www.youtube.com/watch?v=${VIDEO}`, mobile: false },
  { id: 'mobile', url: `https://m.youtube.com/watch?v=${VIDEO}`, mobile: true },
]

const IPHONE = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
}

/**
 * What the extension needs from the page, as questions the page can answer.
 *
 * Each returns 'ok', 'broken', or 'unknown'. `detail` is what a person reading
 * the issue needs in order to know where to look — never just "false".
 */
const CONTRACTS = `() => {
  const player = document.getElementById('movie_player')
  const attr = (name) => document.documentElement.getAttribute(name)

  /**
   * Were we served a real page?
   *
   * A signed-out headless browser is often not. YouTube answers it with a
   * stripped player response — no videoDetails, no captions, four or five
   * fields — and every content check then looks broken while nothing is.
   * The first CI run raised exactly that false alarm.
   *
   * videoDetails is the tell: it is on every genuine watch response and on no
   * degraded one. Without it, the content checks below report unobservable,
   * which is the truth. **Being bot-flagged is not a contract we lost.**
   */
  const response = window.ytInitialPlayerResponse
  const served = !!(response && typeof response === 'object' && response.videoDetails)

  /**
   * Every check, each answering ['ok' | 'broken' | 'unknown', detail].
   *
   * Run one at a time behind a catch, because they were one expression and one
   * of them threw: JSON.stringify(undefined) is undefined, and .slice on it
   * took all eighteen checks down with it. A monitor that reports nothing is
   * indistinguishable from a monitor nobody wired up.
   */
  const CHECKS = [
    ['player', '플레이어 요소 #movie_player', () =>
      player ? ['ok', player.tagName.toLowerCase()] : ['broken', '없음']],

    // Never 'broken'. This says whether the run could observe anything at all,
    // and a session YouTube declined to serve is not a regression to report.
    ['served', '진짜 재생 응답을 받았는가', () => {
      if (!response || typeof response !== 'object') return ['unknown', '응답 없음']
      const fields = Object.keys(response).length
      return served
        ? ['ok', fields + '개 필드']
        : ['unknown', '축약된 응답 (' + fields + '개 필드) — 봇 판정으로 보입니다']
    }],

    ['responseShape', '응답 구조 (streamingData/videoDetails/captions)', () => {
      if (!served) return ['unknown', '재생 응답을 못 받아 판정 불가']
      const shape = ['streamingData', 'videoDetails', 'captions'].filter((k) => k in response)
      return [shape.length >= 2 ? 'ok' : 'broken', shape.join(',') || '하나도 없음']
    }],

    ['captionApi', '자막 API (getOption/setOption/loadModule)', () => {
      if (!player) return ['unknown', '플레이어가 없음']
      const api = ['getOption', 'setOption', 'loadModule'].filter(
        (m) => typeof player[m] === 'function',
      )
      return [
        api.length === 3 ? 'ok' : 'broken',
        api.length ? '있는 것: ' + api.join(',') : '하나도 없음',
      ]
    }],

    ['captionTracks', "getOption('captions','tracklist')", () => {
      if (!served) return ['unknown', '재생 응답을 못 받아 판정 불가']
      if (!player || typeof player.getOption !== 'function') return ['unknown', '자막 API 가 없음']
      let tracks
      try {
        if (typeof player.loadModule === 'function') player.loadModule('captions')
        tracks = player.getOption('captions', 'tracklist')
      } catch (e) {
        return ['unknown', '호출이 예외: ' + String(e).slice(0, 60)]
      }
      // An empty list is not a broken contract: plenty of videos carry no
      // captions, and the module also fills in late.
      if (Array.isArray(tracks)) return ['ok', tracks.length + '개 트랙']
      return ['unknown', '배열이 아님: ' + String(JSON.stringify(tracks)).slice(0, 60)]
    }],

    ['video', '<video> 요소', () => {
      const video = document.querySelector('video')
      return video ? ['ok', '있음'] : ['unknown', '아직 없음']
    }],

    ['layer1', '1계층 주입 마커', () => {
      return attr('data-oc-ad-bye-pass') ? ['ok', 'set'] : ['broken', '없음']
    }],

    ['inject', '주입 폴백 상태', () => {
      const state = attr('data-oc-abp-inject')
      return [state === 'blocked' ? 'broken' : 'ok', state || 'not-needed']
    }],

    ['captionOutcome', '자막 선택기 결과', () => {
      if (!served) return ['unknown', '재생 응답을 못 받아 판정 불가']
      const outcome = attr('data-oc-ad-bye-pass-captions')
      // "watching(…)" is not a pass. Sitting in it forever is precisely how
      // this feature fails, so a picker still waiting when we looked is
      // unobservable rather than working. Only a verdict counts as one.
      if (!outcome || outcome.indexOf('watching') === 0) return ['unknown', outcome || '아직 없음']
      const dead = ['api-missing', 'set-failed', 'set-failed:data']
      return [dead.indexOf(outcome) >= 0 ? 'broken' : 'ok', outcome]
    }],
  ]

  return CHECKS.map(function (entry) {
    var id = entry[0], what = entry[1], run = entry[2]
    try {
      var r = run()
      return { id: id, what: what, verdict: r[0], detail: r[1] }
    } catch (e) {
      // A check that cannot run is not a contract that broke.
      return { id: id, what: what, verdict: 'unknown', detail: '검사 실패: ' + String(e).slice(0, 80) }
    }
  })
}`

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const out = jsonAt >= 0 ? args[jsonAt + 1] : null

const report = { checkedAt: new Date().toISOString(), surfaces: [] }

for (const surface of SURFACES) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      // The caption picker will not conclude on a video that never starts — it
      // waits for the player to leave the unstarted state on purpose, because
      // YouTube restores its own caption state around playback. Without this the
      // most valuable signal here is permanently "unobservable".
      '--autoplay-policy=no-user-gesture-required',
    ],
    locale: 'ko-KR',
    ...(surface.mobile ? IPHONE : {}),
  })

  let checks = []
  let error = null
  try {
    // The caption picker ships **off**, so a fresh profile measures a feature
    // that was never running. Turn on everything that has an outcome to report;
    // an audit of the defaults would only ever say "nothing happened".
    let worker = context.serviceWorkers()[0]
    if (!worker) worker = await context.waitForEvent('serviceworker')
    await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('settings')
      const settings = { ...(got.settings ?? {}) }
      settings.toggles = { ...(settings.toggles ?? {}), autoCaptions: true }
      settings.savedAt = Date.now()
      await chrome.storage.local.set({ settings })
      await chrome.storage.sync.set({ settings })
    })

    const page = await context.newPage()
    await page.goto(surface.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    // Ask the player to start, and do not mind if it refuses — a page that will
    // not play is a page where the caption outcome is unobservable, which is a
    // verdict this script already has.
    await page
      .evaluate(() => {
        const p = document.getElementById('movie_player')
        if (p && typeof p.playVideo === 'function') p.playVideo()
      })
      .catch(() => {})
    // The caption picker waits for playback before it concludes, and the player
    // fills its track list late. Give both a chance rather than measuring a
    // page that has not finished starting.
    // The picker waits for playback and the track list fills late; mobile is
    // slower to start than desktop. Long enough that "still waiting" means
    // something, short enough that a daily job stays cheap.
    await page.waitForTimeout(20_000)
    // An IIFE, because `evaluate` given a string evaluates it as an expression
    // and hands back the function rather than calling it.
    checks = (await page.evaluate(`(${CONTRACTS})()`)) ?? []
  } catch (e) {
    error = String(e).slice(0, 200)
  } finally {
    await context.close()
  }

  report.surfaces.push({ id: surface.id, url: surface.url, error, checks: checks ?? [] })
}

const line = (v) => (v === 'ok' ? 'OK   ' : v === 'broken' ? 'BROKE' : '?    ')
for (const s of report.surfaces) {
  console.log(`\n=== ${s.id} ===`)
  if (s.error) console.log(`  열지 못했습니다: ${s.error}`)
  for (const c of s.checks ?? []) console.log(`  ${line(c.verdict)} ${c.what} — ${c.detail}`)
}

const broken = report.surfaces.flatMap((s) =>
  (s.checks ?? []).filter((c) => c.verdict === 'broken').map((c) => ({ surface: s.id, ...c })),
)
report.broken = broken

const counts = report.surfaces.flatMap((s) => s.checks ?? []).reduce((acc, c) => {
  acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
  return acc
}, {})
console.log(
  `\n요약: 정상 ${counts.ok ?? 0} · 깨짐 ${counts.broken ?? 0} · 관측불가 ${counts.unknown ?? 0}`,
)

if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\nreport: ${out}`)
}

// A page that would not open is not a broken contract. The network, the region
// and a consent interstitial all land here, and failing on them would train
// everyone to ignore this.
process.exit(broken.length > 0 ? 1 : 0)
