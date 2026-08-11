// 진짜 youtube.com 을 상대로 도는 검증. 기본은 건너뛴다.
//
//   E2E_LIVE=1 npm run test:e2e
//
// 왜 기본으로 안 도는가: 네트워크·지역·로그인 상태·유튜브의 그날 실험군에 따라 결과가
// 바뀐다. 차단 여부의 주된 판정은 대조군이 있는 픽스처 테스트(01~04)가 맡는다.
//
// 다만 픽스처가 절대 못 잡는 것이 둘 있어서 여기서 본다.
//   1. 확장이 진짜 유튜브를 깨뜨리지 않는가 — JSON.parse 를 후킹하는 확장에서 제일
//      무서운 실패는 "광고가 안 막힘"이 아니라 "유튜브가 안 열림"이다.
//   2. 유튜브가 실제로 내려주는 광고 페이로드가 잘리는가 — 우리가 만든 가짜가 아니라.
//
// 2번에는 함정이 있다. 그냥 아무 영상이나 열고 adPlacements 가 없는 걸 확인하면
// 아무것도 증명하지 못한다 — 애초에 광고가 안 붙는 영상이 흔하기 때문이다.
// (실측: "Big Buck Bunny", "Me at the zoo" 는 비로그인 상태에서 광고가 0 이다.)
// 그래서 **확장 없이 먼저 열어 광고가 붙는 것을 확인한 뒤**, 같은 영상을 확장과 함께
// 연다. 대조군에 광고가 없으면 증명이 성립하지 않으므로 테스트를 skip 한다.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'

const SHOTS_DIR = path.resolve(import.meta.dirname, '__screenshots__')
const LIVE = process.env.E2E_LIVE === '1'

/** 비로그인 상태에서도 광고가 붙는 것으로 확인된 영상들 (2026-08 실측) */
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
    // --- 대조군: 확장 없이 열어서 광고가 정말 붙는지 확인한다 ---
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
          // 다음 영상으로
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

    // 대조군에 광고가 실제로 있다.
    // adSlots/playerAds 는 실험군에 따라 있기도 없기도 해서 게이트로 쓰지 않는다 —
    // adPlacements 하나만 있어도 "유튜브가 이 영상에 광고를 붙였다"는 증명은 된다.
    expect(control!.adPlacements).toBeGreaterThan(0)

    // --- 실험군: 같은 영상을 확장과 함께 ---
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(watchUrl(target!), { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const blocked = await readPlayerResponse(page)
    expect(blocked, 'ytInitialPlayerResponse 가 없으면 페이지가 깨진 것이다').not.toBeNull()

    // 유튜브가 내려준 진짜 광고가 사라졌다
    expect(blocked!.adPlacements, '프리롤/미드롤 광고 자리').toBeNull()
    expect(blocked!.playerAds).toBeNull()
    expect(blocked!.adSlots).toBeNull()

    // 본편은 멀쩡하다
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
