// 진짜 youtube.com 을 상대로 도는 스모크. 기본은 건너뛴다.
//
//   E2E_LIVE=1 npm run test:e2e
//
// 왜 기본으로 안 도는가: 네트워크·지역·로그인 상태·유튜브의 그날 실험군에 따라 결과가
// 바뀐다. "광고가 안 떴다"가 차단 덕분인지 원래 안 붙은 건지 구분할 수도 없다.
// 그래서 진짜 검증은 픽스처 쪽(01~04)이 하고, 여기서는 픽스처가 절대 못 잡는 것 하나만 본다:
//
//   ── 확장이 진짜 유튜브를 깨뜨리지 않는가.
//
// JSON.parse 를 후킹하는 확장에서 가장 무서운 실패는 "광고가 안 막힘"이 아니라
// "유튜브가 안 열림"이다. 그건 실물로만 확인된다.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures.ts'

const SHOTS_DIR = path.resolve(import.meta.dirname, '__screenshots__')
const LIVE = process.env.E2E_LIVE === '1'
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' // Big Buck Bunny (공개 영상)

test.describe('실제 유튜브 (E2E_LIVE=1 일 때만)', () => {
  test.skip(!LIVE, 'E2E_LIVE=1 이 아니면 건너뛴다')
  test.slow()

  test('확장을 켠 채로도 유튜브가 정상 동작한다', async ({ context }) => {
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    // 확장이 붙었고
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as Record<string, unknown>).__ocAdByePassInstalled),
      )
      .toBe(true)

    // 플레이어와 영상 메타데이터가 멀쩡히 살아 있다 (= 프루닝이 본편을 건드리지 않았다)
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('video')).toHaveCount(1, { timeout: 30_000 })

    const details = await page.evaluate(() => {
      const response = (window as unknown as Record<string, unknown>).ytInitialPlayerResponse as
        | Record<string, unknown>
        | undefined
      if (!response) return null
      return {
        hasAds: response.adPlacements !== undefined || response.playerAds !== undefined,
        videoId: (response.videoDetails as Record<string, unknown> | undefined)?.videoId,
        hasStreamingData: response.streamingData !== undefined,
      }
    })

    expect(details, 'ytInitialPlayerResponse 가 아예 없으면 페이지가 깨진 것이다').not.toBeNull()
    expect(details!.videoId, '영상 정보는 살아 있어야 한다').toBeTruthy()
    expect(details!.hasStreamingData, '재생 정보는 살아 있어야 한다').toBe(true)
    expect(details!.hasAds, '광고 필드는 잘려 있어야 한다').toBe(false)

    // 후킹 때문에 페이지 스크립트가 터지지 않았는지
    expect(pageErrors, `페이지 오류: ${pageErrors.join(' | ')}`).toHaveLength(0)

    mkdirSync(SHOTS_DIR, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS_DIR, 'live-youtube.png') })
  })
})
