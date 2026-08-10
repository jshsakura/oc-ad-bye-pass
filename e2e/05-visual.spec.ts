// 눈으로 확인할 수 있는 증거를 남긴다. e2e/__screenshots__/ 에 차단 전후가 저장된다.
// 어설션 대신 산출물을 만드는 테스트라, 실패하지 않고 항상 그림만 남긴다.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { LAUNCH_ARGS, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const OUT_DIR = path.resolve(import.meta.dirname, '__screenshots__')

test('차단 전후 스크린샷을 남긴다', async ({ context }) => {
  mkdirSync(OUT_DIR, { recursive: true })

  // 차단 후 (확장 있음)
  await installYouTubeFixture(context)
  const blocked = await context.newPage()
  await blocked.setViewportSize({ width: 640, height: 720 })
  await blocked.goto(YOUTUBE_URL)
  await blocked.locator('#normal-card').waitFor({ state: 'visible' })
  await blocked.locator('#masthead-ad').waitFor({ state: 'hidden' })
  await blocked.screenshot({ path: path.join(OUT_DIR, 'after-blocked.png'), fullPage: true })

  // 차단 전 (확장 없음)
  const plain = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: LAUNCH_ARGS,
  })
  try {
    await installYouTubeFixture(plain)
    const raw = await plain.newPage()
    await raw.setViewportSize({ width: 640, height: 720 })
    await raw.goto(YOUTUBE_URL)
    await raw.locator('#masthead-ad').waitFor({ state: 'visible' })
    await raw.screenshot({ path: path.join(OUT_DIR, 'before-raw.png'), fullPage: true })
  } finally {
    await plain.close()
  }
})
