// Exercises the Safari build's MAIN world entry paths, for real, in Chromium.
//
// Why this is needed: every other spec loads only dist/ (the Chrome build), and
// the Chrome build contains not one byte of Safari code (verify-targets
// enforces that). So until now ensureMainWorldScript and
// injectMainWorldFallback had zero coverage.
//
// This is not real Safari, but **our own branches do execute** — Chromium
// supports world:'MAIN' in scripting.registerContentScripts too.
//
// What makes the verdict clean: the Safari manifest declares no MAIN content
// script. So if layer 1 is alive, runtime registration or the injection
// fallback is the only possible explanation.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const SAFARI_DIST = path.resolve(import.meta.dirname, '..', 'dist-safari')
const SCRIPT_ID = 'oc-ad-bye-pass-main'

test.skip(
  !existsSync(path.join(SAFARI_DIST, 'manifest.json')),
  'dist-safari 가 없다: TARGET=safari npm run build',
)

interface SafariSession {
  context: BrowserContext
  worker: Worker
  extensionId: string
}

async function launchSafariBuild(): Promise<SafariSession> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${SAFARI_DIST}`,
      `--load-extension=${SAFARI_DIST}`,
      ...LAUNCH_ARGS,
    ],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  return { context, worker, extensionId: new URL(worker.url()).host }
}

function registeredMainScript(worker: Worker) {
  return worker.evaluate(async (id) => {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [id] })
    return scripts.length ? { world: scripts[0].world, runAt: scripts[0].runAt } : null
  }, SCRIPT_ID)
}

test('Safari 매니페스트에는 MAIN world 콘텐츠 스크립트가 없다', () => {
  const manifest = JSON.parse(readFileSync(path.join(SAFARI_DIST, 'manifest.json'), 'utf8')) as {
    content_scripts: { js: string[]; world?: string }[]
    permissions: string[]
    web_accessible_resources?: { resources: string[] }[]
  }

  // Left out on purpose: some Safari versions ignore `world` on static
  // content_scripts. If this test breaks, the reasoning behind the two below
  // collapses with it.
  expect(manifest.content_scripts.some((cs) => cs.world === 'MAIN')).toBe(false)
  expect(manifest.content_scripts.flatMap((cs) => cs.js)).toEqual(['isolated.js'])

  // For the runtime registration
  expect(manifest.permissions).toContain('scripting')
  // For the injection fallback — main.js has to be reachable from the page
  expect(manifest.web_accessible_resources?.flatMap((r) => r.resources)).toContain('main.js')
})

test('정상 경로 — 런타임 등록만으로 1계층이 산다', async () => {
  const { context, worker } = await launchSafariBuild()
  try {
    // Wait for the background to register the MAIN world script
    await expect
      .poll(() => registeredMainScript(worker), { message: 'registerContentScripts 가 안 돌았다' })
      .toEqual({ world: 'MAIN', runAt: 'document_start' })

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // The manifest declares no MAIN script, so this being true means runtime registration took
    await expect.poll(() => layer1Active(page), { message: '1계층' }).toBe(true)
    await expect.poll(() => layer2Active(page), { message: '2계층' }).toBe(true)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  } finally {
    await context.close()
  }
})

test('폴백 경로 — 등록이 없으면 주입으로 1계층을 살린다', async () => {
  const { context, worker } = await launchSafariBuild()
  try {
    await expect.poll(() => registeredMainScript(worker)).not.toBeNull()

    // Tearing the registration down reproduces registerContentScripts failing on
    // an older Safari. ensureMainWorldScript only runs at worker startup, so it
    // will not re-register.
    await worker.evaluate(
      (id) => chrome.scripting.unregisterContentScripts({ ids: [id] }),
      SCRIPT_ID,
    )
    expect(await registeredMainScript(worker), '등록이 남아 있으면 폴백을 시험할 수 없다').toBeNull()

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // From here, layer 1 being alive can only be down to the <script src> injection
    await expect
      .poll(() => layer1Active(page), { message: '주입 폴백이 1계층을 못 살렸다' })
      .toBe(true)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  } finally {
    await context.close()
  }
})

test('두 경로가 겹쳐도 훅은 한 번만 걸린다', async () => {
  // Execution order is not guaranteed, so the normal registration and the
  // injection fallback can both fire. If installHooks() then runs twice,
  // JSON.parse ends up double-wrapped — ads still disappear, so it reads as a
  // pass, while the stats inflate and the hooks stack.
  const { context, worker, extensionId } = await launchSafariBuild()
  try {
    await expect.poll(() => registeredMainScript(worker)).not.toBeNull()

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect.poll(() => layer1Active(page)).toBe(true)

    // Reproduce exactly the case where the fallback injects a second time
    await page.evaluate(async (url) => {
      await new Promise<void>((resolve) => {
        const script = document.createElement('script')
        script.src = url
        script.async = false
        script.addEventListener('load', () => resolve())
        script.addEventListener('error', () => resolve())
        document.documentElement.appendChild(script)
      })
    }, `chrome-extension://${extensionId}/main.js`)

    // Zero the stats — but first let the pending batch land. The content script
    // reports pruning counts in 3-second batches, so a count produced by the
    // probe above would otherwise arrive just after the reset and skew the total.
    await page.waitForTimeout(4000)
    await worker.evaluate(() =>
      chrome.storage.local.set({ stats: { pruned: 0, skipped: 0, since: Date.now() } }),
    )

    // Parse, 12 times, a JSON payload holding exactly one ad field
    const PARSES = 12
    await page.evaluate((count) => {
      for (let i = 0; i < count; i++) JSON.parse('{"adPlacements":[{}],"videoDetails":{}}')
    }, PARSES)

    // Hooked once, this is exactly 12. Double-wrapped, it comes out higher.
    await expect
      .poll(
        async () => {
          const got = (await worker.evaluate(() => chrome.storage.local.get('stats'))) as {
            stats?: { pruned: number }
          }
          return got.stats?.pruned ?? 0
        },
        { timeout: 20_000, message: '프루닝 카운터' },
      )
      .toBe(PARSES)

    // The disguise must hold too, not stack in layers
    expect(await page.evaluate(() => JSON.parse.toString())).toContain('[native code]')
  } finally {
    await context.close()
  }
})
