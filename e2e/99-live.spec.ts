// Verification against the real youtube.com. Skipped by default.
//
//   E2E_LIVE=1 npm run test:e2e
//
// Why it does not run by default: the result shifts with the network, the
// region, the sign-in state and whichever experiment group YouTube puts you in
// that day. The primary judgement on blocking belongs to the fixture tests
// (01–04), which have control groups.
//
// Two things a fixture can never catch are checked here.
//   1. Does the extension break real YouTube? For an extension that hooks
//      JSON.parse, the frightening failure is not "an ad got through" but
//      "YouTube will not load".
//   2. Does the ad payload YouTube actually serves get stripped — as opposed to
//      the one we made up?
//
// The second has a trap. Opening any video and finding no adPlacements proves
// nothing: plenty of videos never carry ads. (Measured: "Big Buck Bunny" and
// "Me at the zoo" return zero ads while signed out.) So we **open it without
// the extension first and confirm ads are present**, then open the same video
// with the extension. No ads in the control means there is nothing to prove, so
// the test skips.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, devices, type Page } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'

const SHOTS_DIR = path.resolve(import.meta.dirname, '__screenshots__')
const LIVE = process.env.E2E_LIVE === '1'

/** Videos confirmed to carry ads even when signed out (measured 2026-08). */
const AD_VIDEOS = ['9bZkp7q19f0', 'kJQP7kiw5Fk']

interface AdInfo {
  adPlacements: number | null
  playerAds: number | null
  adSlots: number | null
  videoId: string | null
  hasStreamingData: boolean
}

async function readPlayerResponse(page: Page): Promise<AdInfo | null> {
  await page.waitForFunction(() => 'ytInitialPlayerResponse' in window, { timeout: 30_000 })
  return page.evaluate(() => {
    const r = (window as unknown as Record<string, unknown>).ytInitialPlayerResponse as
      | Record<string, unknown>
      | undefined
    if (!r) return null
    const count = (v: unknown) => (Array.isArray(v) ? v.length : null)
    return {
      adPlacements: count(r.adPlacements),
      playerAds: count(r.playerAds),
      adSlots: count(r.adSlots),
      videoId: ((r.videoDetails as Record<string, unknown> | undefined)?.videoId as string) ?? null,
      hasStreamingData: r.streamingData !== undefined,
    }
  })
}

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
/** What an iPhone gets. Different page, different player, and the one that matters. */
const mobileWatchUrl = (id: string) => `https://m.youtube.com/watch?v=${id}`

const DIST = path.resolve(import.meta.dirname, '..', 'dist')
const IPHONE = devices['iPhone 13']

/**
 * The package as Orion runs it, near enough to be worth something: no static
 * `world: "MAIN"` declaration, because WebKit ignores it, and the runtime
 * registration torn down, because it may not be there either. What is left is
 * the injected <script>, which cannot block the parser — the reason the first
 * pre-roll can leak.
 */
function packageWithoutStaticMain(into: string): string {
  rmSync(into, { recursive: true, force: true })
  cpSync(DIST, into, { recursive: true })
  const manifestPath = path.join(into, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    content_scripts: { world?: string }[]
  }
  const before = manifest.content_scripts.length
  manifest.content_scripts = manifest.content_scripts.filter((cs) => cs.world !== 'MAIN')
  if (manifest.content_scripts.length !== before - 1) {
    throw new Error('dist 매니페스트에 world:MAIN 항목이 없다')
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return into
}

test.describe('실제 유튜브 (E2E_LIVE=1 일 때만)', () => {
  test.skip(!LIVE, 'E2E_LIVE=1 이 아니면 건너뛴다')
  test.slow()

  test('진짜 광고가 붙는 영상에서 실제로 잘라낸다', async ({ context }) => {
    // --- Control: open without the extension and confirm ads are really served ---
    const plain = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: LAUNCH_ARGS,
    })

    let target: string | null = null
    let control: AdInfo | null = null
    try {
      for (const id of AD_VIDEOS) {
        const page = await plain.newPage()
        try {
          await page.goto(watchUrl(id), { waitUntil: 'domcontentloaded', timeout: 60_000 })
          const info = await readPlayerResponse(page)
          if (info && (info.adPlacements ?? 0) > 0) {
            target = id
            control = info
            break
          }
        } catch {
          // try the next video
        } finally {
          await page.close()
        }
      }
    } finally {
      await plain.close()
    }

    test.skip(
      target === null,
      '지금 이 환경/시점에는 유튜브가 광고를 안 붙였다 — 차단을 증명할 대조군이 없다',
    )

    // The control really does carry ads.
    // adSlots/playerAds come and go with the experiment group, so they are not
    // used as the gate — adPlacements alone proves YouTube attached an ad here.
    expect(control!.adPlacements).toBeGreaterThan(0)

    // --- Treatment: the same video, with the extension ---
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(watchUrl(target!), { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const blocked = await readPlayerResponse(page)
    expect(blocked, 'ytInitialPlayerResponse 가 없으면 페이지가 깨진 것이다').not.toBeNull()

    // The genuine ad YouTube served is gone
    expect(blocked!.adPlacements, '프리롤/미드롤 광고 자리').toBeNull()
    expect(blocked!.playerAds).toBeNull()
    expect(blocked!.adSlots).toBeNull()

    // The video itself is untouched
    expect(blocked!.videoId).toBe(target)
    expect(blocked!.hasStreamingData, '재생 정보까지 자르면 영상이 안 나온다').toBe(true)
    expect(pageErrors, `페이지 오류: ${pageErrors.join(' | ')}`).toHaveLength(0)

    mkdirSync(SHOTS_DIR, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS_DIR, 'live-blocked.png') })
  })

  test('확장을 켠 채로도 유튜브가 정상 동작한다', async ({ context }) => {
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(watchUrl(AD_VIDEOS[0]), { waitUntil: 'domcontentloaded', timeout: 60_000 })

    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('video')).toHaveCount(1, { timeout: 30_000 })

    const info = await readPlayerResponse(page)
    expect(info?.videoId, '영상 정보는 살아 있어야 한다').toBeTruthy()
    expect(info?.hasStreamingData, '재생 정보는 살아 있어야 한다').toBe(true)
    expect(pageErrors, `페이지 오류: ${pageErrors.join(' | ')}`).toHaveLength(0)
  })

  // The condition the phone is actually in, against the site the phone actually
  // gets. Everything above runs the desktop page with layer 1 installed the fast
  // way — neither of which is true on an iPhone, and an ad played through on one
  // while every test here was green.
  //
  // Both halves are swapped: m.youtube.com under an iPhone user agent, and layer
  // 1 arriving only by injection. The control group is what makes it mean
  // anything; plenty of videos carry no ads at all, and mobile serves different
  // ones from desktop.
  test('아이폰 조건 — 모바일 유튜브에 주입 폴백만으로도 잘라낸다', async () => {
    const fixture = packageWithoutStaticMain(
      path.resolve(import.meta.dirname, '..', 'test-results', 'live-orion-pkg'),
    )
    const mobile = {
      userAgent: IPHONE.userAgent,
      viewport: IPHONE.viewport,
      isMobile: true,
      hasTouch: true,
    }

    const read = async (page: Page) => {
      const info = await readPlayerResponse(page)
      return (info?.adPlacements ?? 0) + (info?.playerAds ?? 0) + (info?.adSlots ?? 0)
    }

    const plain = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: LAUNCH_ARGS,
      ...mobile,
    })
    let target: string | null = null
    let control = 0
    try {
      for (const id of AD_VIDEOS) {
        const page = await plain.newPage()
        await page.goto(mobileWatchUrl(id), { waitUntil: 'domcontentloaded', timeout: 60_000 })
        control = await read(page)
        await page.close()
        if (control > 0) {
          target = id
          break
        }
      }
    } finally {
      await plain.close()
    }
    test.skip(target === null, '지금 모바일에 광고를 싣는 영상이 없다 — 증명할 것이 없다')

    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`, ...LAUNCH_ARGS],
      ...mobile,
    })
    try {
      const worker =
        context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
      // Registration succeeding would prove the easy path, not this one.
      await expect
        .poll(() =>
          worker.evaluate(
            (id) =>
              chrome.scripting.getRegisteredContentScripts({ ids: [id] }).then((s) => s.length),
            'oc-ad-bye-pass-main',
          ),
        )
        .toBe(1)
      await worker.evaluate(
        (id) => chrome.scripting.unregisterContentScripts({ ids: [id] }),
        'oc-ad-bye-pass-main',
      )

      const page = await context.newPage()
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto(mobileWatchUrl(target!), { waitUntil: 'domcontentloaded', timeout: 60_000 })

      expect(await read(page), `대조군 ${control}개가 그대로 남았다`).toBe(0)
      const how = await page.evaluate(() => ({
        layer1: document.documentElement.hasAttribute('data-oc-ad-bye-pass'),
        inject: document.documentElement.getAttribute('data-oc-abp-inject'),
      }))
      expect(how.layer1, '주입으로도 1계층이 붙지 않았다').toBe(true)
      expect(how.inject, '이 경로는 주입이어야 한다').toBe('loaded')
      expect(pageErrors, `페이지 오류: ${pageErrors.join(' | ')}`).toHaveLength(0)
    } finally {
      await context.close()
    }
  })

})
