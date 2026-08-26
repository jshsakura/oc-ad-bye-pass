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
  const out = []
  const add = (id, what, verdict, detail) => out.push({ id, what, verdict, detail })

  const player = document.getElementById('movie_player')
  if (!player) {
    // Everything below hangs off it, so this is reported once and the rest are
    // unobservable rather than broken — the page may simply not have finished.
    add('player', '플레이어 요소 #movie_player', 'broken', '없음')
    return out
  }
  add('player', '플레이어 요소 #movie_player', 'ok', player.tagName.toLowerCase())

  // Layer 1 — the fields the pruner cuts out of the player response.
  const r = window.ytInitialPlayerResponse
  if (!r || typeof r !== 'object') {
    add('playerResponse', 'ytInitialPlayerResponse 전역', 'unknown', '아직 없음')
  } else {
    const keys = Object.keys(r)
    add('playerResponse', 'ytInitialPlayerResponse 전역', 'ok', keys.length + '개 필드')
    // Not "ads are present" — whether the shape we prune still exists at all.
    const shape = ['streamingData', 'videoDetails', 'captions'].filter((k) => k in r)
    add(
      'responseShape',
      '응답 구조 (streamingData/videoDetails/captions)',
      shape.length >= 2 ? 'ok' : 'broken',
      shape.join(',') || '하나도 없음',
    )
  }

  // The caption picker's whole surface.
  const api = ['getOption', 'setOption', 'loadModule'].filter(
    (m) => typeof player[m] === 'function',
  )
  add(
    'captionApi',
    '자막 API (getOption/setOption/loadModule)',
    api.length === 3 ? 'ok' : 'broken',
    api.length ? '있는 것: ' + api.join(',') : '하나도 없음',
  )

  if (api.length === 3) {
    let tracks
    try {
      player.loadModule('captions')
      tracks = player.getOption('captions', 'tracklist')
    } catch (e) {
      tracks = { error: String(e) }
    }
    if (Array.isArray(tracks)) {
      // An empty list is not a broken contract — plenty of videos have no
      // captions, and the module also fills in late.
      add(
        'captionTracks',
        "getOption('captions','tracklist')",
        'ok',
        tracks.length + '개 트랙',
      )
    } else {
      add('captionTracks', "getOption('captions','tracklist')", 'unknown', '배열이 아님: ' + JSON.stringify(tracks).slice(0, 80))
    }
  }

  // The picture-in-picture button attaches to the video element's box.
  const video = document.querySelector('video')
  add('video', '<video> 요소', video ? 'ok' : 'unknown', video ? '있음' : '아직 없음')

  // Layer 1 marks the document once it has reached the page's own world.
  const layer1 = document.documentElement.getAttribute('data-oc-ad-bye-pass')
  add('layer1', '1계층 주입 마커', layer1 ? 'ok' : 'broken', layer1 ? 'set' : '없음')

  const inject = document.documentElement.getAttribute('data-oc-abp-inject')
  add('inject', '주입 폴백 상태', inject === 'blocked' ? 'broken' : 'ok', inject ?? 'not-needed')

  // What the caption picker actually concluded on this video.
  //
  // "watching(…)" is not a pass. Sitting in it forever is precisely how this
  // feature fails — a phone once spent an afternoon frozen there — so a picker
  // still waiting when we looked is unobservable, not working. Only a verdict
  // counts as one.
  const captions = document.documentElement.getAttribute('data-oc-ad-bye-pass-captions')
  const dead = ['api-missing', 'set-failed', 'set-failed:data']
  add(
    'captionOutcome',
    '자막 선택기 결과',
    !captions || captions.startsWith('watching')
      ? 'unknown'
      : dead.includes(captions)
        ? 'broken'
        : 'ok',
    captions ?? '아직 없음',
  )

  return out
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
