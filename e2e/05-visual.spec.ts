// Leaves evidence you can look at: before and after shots in e2e/__screenshots__/.
// This test produces an artefact rather than assertions, so it never fails — it just draws.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { LAUNCH_ARGS, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const OUT_DIR = path.resolve(import.meta.dirname, '__screenshots__')

test('차단 전후 스크린샷을 남긴다', async ({ context }) => {
  mkdirSync(OUT_DIR, { recursive: true })

  // After blocking (extension on)
  await installYouTubeFixture(context)
  const blocked = await context.newPage()
  await blocked.setViewportSize({ width: 640, height: 720 })
  await blocked.goto(YOUTUBE_URL)
  await blocked.locator('#normal-card').waitFor({ state: 'visible' })
  await blocked.locator('#masthead-ad').waitFor({ state: 'hidden' })
  await blocked.screenshot({ path: path.join(OUT_DIR, 'after-blocked.png'), fullPage: true })

  // Before blocking (no extension)
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
