// Runs the Firefox package in a real Firefox and checks that it works.
//
//   npm run build:firefox && node scripts/smoke-firefox.mjs            # with youtube.com
//   node scripts/smoke-firefox.mjs --no-live                           # offline checks only
//
// Everything else we know about the Firefox build is inference — the linter
// passed, the bundle is an IIFE, `chrome.*` returns promises in Gecko. None of
// that is the extension running. v0.23.0 through v0.25.0 went to AMO on that
// inference alone, which is the gap this script closes: it installs the package
// into Gecko and asks the things that only running can answer.
//
// Playwright cannot load a Firefox extension, so this drives geckodriver over
// plain WebDriver HTTP — no library. The binaries are not installed on the
// system; they live in a cache directory:
//
//   D=~/.cache/oc-firefox; mkdir -p $D; cd $D
//   curl -sSL -o ff.tar.xz 'https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US'
//   tar xf ff.tar.xz
//   curl -sSL <geckodriver linux64 .tar.gz from github.com/mozilla/geckodriver/releases> | tar xz
//
// Override with FIREFOX_BIN and GECKODRIVER.

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.dirname(import.meta.dirname)
const CACHE = path.join(homedir(), '.cache', 'oc-firefox')
const FIREFOX = process.env.FIREFOX_BIN ?? path.join(CACHE, 'firefox', 'firefox')
const GECKODRIVER = process.env.GECKODRIVER ?? path.join(CACHE, 'geckodriver')
const ADDON_ID = 'oc-ad-bye-pass@jshsakura.com'
const LIVE = !process.argv.includes('--no-live')
const PORT = 4444 + Math.floor(Math.random() * 1000)

for (const [label, bin] of [['Firefox', FIREFOX], ['geckodriver', GECKODRIVER]]) {
  if (!existsSync(bin)) {
    console.error(`${label} 이 없다: ${bin} — 파일 머리의 안내대로 받아둔다`)
    process.exit(2)
  }
}
if (!existsSync(path.join(ROOT, 'dist-firefox', 'manifest.json'))) {
  console.error('dist-firefox 가 없다 — npm run build:firefox 먼저')
  process.exit(2)
}

const failures = []
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}

// ── WebDriver over HTTP ────────────────────────────────────────────────────
const base = `http://127.0.0.1:${PORT}`
let session = null

async function wd(method, route, body) {
  const url = session ? `${base}/session/${session}${route}` : `${base}${route}`
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${method} ${route}: ${json.value?.error} — ${json.value?.message}`)
  return json.value
}
const go = (url) => wd('POST', '/url', { url })
const run = (script, ...args) => wd('POST', '/execute/sync', { script, args })
const runAsync = (script, ...args) => wd('POST', '/execute/async', { script, args })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll a page-side expression until it is truthy or time runs out. Returns the last value. */
async function waitFor(script, { timeout = 8000 } = {}) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    last = await run(script)
    if (last) return last
    await sleep(200)
  }
  return last
}

// ── Firefox ────────────────────────────────────────────────────────────────
// `--allow-system-access` is what lets the chrome-context script below read the
// extension's UUID pref. It is geckodriver's own flag — passing the equivalent
// through Firefox capabilities is refused.
const driver = spawn(
  GECKODRIVER,
  ['--port', String(PORT), '--binary', FIREFOX, '--allow-system-access'],
  { stdio: 'ignore' },
)
const scratch = mkdtempSync(path.join(tmpdir(), 'oc-ff-'))
const xpi = path.join(scratch, 'oc-ad-bye-pass.xpi')

try {
  // geckodriver needs a moment to listen.
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/status`); break } catch { await sleep(100) }
  }

  session = (await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': { binary: FIREFOX, args: ['-headless', '-width', '1280', '-height', '900'] },
      },
    },
  })).sessionId

  const version = await run('return navigator.userAgent')
  console.log(`Firefox: ${version.match(/Firefox\/[\d.]+/)?.[0] ?? version}`)

  // ── Install ──────────────────────────────────────────────────────────────
  // A temporary install is what about:debugging does; it accepts the unsigned
  // package, which is the only way to run a build AMO has not signed yet.
  execFileSync('zip', ['-qr', xpi, '.'], { cwd: path.join(ROOT, 'dist-firefox') })
  let installed = null
  try {
    installed = await wd('POST', '/moz/addon/install', { path: xpi, temporary: true })
  } catch (e) {
    check('Gecko 가 매니페스트를 받아들인다', false, e.message)
    throw e
  }
  check('Gecko 가 매니페스트를 받아들인다', installed === ADDON_ID, `설치된 id: ${installed}`)

  // The extension's internal origin is a per-profile UUID; the mapping is a
  // pref, readable from the chrome context. Nothing in content can see it.
  await wd('POST', '/moz/context', { context: 'chrome' })
  const uuids = JSON.parse(
    await run('return Services.prefs.getStringPref("extensions.webextensions.uuids")'),
  )
  await wd('POST', '/moz/context', { context: 'content' })
  const uuid = uuids[ADDON_ID]
  check('확장에 내부 origin 이 배정됐다', !!uuid)
  const origin = `moz-extension://${uuid}`

  // ── Background ───────────────────────────────────────────────────────────
  // Asked from an extension page, which shares the API surface with the event
  // page. Settings existing at all means onInstalled ran — i.e. background.js
  // executed as an event page, service_worker key or not.
  await go(`${origin}/popup.html`)
  const settings = await runAsync(
    'const done = arguments[0]; browser.storage.local.get("settings").then((r) => done(r.settings ?? null)).catch((e) => done({ error: String(e) }))',
  )
  check('이벤트 페이지가 돌아 기본 설정을 심었다', !!settings && !settings.error && settings.toggles, JSON.stringify(settings)?.slice(0, 120))
  check('저장된 설정에 sponsorCategories 가 있다', Array.isArray(settings?.sponsorCategories))

  const manifest = await run('return browser.runtime.getManifest()')
  check('매니페스트가 이벤트 페이지 형태다', Array.isArray(manifest?.background?.scripts) && !manifest.background.service_worker)
  check('gecko id 가 박혀 있다', manifest?.browser_specific_settings?.gecko?.id === ADDON_ID)

  // `chrome.*` returning a promise is the assumption the whole build leans on.
  const viaChrome = await runAsync(
    'const done = arguments[0]; try { const p = chrome.storage.local.get("settings"); done(p && typeof p.then === "function") } catch (e) { done(String(e)) }',
  )
  check('chrome.* 가 프라미스를 돌려준다 (Gecko MV3)', viaChrome === true, String(viaChrome))

  // ── Network layer ────────────────────────────────────────────────────────
  const rulesets = await runAsync(
    'const done = arguments[0]; browser.declarativeNetRequest.getEnabledRulesets().then(done).catch((e) => done({ error: String(e) }))',
  )
  check('DNR 정적 룰셋 "ads" 가 켜져 있다', Array.isArray(rulesets) && rulesets.includes('ads'), JSON.stringify(rulesets))
  const ruleCount = await runAsync(
    'const done = arguments[0]; browser.declarativeNetRequest.getAvailableStaticRuleCount().then(done).catch((e) => done(-1))',
  )
  check('정적 룰 여유분을 보고한다', typeof ruleCount === 'number' && ruleCount > 0, String(ruleCount))

  // ── Popup ────────────────────────────────────────────────────────────────
  const rows = await waitFor('return document.querySelectorAll(".list .row").length')
  check('팝업이 그려진다 (토글 행 있음)', rows > 0, `행 ${rows}개`)
  await run('document.querySelector(".foot button")?.click()')
  await sleep(300)
  const labels = await run('return [...document.querySelectorAll(".list .row .label")].map((e) => e.textContent)')
  check('데스크톱 Gecko 라 PiP 스위치가 없다', Array.isArray(labels) && !labels.some((l) => /PiP/i.test(l)), labels?.join(' | '))
  check('스폰서 접힘 줄이 있다', await run('return !!document.querySelector(".sponsor-cats summary .sponsor-count")'))
  const dir = await run('return document.documentElement.dir + "|" + document.documentElement.lang')
  check('문서 lang 이 붙는다', /^(ltr|rtl)?\|.+/.test(dir), dir)

  // ── Content scripts on a page ────────────────────────────────────────────
  // world:"MAIN" is the thing 128 brought. The MAIN script stamps the html
  // element; if Gecko ignored the field, main.js ran in the isolated world and
  // the stamp is still there — but injectMain's marker would then read
  // "loaded"/"blocked" rather than "not-needed", and that is the tell.
  if (LIVE) {
    await go('https://example.com/')
    const stamp = await waitFor('return document.documentElement.getAttribute("data-oc-ad-bye-pass")')
    check('MAIN world 스크립트가 페이지에 도달했다 (example.com)', stamp === '1', `stamp=${stamp}`)
    const inject = await waitFor('return document.documentElement.getAttribute("data-oc-abp-inject")')
    check('ISOLATED 가 돌았고 MAIN 이 먼저였다 (not-needed)', inject === 'not-needed', `inject=${inject}`)

    // YouTube itself: the one page the whole thing is for.
    await go('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    const ytStamp = await waitFor('return document.documentElement.getAttribute("data-oc-ad-bye-pass")', { timeout: 15000 })
    check('유튜브에서 1계층(MAIN)이 붙었다', ytStamp === '1', `stamp=${ytStamp}`)
    const ytInject = await waitFor('return document.documentElement.getAttribute("data-oc-abp-inject")', { timeout: 15000 })
    check('유튜브에서 주입 상태가 정상이다', ytInject === 'not-needed' || ytInject === 'loaded', `inject=${ytInject}`)
    const hasVideo = await waitFor('return !!document.querySelector("video")', { timeout: 20000 })
    check('플레이어 <video> 가 있다', hasVideo === true)
    const noPipButton = await run('return !document.getElementById("oc-abp-pip")')
    check('데스크톱 Gecko 라 PiP 버튼을 그리지 않았다', noPipButton === true)
    const captionsAttr = await run('return document.documentElement.hasAttribute("data-oc-ad-bye-pass-captions")')
    console.log(`  · 자막 자동선택 표식: ${captionsAttr ? '있음' : '없음 (토글 기본값 꺼짐이면 정상)'}`)
  } else {
    console.log('  · --no-live: 실제 페이지 검사 건너뜀')
  }
} catch (e) {
  console.error(`\n중단: ${e.message}`)
  failures.push('스크립트 중단')
} finally {
  if (session) await wd('DELETE', '').catch(() => {})
  driver.kill()
  rmSync(scratch, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n파이어폭스 스모크 실패 ${failures.length}건`)
  process.exit(1)
}
console.log('\n파이어폭스 스모크 통과')
