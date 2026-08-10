// 2계층 — 광고 컴포넌트가 그려지지 않는지, 그리고 멀쩡한 콘텐츠는 건드리지 않는지.

import { chromium } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const AD_ELEMENTS = [
  { selector: '#masthead-ad', name: '홈 상단 배너' },
  { selector: '#ad-card', name: '피드 광고 카드(껍데기째)' },
  { selector: '#display-ad', name: '디스플레이 광고' },
  { selector: '#merch', name: '상품 선반' },
  { selector: '#premium', name: 'Premium 권유' },
  { selector: '.ytp-ad-overlay-slot', name: '플레이어 오버레이 광고' },
]

test.describe('2계층 컴포넌트 필터', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  for (const { selector, name } of AD_ELEMENTS) {
    test(`광고가 화면에서 사라진다 — ${name}`, async ({ context }) => {
      const page = await context.newPage()
      await page.goto(YOUTUBE_URL)
      await expect(page.locator(selector)).toBeHidden()
    })
  }

  test('정상 영상 카드는 그대로 보인다 (오탐 회귀)', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // 광고 카드는 사라졌는데
    await expect(page.locator('#ad-card')).toBeHidden()
    // 같은 태그를 쓰는 일반 카드는 살아 있어야 한다.
    // ReVanced 가 home_video_with_context 를 예외로 두는 것과 같은 이유다.
    await expect(page.locator('#normal-card')).toBeVisible()
    await expect(page.locator('#normal-card ytd-rich-grid-media')).toContainText('normal card')
  })

  test('나중에 삽입되는 광고도 잡는다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    // 유튜브는 스크롤할 때 광고를 나중에 붙인다. CSS 로 막으므로 새로 붙어도 즉시 안 보인다.
    await page.evaluate(() => {
      const late = document.createElement('ytd-ad-slot-renderer')
      late.id = 'lazy-ad'
      late.textContent = 'AD — lazily inserted'
      document.getElementById('late-mount')!.appendChild(late)
    })

    await expect(page.locator('#lazy-ad')).toBeHidden()
  })

  test('애드블록 경고창을 치우고 재생을 되살린다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    await page.evaluate(() => (window as unknown as { showAdblockNag: () => void }).showAdblockNag())

    // 경고 다이얼로그와 뒤 배경이 사라지고
    await expect(page.locator('#nag')).toHaveCount(0)
    await expect(page.locator('tp-yt-iron-overlay-backdrop')).toHaveCount(0)
    // 모달이 걸어둔 스크롤 잠금이 풀리고
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    // 경고창이 멈춰 세운 재생이 실제로 다시 돈다 (스텁이 아니라 진짜 미디어 상태다)
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector<HTMLVideoElement>('#ad-video')!.paused),
      )
      .toBe(false)
  })

  test('광고 닫기 버튼을 대신 눌러준다', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __observed: { feedbackClosed: boolean } }).__observed
              .feedbackClosed,
        ),
      )
      .toBe(true)
  })
})

test('대조군 — 확장이 없으면 광고 요소가 전부 보인다', async () => {
  const plain = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: LAUNCH_ARGS,
  })
  try {
    await installYouTubeFixture(plain)
    const page = await plain.newPage()
    await page.goto(YOUTUBE_URL)

    for (const { selector, name } of AD_ELEMENTS) {
      await expect(page.locator(selector), `${name} 은 차단 전에는 보여야 한다`).toBeVisible()
    }
  } finally {
    await plain.close()
  }
})
