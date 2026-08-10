// 3계층 — 1계층이 뚫렸을 때의 폴백.
// 여기서는 스텁 없이 진짜 미디어 요소의 상태(paused/currentTime/muted)로만 판단한다.

import { chromium, type Page } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { AD_DURATION_SECONDS, YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const videoState = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#ad-video')!
    return { currentTime: v.currentTime, duration: v.duration, muted: v.muted, ended: v.ended }
  })

/** 광고 미디어의 메타데이터가 준비될 때까지 기다린다 (duration 이 있어야 감을 수 있다) */
async function waitForMediaReady(page: Page) {
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('#ad-video')
    return !!v && Number.isFinite(v.duration) && v.duration > 0
  })
}

/** 확장이 다시 훑도록 DOM 을 건드린다 (진짜 유튜브도 재생 중 DOM 이 끊임없이 바뀐다) */
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

  // 광고 종료 = 유튜브가 .ad-showing 을 뗀다
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

  // 우리가 음소거한 게 아니므로 광고가 끝나도 그대로 둬야 한다
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
