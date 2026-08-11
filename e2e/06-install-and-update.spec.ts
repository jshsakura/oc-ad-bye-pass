// 배포 모델 자체를 검증한다.
//
//   "설치는 로컬로 한 번. 이후는 버튼을 누르든 자동 갱신이든 알아서."
//
// 여기까지가 진짜 제품이다. 앞의 스펙들은 dist/ 를 직접 물려서 차단 로직만 봤고,
// 원격 갱신은 chrome.storage 에 값을 심어서 흉내냈다. 이 파일은 그 두 구멍을 메운다.
//   - 사용자가 실제로 받는 zip 을 풀어서 설치했을 때 동작하는가
//   - 옵션 페이지 버튼을 눌렀을 때 fetch → 검증 → 캐시 → 페이지 반영이 다 도는가
//   - 갱신이 실패하거나 이상한 리스트가 와도 기존 규칙이 살아남는가

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
// 1. 로컬 설치 — 사용자가 받는 zip 그대로
// ---------------------------------------------------------------------------

test.describe('로컬 설치', () => {
  let workDir = ''
  let unpacked = ''

  test.beforeAll(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'ocabp-install-'))
    const zipPath = path.join(workDir, 'oc-ad-bye-pass.zip')

    // npm run zip 이 만드는 것과 같은 산출물
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: DIST })

    // 사용자가 하는 일: 압축 풀기
    unpacked = path.join(workDir, 'unpacked')
    mkdirSync(unpacked)
    execFileSync('unzip', ['-q', zipPath, '-d', unpacked])
  })

  test.afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  test('zip 을 풀어서 로드하면 광고가 막힌다', async () => {
    // "압축해제된 확장 프로그램을 로드" 와 같은 경로
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${unpacked}`,
        `--load-extension=${unpacked}`,
        ...LAUNCH_ARGS,
      ],
    })
    try {
      // 서비스 워커가 뜨는지 = manifest 가 유효한지
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
// 2. 원격 갱신 — 설치 이후의 모든 것
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

/** 원격 리스트 서버를 흉내낸다. 확장의 서비스 워커가 나가는 fetch 를 가로챈다. */
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

/** 옵션 페이지의 "지금 업데이트" 버튼을 실제로 누른다 */
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
 * 캐시를 낡은 것으로 만든다.
 *
 * 설치 직후 한 번 받아오므로, 그대로 두면 updater 의 최소 간격(10분)에 걸려
 * 다음 갱신 시도가 아예 나가지 않는다. 시간을 기다릴 수는 없으니 시계를 되감는다.
 */
async function makeCacheStale(context: BrowserContext) {
  const worker = context.serviceWorkers()[0]
  await worker.evaluate(async () => {
    const got = await chrome.storage.local.get('filterCache')
    const cache = got.filterCache as { fetchedAt: number } | undefined
    if (!cache) return // 아직 받아온 게 없으면 어차피 간격 검사에 안 걸린다
    cache.fetchedAt = 0
    await chrome.storage.local.set({ filterCache: cache })
  })
}

test.describe('설치 이후 원격 갱신', () => {
  test('버튼 한 번으로 새 규칙이 받아져 페이지에 반영된다', async ({ context, extensionId }) => {
    await installYouTubeFixture(context)

    // 유튜브를 먼저 열어둔다 — 새로고침 없이 반영되는지 보려고
    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)
    await expect(youtube.locator('#normal-card')).toBeVisible()

    // 번들에는 없는 규칙을 실은 리스트를 서버가 내려준다
    await serveList(context, () => remoteList({ version: 100, hide: ['#normal-card'] }))

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await clickUpdateButton(options)

    // 옵션 화면의 상태 표가 갱신되고 ("원격 리스트 사용" 토글 라벨과 겹치지 않게 dl 안에서 찾는다)
    const statusTable = options.locator('dl.kv')
    await expect(statusTable.getByText('원격 리스트', { exact: true })).toBeVisible()
    await expect(statusTable.getByText('100', { exact: true })).toBeVisible()

    // 캐시에 검증을 통과한 리스트가 들어가고
    await expect.poll(async () => (await readCache(context))?.version).toBe(100)
    expect((await readCache(context))?.url).toBe(LIST_URL)

    // 열려 있던 유튜브 탭에 새 규칙이 새로고침 없이 먹는다
    await expect(youtube.locator('#normal-card'), '원격 규칙이 닿아야 한다').toBeHidden()
    // 번들 기본 규칙도 그대로 (합집합 병합)
    await expect(youtube.locator('#masthead-ad')).toBeHidden()
  })

  test('유튜브 탭을 열면 낡은 규칙을 알아서 받아온다 (주기 알람 없이)', async ({ context }) => {
    await installYouTubeFixture(context)
    // 설치 직후에 한 번 받아왔을 수 있다. 그대로면 최소 간격에 걸려 안 나간다.
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

    // 사용자가 하는 일은 이것뿐이다 — 유튜브를 연다
    const youtube = await context.newPage()
    await youtube.goto(YOUTUBE_URL)

    await expect
      .poll(() => hits, { message: '탭을 열었는데 갱신을 시도조차 하지 않았다' })
      .toBeGreaterThan(0)
    // 받아온 규칙이 지금 열려 있는 그 탭에 바로 먹는다
    await expect(youtube.locator('#normal-card')).toBeHidden()
  })

  test('바뀐 게 없으면 304 로 끝난다 — 본문을 다시 받지 않는다', async ({ context, extensionId }) => {
    let bodyServed = 0
    let notModified = 0
    const ETAG = '"list-v300"'

    await context.unroute('https://raw.githubusercontent.com/**')
    await context.route('https://raw.githubusercontent.com/**', async (route) => {
      // 확장이 지난번 ETag 를 되돌려주면 서버는 본문을 안 보낸다
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

    // 1회차 — ETag 가 없으니 본문을 받는다
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(300)
    expect(bodyServed, '첫 요청은 본문을 받아야 한다').toBe(1)

    // 2회차 — 이번엔 If-None-Match 를 달고 나가서 304 를 받는다
    await clickUpdateButton(options)
    await expect
      .poll(() => notModified, { message: 'ETag 를 안 보냈다 — 매번 4KB 를 다시 받는다' })
      .toBeGreaterThan(0)

    expect(bodyServed, '바뀐 게 없는데 본문을 다시 받았다').toBe(1)
    // 304 를 받았다고 이미 가진 규칙을 잃으면 안 된다
    expect((await readCache(context))?.version).toBe(300)
    expect((await readCache(context))?.error).toBeNull()
  })

  test('서버가 죽어도 이미 받아둔 규칙으로 계속 막는다', async ({ context, extensionId }) => {
    await installYouTubeFixture(context)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    // 한 번 성공시켜 캐시를 채우고
    await serveList(context, () => remoteList({ version: 200, hide: ['#normal-card'] }))
    await clickUpdateButton(options)
    await expect.poll(async () => (await readCache(context))?.version).toBe(200)

    // 그다음 서버가 죽는다
    await serveList(context, () => null)
    await clickUpdateButton(options)

    // 오류는 표시하되
    await expect(options.locator('.status.error')).toBeVisible()
    // 캐시는 그대로 살아 있고
    await expect.poll(async () => (await readCache(context))?.version).toBe(200)

    // 차단도 계속 된다
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

    // 공격자가 예전 스냅샷을 다시 먹이려는 상황
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

    // 멀쩡한 규칙은 먹고
    await expect(youtube.locator('#normal-card')).toBeHidden()
    // 페이지를 통째로 지우려는 시도는 안 먹는다
    expect(await youtube.evaluate(() => getComputedStyle(document.body).display)).toBe('block')
  })
})
