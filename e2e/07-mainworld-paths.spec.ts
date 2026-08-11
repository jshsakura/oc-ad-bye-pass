// Exercises the MAIN world entry paths that keep layer 1 alive where the static
// `world` declaration is ignored — which is every WebKit browser, Orion
// included, and Orion is how this extension gets onto a phone.
//
// Those paths cannot be exercised by loading dist/ as it ships: Chromium honours
// the static declaration, so layer 1 would be alive for that reason and the test
// would prove nothing. So the fixture is dist/ with the static MAIN content
// script stripped out of its manifest — the same package, minus the fast path.
// If layer 1 is alive there, runtime registration or the injection fallback is
// the only possible explanation.
//
// This used to load the Safari build, which had that shape by construction. The
// Safari target was dropped on 2026-08-11; the coverage was not.

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')
const FIXTURE = path.resolve(import.meta.dirname, '..', 'test-results', 'no-static-main')
const SCRIPT_ID = 'oc-ad-bye-pass-main'

test.skip(!existsSync(path.join(DIST, 'manifest.json')), 'dist 가 없다: npm run build')

// Built once for the file. Copying the 3.8MB ruleset three times would be silly,
// and the tests only read it.
test.beforeAll(() => {
  rmSync(FIXTURE, { recursive: true, force: true })
  cpSync(DIST, FIXTURE, { recursive: true })

  const manifestPath = path.join(FIXTURE, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    content_scripts: { js: string[]; world?: string }[]
  }
  const before = manifest.content_scripts.length
  manifest.content_scripts = manifest.content_scripts.filter((cs) => cs.world !== 'MAIN')
  if (manifest.content_scripts.length !== before - 1) {
    throw new Error('dist 매니페스트에 world:MAIN 항목이 없다 — 무엇을 제거해야 할지 모르겠다')
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
})

interface Session {
  context: BrowserContext
  worker: Worker
  extensionId: string
}

async function launchWithoutStaticMain(): Promise<Session> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${FIXTURE}`,
      `--load-extension=${FIXTURE}`,
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

test('시험 대상은 정적 MAIN 선언이 없는 패키지다', () => {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE, 'manifest.json'), 'utf8')) as {
    content_scripts: { js: string[]; world?: string }[]
    permissions: string[]
    web_accessible_resources?: { resources: string[] }[]
  }
  const shipped = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as {
    content_scripts: { world?: string }[]
  }

  // If this breaks, the reasoning behind the two tests below collapses with it.
  expect(fixture.content_scripts.some((cs) => cs.world === 'MAIN')).toBe(false)
  expect(fixture.content_scripts.flatMap((cs) => cs.js)).toEqual(['isolated.js'])

  // And what we actually ship keeps the fast path.
  expect(shipped.content_scripts.some((cs) => cs.world === 'MAIN')).toBe(true)

  // For the runtime registration
  expect(fixture.permissions).toContain('scripting')
  // For the injection fallback — main.js has to be reachable from the page
  expect(fixture.web_accessible_resources?.flatMap((r) => r.resources)).toContain('main.js')
})

test('정상 경로 — 런타임 등록만으로 1계층이 산다', async () => {
  const { context, worker } = await launchWithoutStaticMain()
  try {
    // Wait for the background to register the MAIN world script
    await expect
      .poll(() => registeredMainScript(worker), { message: 'registerContentScripts 가 안 돌았다' })
      .toEqual({ world: 'MAIN', runAt: 'document_start' })

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // This fixture declares no MAIN script, so this being true means runtime registration took
    await expect.poll(() => layer1Active(page), { message: '1계층' }).toBe(true)
    await expect.poll(() => layer2Active(page), { message: '2계층' }).toBe(true)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  } finally {
    await context.close()
  }
})

test('폴백 경로 — 등록이 없으면 주입으로 1계층을 살린다', async () => {
  const { context, worker } = await launchWithoutStaticMain()
  try {
    await expect.poll(() => registeredMainScript(worker)).not.toBeNull()

    // Tearing the registration down reproduces registerContentScripts failing —
    // an older WebKit, a refused permission. ensureMainWorldScript only runs at
    // worker startup, so it will not re-register.
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

    // 그리고 그 사실이 폰에서 읽힌다. 주입이 페이지 CSP 에 막히면 1계층은
    // 아예 없고 모든 프리롤이 재생되는데, 그 실패는 지금까지 콘솔에만 남았다 —
    // 폰에는 콘솔이 없다.
    await expect
      .poll(async () =>
        worker.evaluate(async () => {
          const got = await chrome.storage.local.get('diagnostics')
          return (got.diagnostics as { inject?: string } | undefined)?.inject
        }),
      )
      .toBe('loaded')
  } finally {
    await context.close()
  }
})

test('두 경로가 겹쳐도 훅은 한 번만 걸린다', async () => {
  // Execution order is not guaranteed, so the normal registration and the
  // injection fallback can both fire. If installHooks() then runs twice,
  // JSON.parse ends up double-wrapped — ads still disappear, so it reads as a
  // pass, while the stats inflate and the hooks stack.
  const { context, worker, extensionId } = await launchWithoutStaticMain()
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

test('엉뚱한 world 에서 돌면 설치됐다고 말하지 않는다', async () => {
  // The failure this guards: a browser ignores world:"MAIN" and runs main.js in
  // the extension's world instead. Hooking JSON.parse there wraps a copy
  // YouTube never calls — the ads come through — and if the file marks itself
  // installed anyway, isolated/injectMain.ts sees the marker and stands down.
  // Both layers of defence gone, nothing logged, every test on the desk green.
  // It happened on a phone.
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${FIXTURE}`, `--load-extension=${FIXTURE}`, ...LAUNCH_ARGS],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const extensionId = new URL(worker.url()).host

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // main.js as the extension's own world would see it: chrome.runtime.id set.
    // Fetched from the extension rather than the page, which would answer with
    // the fixture's HTML.
    const marked = await page.evaluate(async (url) => {
      document.documentElement.removeAttribute('data-oc-ad-bye-pass')
      const wrong = new Function(
        'chrome',
        await (await fetch(url)).text(),
      )
      wrong({ runtime: { id: 'pretend-extension-id' } })
      return document.documentElement.hasAttribute('data-oc-ad-bye-pass')
    }, `chrome-extension://${extensionId}/main.js`)

    expect(marked, '페이지 밖에서 돌았는데 설치됐다고 표시했다').toBe(false)
  } finally {
    await context.close()
  }
})
