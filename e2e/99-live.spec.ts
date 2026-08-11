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

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
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
})
