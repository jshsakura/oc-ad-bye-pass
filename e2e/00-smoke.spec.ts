import { expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

test('확장이 실제 Chromium 에 로드되고 서비스 워커가 뜬다', async ({ background, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/)
  expect(background.url()).toContain('background.js')
})

test('유튜브 문서에서 두 계층이 모두 살아난다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // 확장이 남긴 흔적을 찾는 게 아니라, 실제로 막고 있는지를 본다.
  // (흔적으로 판정하면 그 흔적이 곧 유튜브가 쓸 탐지 지문이 된다)
  await expect.poll(() => layer1Active(page), { message: 'MAIN world 훅' }).toBe(true)
  await expect.poll(() => layer2Active(page), { message: 'ISOLATED world 스타일' }).toBe(true)
})
