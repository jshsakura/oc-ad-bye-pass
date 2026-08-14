// Store screenshots, 1280×800, drawn from the real extension.
//
//   node scripts/make-shots.mjs   # writes assets/store/*.png
//
// Two passes. First the UI itself is captured from a live extension at 2× so it
// stays crisp; then each capture is laid onto a flat 1280×800 card with a
// headline. Flat on purpose — no gradients, no particles (house style).
//
// The popup normally floats over the active tab and reads its URL. Opened as a
// bare page it would see itself, so chrome.tabs.query is stubbed per shot to
// present the site the shot is about.

import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXT = path.join(ROOT, 'dist')
const OUT = path.join(ROOT, 'assets', 'store')
mkdirSync(OUT, { recursive: true })

const LIST_URL =
  'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/filters/list.json'

// The mark, same drawing as public/icons — inlined so composition needs no file.
const MARK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%237e4dc5'/%3E%3Cg transform='translate(32 32) scale(0.9) translate(-32 -32)'%3E%3Cpath fill='%23181825' d='M13.44 13.44a3.52 3.52 0 0 1 3.52-3.52h30.08a3.52 3.52 0 0 1 3.52 3.52V29.14C50.56 42 42.5 50.5 32 55.68 21.5 50.5 13.44 42 13.44 29.14Z'/%3E%3C/g%3E%3Cpath fill='%23fab387' transform='translate(19.39 16.19) scale(0.4128)' d='M32 2c2 16 12 26 28 30-16 4-26 14-28 30-2-16-12-26-28-30C20 28 30 18 32 2Z'/%3E%3Cpath fill='%23ffffff' transform='translate(25.53 22.34) scale(0.2208)' d='M32 2c2 16 12 26 28 30-16 4-26 14-28 30-2-16-12-26-28-30C20 28 30 18 32 2Z'/%3E%3C/svg%3E"

// Flat palette, from the extension's own tokens.
const BG = '#efe9f6'
const INK = '#1f1633'
const MUTED = '#6b6480'
const ACCENT = '#7e4dc5'

function composeHtml({ title, sub, png, uiWidth }) {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `*{margin:0;box-sizing:border-box}html,body{width:1280px;height:800px}` +
    `body{background:${BG};color:${INK};overflow:hidden;padding:0 92px;gap:56px;` +
    `display:flex;align-items:center;` +
    `font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}` +
    `.copy{flex:1;max-width:440px}` +
    `.brand{display:inline-flex;align-items:center;gap:9px;margin-bottom:26px;` +
    `font-size:15px;font-weight:700;letter-spacing:.02em;color:${ACCENT}}` +
    `.brand i{width:26px;height:26px;border-radius:7px;background-size:cover;` +
    `background-image:url("${MARK}")}` +
    `h1{font-size:46px;line-height:1.1;font-weight:800;letter-spacing:-.02em}` +
    `p{margin-top:22px;font-size:19px;line-height:1.5;color:${MUTED}}` +
    `.shot{flex:none;display:flex;align-items:center;justify-content:center}` +
    `.shot img{width:${uiWidth}px;height:auto;max-height:704px;border-radius:16px;` +
    `box-shadow:0 26px 64px rgba(31,22,51,.20),0 2px 8px rgba(31,22,51,.10)}` +
    `</style></head><body>` +
    `<div class="copy"><span class="brand"><i></i>OC Ad Bye-Pass</span>` +
    `<h1>${title}</h1><p>${sub}</p></div>` +
    `<div class="shot"><img src="data:image/png;base64,${png}"></div>` +
    `</body></html>`
  )
}

const ext = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  deviceScaleFactor: 2,
  locale: 'en-US',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})

// No shot may depend on the network. The settings page checks for updates and
// loads the filter list from the same host, so answer both: package.json with
// the current version (so "Latest" reads "up to date", not a fetch error), and
// the list URL with an empty, valid list.
await ext.route('https://raw.githubusercontent.com/**', (route) => {
  const isVersion = route.request().url().endsWith('package.json')
  route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: isVersion
      ? JSON.stringify({ version: '0.12.1' })
      : JSON.stringify({
          name: 'shot',
          version: 1,
          updatedAt: '2026-08-14',
          rules: { hide: { generalAds: [] }, prune: [], click: [], allow: [] },
        }),
  })
})

let [sw] = ext.serviceWorkers()
if (!sw) sw = await ext.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

// A populated, English state so the shots look lived-in.
await sw.evaluate((url) => {
  const settings = {
    enabled: true,
    lang: 'en',
    toggles: {
      videoAds: true,
      generalAds: true,
      shortsAds: true,
      merchandise: true,
      getPremium: true,
      fullscreenAds: true,
      antiAdblockNag: true,
      appPromo: true,
      playerFallback: true,
      genericAds: true,
      pipButton: true,
    },
    listEnabled: true,
    listUrl: url,
    customRules: '',
    allowlist: [],
    savedAt: Date.now(),
  }
  const stats = { pruned: 1243, skipped: 86, since: Date.now() - 9 * 86400000 }
  return Promise.all([
    chrome.storage.local.set({ settings, stats }),
    chrome.storage.sync.set({ settings }),
  ])
}, LIST_URL)

async function popupCapture(tabUrl) {
  const p = await ext.newPage()
  await p.setViewportSize({ width: 440, height: 980 })
  await p.addInitScript((u) => {
    try {
      if (globalThis.chrome?.tabs) chrome.tabs.query = () => Promise.resolve([{ url: u, id: 1, active: true }])
    } catch {}
  }, tabUrl)
  await p.goto(`chrome-extension://${extId}/popup.html`)
  await p.waitForSelector('.popup .stats')
  await p.waitForTimeout(350)
  const buf = await p.locator('.popup').screenshot()
  await p.close()
  return buf.toString('base64')
}

async function optionsCapture() {
  const p = await ext.newPage()
  await p.setViewportSize({ width: 760, height: 860 })
  await p.goto(`chrome-extension://${extId}/options.html`)
  await p.waitForSelector('.page .card')
  await p.waitForTimeout(450)
  const buf = await p.screenshot() // viewport only — the top of the settings
  await p.close()
  return buf.toString('base64')
}

const shots = [
  {
    file: '01-network.png',
    ui: await popupCapture('https://www.naver.com/'),
    uiWidth: 344,
    title: 'Blocks ads on every site',
    sub: 'Ad and tracker requests are stopped at the network level, before they load — on all the web, not just video.',
  },
  {
    file: '02-layers.png',
    ui: await popupCapture('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    uiWidth: 344,
    title: 'Control, layer by layer',
    sub: 'On video sites, ads are stripped out of the player response before you see them. Turn each layer on or off.',
  },
  {
    file: '03-settings.png',
    ui: await optionsCapture(),
    uiWidth: 592,
    title: 'Yours to control',
    sub: 'Filter lists that update on their own, your own hiding rules, a per-site off switch — in English or Korean.',
  },
]

await ext.close()

// Second pass: flat 1280×800 cards at 1×, so the output is exactly store size.
const plain = await chromium.launch({ channel: 'chromium' })
const page = await plain.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
for (const s of shots) {
  await page.setContent(composeHtml({ title: s.title, sub: s.sub, png: s.ui, uiWidth: s.uiWidth }))
  await page.waitForTimeout(150)
  const out = path.join(OUT, s.file)
  await page.screenshot({ path: out })
  console.log('wrote', out)
}
await plain.close()
