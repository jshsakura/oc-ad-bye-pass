// Layer 1 — is the ad never loaded in the first place?
// The same place ReVanced's video-ads patch works on PlayerResponseModel.

import { chromium } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

// Closures do not cross into page.evaluate — no helpers, everything inline.
type Bag = Record<string, unknown>

test.describe('1계층 응답 프루닝', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('경로 A — 인라인 전역 대입(ytInitialPlayerResponse)에서 광고가 사라진다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    const response = await page.evaluate(() => {
      const r = (window as unknown as Bag).ytInitialPlayerResponse as Bag
      return {
        adPlacements: r.adPlacements,
        playerAds: r.playerAds,
        adSlots: r.adSlots,
        adBreakHeartbeatParams: r.adBreakHeartbeatParams,
        adConfig: (r.playerConfig as Bag)?.adConfig,
        // Fields unrelated to ads must survive untouched
        videoId: (r.videoDetails as Bag)?.videoId,
        formats: (r.streamingData as Bag)?.formats,
        audioConfig: (r.playerConfig as Bag)?.audioConfig,
      }
    })

    expect(response.adPlacements, '프리롤/미드롤 광고 자리').toBeUndefined()
    expect(response.playerAds).toBeUndefined()
    expect(response.adSlots).toBeUndefined()
    expect(response.adBreakHeartbeatParams).toBeUndefined()
    expect(response.adConfig).toBeUndefined()

    expect(response.videoId, '영상 정보는 멀쩡해야 한다').toBe('from-inline')
    expect(response.formats).toHaveLength(1)
    expect(response.audioConfig).toEqual({ loudnessDb: 1 })
  })

  test('경로 B — JSON.parse 로 들어온 응답에서 광고가 사라진다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    const parsed = await page.evaluate(() => {
      const p = (window as unknown as Bag).__parsed as Bag
      return { ads: p.adPlacements, slots: p.adSlots, videoId: (p.videoDetails as Bag).videoId }
    })

    expect(parsed.ads).toBeUndefined()
    expect(parsed.slots).toBeUndefined()
    expect(parsed.videoId).toBe('from-json-parse')
  })

  test('경로 C — fetch(/youtubei/v1/player) 응답에서 광고가 사라진다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bag).__fetchState))
      .toBe('done')

    const fetched = await page.evaluate(() => {
      const f = (window as unknown as Bag).__fetched as Bag
      return {
        ads: f.adPlacements,
        playerAds: f.playerAds,
        slots: f.adSlots,
        videoId: (f.videoDetails as Bag).videoId,
        formats: (f.streamingData as Bag).formats,
      }
    })

    expect(fetched.ads).toBeUndefined()
    expect(fetched.playerAds).toBeUndefined()
    expect(fetched.slots).toBeUndefined()
    expect(fetched.videoId).toBe('from-fetch')
    expect(fetched.formats).toHaveLength(1)
  })

  test('후킹한 네이티브가 [native code] 로 위장된다 (애드블록 탐지 회피)', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    const sources = await page.evaluate(() => ({
      jsonParse: JSON.parse.toString(),
      responseJson: Response.prototype.json.toString(),
      toStringItself: Function.prototype.toString.toString(),
    }))

    expect(sources.jsonParse).toContain('[native code]')
    expect(sources.responseJson).toContain('[native code]')
    expect(sources.toStringItself).toContain('[native code]')
  })
})

// Proof the tests above are not vacuous: open the same page without the extension and the ads must still be there.
test('대조군 — 확장이 없으면 광고 필드가 그대로 남아 있다', async () => {
  const plain = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: LAUNCH_ARGS,
  })
  try {
    await installYouTubeFixture(plain)
    const page = await plain.newPage()
    await page.goto(YOUTUBE_URL)
    await page.waitForFunction(() => (window as unknown as Bag).__fetchState === 'done')

    const control = await page.evaluate(() => {
      const inline = (window as unknown as Bag).ytInitialPlayerResponse as Bag
      const fetched = (window as unknown as Bag).__fetched as Bag
      const parsed = (window as unknown as Bag).__parsed as Bag
      return {
        inlineAds: Array.isArray(inline.adPlacements),
        fetchedAds: Array.isArray(fetched.adPlacements),
        parsedAds: Array.isArray(parsed.adPlacements),
        installed: (window as unknown as Bag).__ocAdByePassInstalled,
      }
    })

    expect(control.installed, '확장이 없어야 하는 대조군').toBeUndefined()
    expect(control.inlineAds, '차단 전에는 광고가 있어야 테스트가 의미 있다').toBe(true)
    expect(control.fetchedAds).toBe(true)
    expect(control.parsedAds).toBe(true)
  } finally {
    await plain.close()
  }
})
