// Safari 빌드의 MAIN world 진입 경로를 Chromium 에서 실제로 돌린다.
//
// 왜 필요한가: 나머지 스펙은 전부 dist/(Chrome 빌드)만 물린다. 그리고 Chrome 빌드에는
// Safari 코드가 한 바이트도 없다 (verify-targets 가 강제한다). 즉 지금까지
// ensureMainWorldScript / injectMainWorldFallback 은 커버리지가 0 이었다.
//
// 진짜 Safari 는 아니지만 **우리 코드의 분기는 그대로 실행된다.** Chromium 도
// scripting.registerContentScripts 의 world:'MAIN' 을 지원하기 때문이다.
//
// 판정이 깨끗한 이유: Safari 매니페스트에는 MAIN 콘텐츠 스크립트가 없다.
// 그러니 1계층이 살아 있다면 그건 오직 런타임 등록이나 주입 폴백 덕분이다.

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

  // Safari 는 정적 content_scripts 의 world 를 무시하는 버전이 있어서 일부러 뺐다.
  // 이 테스트가 깨지면 아래 두 테스트의 판정 근거도 같이 무너진다.
  expect(manifest.content_scripts.some((cs) => cs.world === 'MAIN')).toBe(false)
  expect(manifest.content_scripts.flatMap((cs) => cs.js)).toEqual(['isolated.js'])

  // 런타임 등록용
  expect(manifest.permissions).toContain('scripting')
  // 주입 폴백용 — main.js 가 페이지에서 접근 가능해야 한다
  expect(manifest.web_accessible_resources?.flatMap((r) => r.resources)).toContain('main.js')
})

test('정상 경로 — 런타임 등록만으로 1계층이 산다', async () => {
  const { context, worker } = await launchSafariBuild()
  try {
    // 백그라운드가 MAIN world 스크립트를 등록할 때까지 기다린다
    await expect
      .poll(() => registeredMainScript(worker), { message: 'registerContentScripts 가 안 돌았다' })
      .toEqual({ world: 'MAIN', runAt: 'document_start' })

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // 매니페스트에 MAIN 스크립트가 없으므로, 이게 참이면 런타임 등록이 실제로 먹은 것이다
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

    // 등록을 걷어낸다 = 구버전 Safari 에서 registerContentScripts 가 실패한 상황.
    // ensureMainWorldScript 는 서비스 워커 기동 때만 도므로 다시 등록되지 않는다.
    await worker.evaluate(
      (id) => chrome.scripting.unregisterContentScripts({ ids: [id] }),
      SCRIPT_ID,
    )
    expect(await registeredMainScript(worker), '등록이 남아 있으면 폴백을 시험할 수 없다').toBeNull()

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // 이제 1계층이 살아 있다면 그건 오직 <script src> 주입 덕분이다
    await expect
      .poll(() => layer1Active(page), { message: '주입 폴백이 1계층을 못 살렸다' })
      .toBe(true)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  } finally {
    await context.close()
  }
})

test('두 경로가 겹쳐도 훅은 한 번만 걸린다', async () => {
  // 실행 순서가 보장되지 않아 정상 등록과 주입 폴백이 둘 다 발화할 수 있다.
  // 그때 installHooks() 가 두 번 돌면 JSON.parse 가 이중으로 감싸인다 —
  // 광고는 여전히 사라지므로 "통과"로 보이지만 통계가 부풀고 훅이 겹친다.
  const { context, worker, extensionId } = await launchSafariBuild()
  try {
    await expect.poll(() => registeredMainScript(worker)).not.toBeNull()

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect.poll(() => layer1Active(page)).toBe(true)

    // 폴백이 한 번 더 꽂힌 상황을 그대로 재현한다
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

    // 통계를 0 으로 맞춘다. 그 전에 배치가 다 떨어지기를 기다려야 한다 —
    // 콘텐츠 스크립트는 프루닝 건수를 3초씩 모아서 보고하므로, 위 프로브가 만든
    // 건수가 아직 큐에 남아 있으면 리셋 직후에 얹혀서 카운트가 어긋난다.
    await page.waitForTimeout(4000)
    await worker.evaluate(() =>
      chrome.storage.local.set({ stats: { pruned: 0, skipped: 0, since: Date.now() } }),
    )

    // 광고 필드가 정확히 하나씩 든 JSON 을 12번 파싱한다
    const PARSES = 12
    await page.evaluate((count) => {
      for (let i = 0; i < count; i++) JSON.parse('{"adPlacements":[{}],"videoDetails":{}}')
    }, PARSES)

    // 훅이 한 번만 걸렸으면 정확히 12 여야 한다. 이중 래핑이면 그보다 커진다.
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

    // 위장도 겹겹이 쌓이지 않고 그대로여야 한다
    expect(await page.evaluate(() => JSON.parse.toString())).toContain('[native code]')
  } finally {
    await context.close()
  }
})
