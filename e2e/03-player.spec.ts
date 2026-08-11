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

// 검은 화면의 길이가 이 계층의 품질이다.
//
// 폰에서 광고 하나에 몇 초씩 까맣게 있었다. 감기는 한 번만 시도했고, 그 한 번이
// 안 먹으면(아직 안 받아진 스트림, 플레이어가 되돌린 위치) 광고가 통째로 재생됐다.
// 속도는 그 사이에도 듣는 절반이다 — 길이를 몰라 감지 못 하는 처음 몇 초가 정확히
// 문제의 그 구간이다.
test('건너뛸 수 없는 광고는 빨리 감기까지 올린다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: false })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await waitForMediaReady(page)
  await nudge(page)

  await expect
    .poll(
      () => page.evaluate(() => document.querySelector<HTMLVideoElement>('#ad-video')!.playbackRate),
      { message: '광고를 등속으로 재생하고 있다' },
    )
    .toBeGreaterThan(1)

  // 그리고 본편에는 남기지 않는다 — 16배속으로 재생되는 영상이 되면 안 된다.
  await page.evaluate(() => document.getElementById('movie_player')!.classList.remove('ad-showing'))
  await expect
    .poll(
      () => page.evaluate(() => document.querySelector<HTMLVideoElement>('#ad-video')!.playbackRate),
      { message: '본편이 빨리 감기로 남았다' },
    )
    .toBe(1)
})

test('감긴 위치가 되돌려지면 다시 감는다', async ({ context }) => {
  await installYouTubeFixture(context, { skippable: false })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await waitForMediaReady(page)
  await nudge(page)
  await expect
    .poll(async () => (await videoState(page)).currentTime)
    .toBeGreaterThanOrEqual(AD_DURATION_SECONDS - 0.1)

  // 플레이어가 위치를 되돌린 상황. 한 번만 감던 시절에는 여기서 포기했고,
  // 광고는 음소거된 채 끝까지 재생됐다.
  await page.evaluate(() => {
    document.querySelector<HTMLVideoElement>('#ad-video')!.currentTime = 0
  })
  await nudge(page)

  await expect
    .poll(async () => (await videoState(page)).currentTime, { message: '되돌려진 뒤 다시 감지 않았다' })
    .toBeGreaterThanOrEqual(AD_DURATION_SECONDS - 0.1)
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

test('모바일 플레이어의 건너뛰기도 누른다 — 이름이 달라도', async ({ context }) => {
  // What was on the phone: an ad playing, a 건너뛰기 button sitting on screen,
  // and layer 3 doing nothing. Its selectors were the desktop player's, and
  // mobile web neither uses those class names nor always sets `ad-showing` —
  // so it never even believed an ad was on.
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // Built with DOM calls rather than innerHTML: YouTube sends Trusted Types, and
  // assigning markup as a string throws there — which is also the environment
  // the real thing runs in.
  const clicked = page.evaluate(() => {
    const player = document.createElement('div')
    player.id = 'oc-mobile-player'
    player.className = 'html5-video-player'

    const overlay = document.createElement('div')
    overlay.className = 'ytp-ad-player-overlay'
    overlay.style.cssText = 'width:120px;height:20px'

    const button = document.createElement('button')
    button.className = 'ytm-something-else'
    button.setAttribute('aria-label', '광고 건너뛰기')
    button.textContent = '건너뛰기'
    button.style.cssText = 'width:80px;height:30px'

    player.append(overlay, button)

    // The real player keeps its id; this one takes it over so handleAdState
    // finds a player with no `ad-showing` class and mobile-only markup.
    document.getElementById('movie_player')?.removeAttribute('id')
    player.id = 'movie_player'
    document.body.append(player)

    return new Promise<boolean>((resolve) => {
      button.addEventListener('click', () => resolve(true))
      setTimeout(() => resolve(false), 8000)
    })
  })

  expect(await clicked, '모바일 건너뛰기 버튼을 못 눌렀다').toBe(true)
})
