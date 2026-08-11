// Verifies the distribution model itself.
//
//   "Install locally once. After that a button press or an automatic refresh
//    takes care of it."
//
// That is where the real product lives. The earlier specs loaded dist/ directly
// and only exercised the blocking logic, and they faked remote updates by
// planting values in chrome.storage. This file closes both gaps:
//   - does it work when installed from the zip a user actually downloads?
//   - does pressing the options-page button really run fetch -> validate ->
//     cache -> apply to the page?
//   - do the existing rules survive a failed update or a malformed list?

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')
const LIST_URL = 'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/filters/youtube.json'

// ---------------------------------------------------------------------------
// 1. Local install — the very zip a user receives
// ---------------------------------------------------------------------------

test.describe('로컬 설치', () => {
  let workDir = ''
  let unpacked = ''

  test.beforeAll(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'ocabp-install-'))
    const zipPath = path.join(workDir, 'oc-ad-bye-pass.zip')

    // The same artefact npm run zip produces
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: DIST })

    // What the user does: unzip it
    unpacked = path.join(workDir, 'unpacked')
    mkdirSync(unpacked)
    execFileSync('unzip', ['-q', zipPath, '-d', unpacked])
  })

  test.afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  test('zip 을 풀어서 로드하면 광고가 막힌다', async () => {
    // The same path as "Load unpacked extension"
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${unpacked}`,
        `--load-extension=${unpacked}`,
        ...LAUNCH_ARGS,
      ],
    })
    try {
      // A service worker starting means the manifest is valid
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
      expect(worker.url()).toContain('background.js')

      await installYouTubeFixture(context)
      const page = await context.newPage()
      await page.goto(YOUTUBE_URL)

      await expect.poll(() => layer1Active(page), { message: '1계층' }).toBe(true)
      await expect.poll(() => layer2Active(page), { message: '2계층' }).toBe(true)
      await expect(page.locator('#masthead-ad')).toBeHidden()
      await expect(page.locator('#normal-card'), '정상 영상은 살아 있어야').toBeVisible()
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Remote refresh — everything after installation
// ---------------------------------------------------------------------------

interface ListOptions {
  version: number
  hide?: string[]
}

function remoteList({ version, hide = [] }: ListOptions) {
  return {
    name: 'e2e remote list',
    version,
    updatedAt: '2026-08-10',
    rules: { hide: { generalAds: hide }, prune: [], click: [], allow: [] },
  }
}

/** Stands in for the remote list server, intercepting the extension service worker's fetch. */
async function serveList(context: BrowserContext, respond: () => unknown) {
  await context.unroute('https://raw.githubusercontent.com/**')
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const body = respond()
    if (body === null) {
      await route.fulfill({ status: 500, body: 'boom' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  })
}

/** Actually press the "update now" button on the options page. */
async function clickUpdateButton(optionsPage: Page) {
  await optionsPage.getByRole('button', { name: '지금 업데이트' }).click()
}

async function readCache(context: BrowserContext) {
  const worker = context.serviceWorkers()[0]
  return worker.evaluate(async () => {
    const got = await chrome.storage.local.get('filterCache')
    const cache = got.filterCache as
      | { url: string; list: { version: number }; error: string | null }
      | undefined
    return cache
      ? { url: cache.url, version: cache.list.version, error: cache.error }
      : null
  })
}

/**
 * Age the cache.
 *
 * The extension fetches once right after installing, so left alone the next
 * attempt runs into the updater's minimum interval and never goes out at all.
 * We cannot wait out the clock, so we wind it back.
 */
async function makeCacheStale(context: BrowserContext) {
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const got = await chrome.storage.local.get('filterCache')
    const cache = got.filterCache as { fetchedAt: number } | undefined
    if (!cache) return // Nothing fetched yet, so the interval check will not bite anyway
    cache.fetchedAt = 0
    await chrome.storage.local.set({ filterCache: cache })
  })
}

test.describe('설치 이후 원격 갱신', () => {
  test('버튼 한 번으로 새 규칙이 받아져 페이지에 반영된다', async ({ context, extensionId }) => {
    await installYouTubeFixture(context)

    // Open YouTube first, to see the rules land without a reload
    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)
    await expect(youtube.locator('#normal-card')).toBeVisible()

    // The server serves a list carrying a rule the bundle does not have
    await serveList(context, () => remoteList({ version: 100, hide: ['#normal-card'] }))

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await clickUpdateButton(options)

    // The options status table updates (scoped to the dl so it does not collide with the toggle label)
    const statusTable = options.locator('dl.kv')
    await expect(statusTable.getByText('원격 리스트', { exact: true })).toBeVisible()
    await expect(statusTable.getByText('100', { exact: true })).toBeVisible()

    // The validated list lands in the cache…
    await expect.poll(async () => (await readCache(context))?.version).toBe(100)
    expect((await readCache(context))?.url).toBe(LIST_URL)

    // …and the new rule applies to the already-open YouTube tab, with no reload
    await expect(youtube.locator('#normal-card'), '원격 규칙이 닿아야 한다').toBeHidden()
    // The bundled defaults still apply (union merge)
    await expect(youtube.locator('#masthead-ad')).toBeHidden()
  })

  test('유튜브 탭을 열면 낡은 규칙을 알아서 받아온다 (주기 알람 없이)', async ({ context }) => {
    await installYouTubeFixture(context)
    // It may already have fetched once on install; left as-is the minimum interval blocks the next one.
    await makeCacheStale(context)

    let hits = 0
    await context.unroute('https://raw.githubusercontent.com/**')
    await context.route('https://raw.githubusercontent.com/**', async (route) => {
      hits++
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(remoteList({ version: 200, hide: ['#normal-card'] })),
      })
    })

    // All the user does is this — open YouTube
    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)

    await expect
      .poll(() => hits, { message: '탭을 열었는데 갱신을 시도조차 하지 않았다' })
      .toBeGreaterThan(0)
    // The fetched rule applies immediately to the tab that is already open
    await expect(youtube.locator('#normal-card')).toBeHidden()
  })

  test('바뀐 게 없으면 304 로 끝난다 — 본문을 다시 받지 않는다', async ({ context, extensionId }) => {
    let bodyServed = 0
    let notModified = 0
    const ETAG = '"list-v300"'

    await context.unroute('https://raw.githubusercontent.com/**')
    await context.route('https://raw.githubusercontent.com/**', async (route) => {
      // When the extension replays the previous ETag, the server sends no body
      if (route.request().headers()['if-none-match'] === ETAG) {
        notModified++
        await route.fulfill({ status: 304, headers: { etag: ETAG } })
        return
      }
      bodyServed++
      await route.fulfill({
        status: 200,
        headers: { etag: ETAG },
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(remoteList({ version: 300, hide: ['#normal-card'] })),
      })
    })

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    // First pass — no ETag yet, so the body comes down
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(300)
    expect(bodyServed, '첫 요청은 본문을 받아야 한다').toBe(1)

    // Second pass — now it goes out with If-None-Match and gets a 304
    await clickUpdateButton(options)
    await expect
      .poll(() => notModified, { message: 'ETag 를 안 보냈다 — 매번 4KB 를 다시 받는다' })
      .toBeGreaterThan(0)

    expect(bodyServed, '바뀐 게 없는데 본문을 다시 받았다').toBe(1)
    // A 304 must never cost us the rules we already hold
    expect((await readCache(context))?.version).toBe(300)
    expect((await readCache(context))?.error).toBeNull()
  })

  test('서버가 죽어도 이미 받아둔 규칙으로 계속 막는다', async ({ context, extensionId }) => {
    await installYouTubeFixture(context)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    // Succeed once to fill the cache…
    await serveList(context, () => remoteList({ version: 200, hide: ['#normal-card'] }))
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(200)

    // …then the server dies
    await serveList(context, () => null)
    await clickUpdateButton(options)

    // The error is surfaced…
    await expect(options.locator('.status.error')).toBeVisible()
    // …the cache survives intact…
    await expect.poll(async () => (await readCache(context))?.version).toBe(200)

    // …and blocking carries on
    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)
    await expect(youtube.locator('#normal-card')).toBeHidden()
    await expect(youtube.locator('#masthead-ad')).toBeHidden()
  })

  test('깨진 리스트가 와도 기존 규칙을 버리지 않는다', async ({ context, extensionId }) => {
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    await serveList(context, () => remoteList({ version: 300, hide: ['#normal-card'] }))
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(300)

    await serveList(context, () => '{ 이건 JSON 이 아니다')
    await clickUpdateButton(options)

    await expect(options.locator('.status.error')).toBeVisible()
    expect((await readCache(context))?.version, '깨진 걸 받아 덮어쓰면 안 된다').toBe(300)
  })

  test('예전 버전으로 되돌리려는 리스트는 거부한다 (롤백 방지)', async ({ context, extensionId }) => {
    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    await serveList(context, () => remoteList({ version: 400, hide: ['#normal-card'] }))
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(400)

    // An attacker replaying an older snapshot
    await serveList(context, () => remoteList({ version: 399, hide: [] }))
    await clickUpdateButton(options)

    await expect(options.locator('.status.error')).toBeVisible()
    expect((await readCache(context))?.version).toBe(400)
  })

  test('스타일시트를 탈출하려는 규칙은 받아도 버린다', async ({ context, extensionId }) => {
    await installYouTubeFixture(context)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    await serveList(context, () =>
      remoteList({
        version: 500,
        hide: ['body { display: none }', '@import url(https://evil.example/x.css)', '#normal-card'],
      }),
    )
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(500)

    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)

    // The sound rule applies…
    await expect(youtube.locator('#normal-card')).toBeHidden()
    // …while the attempt to wipe the page does not
    expect(await youtube.evaluate(() => getComputedStyle(document.body).display)).toBe('block')
  })
})
