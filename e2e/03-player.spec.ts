// Layer 3 — the fallback for when layer 1 was bypassed.
// Judged purely on a real media element's state (paused/currentTime/muted), no stubs.

import { chromium, type Page } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { AD_DURATION_SECONDS, YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const videoState = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#ad-video')!
    return { currentTime: v.currentTime, duration: v.duration, muted: v.muted, ended: v.ended }
  })

/** Wait for the ad media's metadata — seeking needs a duration. */
async function waitForMediaReady(page: Page) {
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#ad-video')
    return !!v && Number.isFinite(v.duration) && v.duration > 0
  })
}

/** Nudge the DOM so the extension sweeps again (real YouTube mutates constantly during playback). */
async function nudge(page: Page) {
  await page.evaluate(() => {
    document.getElementById('late-mount')!.appendChild(document.createElement('span'))
  })
}

test('스킵 버튼이 있으면 대신 눌러준다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: true })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __observed: { skipClicked: boolean } }).__observed.skipClicked,
      ),
    )
    .toBe(true)
})

test('건너뛸 수 없는 광고는 음소거하고 끝으로 감는다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: false })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await waitForMediaReady(page)
  await nudge(page)

  await expect.poll(async () => (await videoState(page)).muted).toBe(true)
  await expect
    .poll(async () => (await videoState(page)).currentTime, {
      message: '광고 끝까지 감겨야 한다',
    })
    .toBeGreaterThanOrEqual(AD_DURATION_SECONDS - 0.05)
})

test('광고가 끝나면 음소거를 되돌린다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: false })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await waitForMediaReady(page)
  await nudge(page)
  await expect.poll(async () => (await videoState(page)).muted).toBe(true)

  // Ad over = YouTube drops .ad-showing
  await page.evaluate(() => document.getElementById('movie_player')!.classList.remove('ad-showing'))

  await expect
    .poll(async () => (await videoState(page)).muted, { message: '본편은 소리가 나야 한다' })
    .toBe(false)
})

test('사용자가 직접 꺼둔 음소거는 건드리지 않는다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: false, userMuted: true })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await waitForMediaReady(page)
  await nudge(page)
  await expect.poll(async () => (await videoState(page)).currentTime).toBeGreaterThanOrEqual(
    AD_DURATION_SECONDS - 0.05,
  )

  await page.evaluate(() => document.getElementById('movie_player')!.classList.remove('ad-showing'))

  // We did not mute it, so it must stay muted after the ad ends
  await page.waitForTimeout(1000)
  expect((await videoState(page)).muted).toBe(true)
})

test('대조군 — 확장이 없으면 광고는 스킵되지도, 감기지도 않는다', async () => {
  const plain = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: LAUNCH_ARGS,
  })
  try {
    await installYouTubeFixture(plain, { skippable: true })
    const page = await plain.newPage()
    await page.goto(YOUTUBE_URL)
    await waitForMediaReady(page)
    await page.waitForTimeout(1500)

    const state = await videoState(page)
    expect(state.currentTime, '아무도 감지 않았다').toBe(0)
    expect(state.muted).toBe(false)
    expect(
      await page.evaluate(
        () => (window as unknown as { __observed: { skipClicked: boolean } }).__observed.skipClicked,
      ),
    ).toBe(false)
  } finally {
    await plain.close()
  }
})
