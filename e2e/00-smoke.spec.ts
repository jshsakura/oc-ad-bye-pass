import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

test('확장이 실제 Chromium 에 로드되고 서비스 워커가 뜬다', async ({ background, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/)
  expect(background.url()).toContain('background.js')
})

test('유튜브 문서에 콘텐츠 스크립트가 주입된다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // MAIN world 진입점이 남기는 플래그
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__ocAdByePassInstalled))
    .toBe(true)

  // ISOLATED world 가 넣은 스타일시트
  await expect.poll(() => page.locator('style#oc-ad-bye-pass').count()).toBe(1)
})
