// "유튜브에서만 동작한다"는 약속과, 설정·필터 리스트가 실제 페이지까지 닿는지.

import type { Page } from '@playwright/test'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts'
import { expect, test } from './fixtures.ts'
import {
  OTHER_SITE_URL,
  YOUTUBE_URL,
  installOtherSiteFixture,
  installYouTubeFixture,
} from './youtube-fixture.ts'

/** 페이지에서 새로 파싱해 본다 — MAIN world 훅이 지금 살아 있는지 확인하는 가장 확실한 방법 */
const lateParseHasAds = (page: Page) =>
  page.evaluate(() => {
    const parsed = JSON.parse('{"adPlacements":[{}],"videoDetails":{"videoId":"late"}}')
    return Array.isArray((parsed as Record<string, unknown>).adPlacements)
  })

async function writeSettings(
  background: { evaluate: (fn: (s: Settings) => unknown, arg: Settings) => Promise<unknown> },
  settings: Settings,
) {
  await background.evaluate(
    (value) => chrome.storage.sync.set({ settings: value }),
    settings,
  )
}

test.describe('범위 — 유튜브 밖에서는 아무것도 하지 않는다', () => {
  test('다른 사이트에는 콘텐츠 스크립트가 주입되지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    // MAIN world 훅 없음
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__ocAdByePassInstalled),
    ).toBeUndefined()
    // ISOLATED world 스타일시트 없음
    expect(await page.locator('style#oc-ad-bye-pass').count()).toBe(0)
    // JSON.parse 도 원본 그대로 — 광고 필드가 살아 있다
    expect(await lateParseHasAds(page)).toBe(true)
  })

  test('유튜브에서 쓰는 셀렉터라도 다른 사이트에서는 숨기지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    await expect(page.locator('#masthead-ad')).toBeVisible()
    await expect(page.locator('ytd-ad-slot-renderer')).toBeVisible()
  })
})

test.describe('설정이 실제 페이지에 반영된다', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('토글을 끄면 그 그룹의 광고가 다시 보인다 (새로고침 없이)', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect(page.locator('#masthead-ad')).toBeHidden()

    await writeSettings(background, {
      ...DEFAULT_SETTINGS,
      toggles: { ...DEFAULT_SETTINGS.toggles, generalAds: false },
    })

    await expect(page.locator('#masthead-ad'), '끄면 즉시 되살아나야 한다').toBeVisible()
    // 다른 그룹은 그대로 켜져 있다
    await expect(page.locator('#merch')).toBeHidden()
  })

  test('마스터 스위치를 끄면 1계층 프루닝도 멈춘다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    // 켜져 있는 동안에는 새로 파싱해도 광고가 잘린다
    await expect.poll(() => lateParseHasAds(page)).toBe(false)

    await writeSettings(background, { ...DEFAULT_SETTINGS, enabled: false })

    // 설정이 MAIN world 까지 건너가면 훅이 손을 뗀다
    await expect.poll(() => lateParseHasAds(page)).toBe(true)
    await expect(page.locator('#masthead-ad')).toBeVisible()
  })

  test('내 규칙으로 원하는 요소를 직접 차단할 수 있다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect(page.locator('#normal-card')).toBeVisible()

    await writeSettings(background, {
      ...DEFAULT_SETTINGS,
      customRules: '! 내가 직접 넣은 규칙\n#normal-card',
    })

    await expect(page.locator('#normal-card'), '내 규칙이 바로 먹어야 한다').toBeHidden()
  })

  test('안전 검사를 통과 못 하는 내 규칙은 무시된다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    await writeSettings(background, {
      ...DEFAULT_SETTINGS,
      // 스타일시트를 탈출하려는 시도 + 멀쩡한 규칙 하나
      customRules: 'body { display: none }\n#normal-card',
    })

    // 멀쩡한 규칙은 먹고
    await expect(page.locator('#normal-card')).toBeHidden()

    // 탈출 시도는 스타일시트에 아예 들어가지 못한다 — body 가 살아 있는지로 확인한다
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe('block')
    const css = await page.evaluate(
      () => document.getElementById('oc-ad-bye-pass')?.textContent ?? '',
    )
    expect(css.split('\n').some((line) => line.startsWith('body'))).toBe(false)
  })
})

test.describe('원격 필터 리스트', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('받아온 리스트의 규칙이 페이지에 적용된다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect(page.locator('#normal-card')).toBeVisible()

    // 백그라운드가 검증까지 마치고 캐시에 넣은 상태를 그대로 재현한다.
    // (유튜브가 태그를 바꿨을 때 JSON 만 고쳐서 배포하는 바로 그 경로다)
    await background.evaluate(
      async ({ url }) => {
        await chrome.storage.local.set({
          filterCache: {
            url,
            fetchedAt: Date.now(),
            dropped: 0,
            error: null,
            list: {
              name: 'e2e',
              version: 99,
              updatedAt: '2026-08-10',
              rules: {
                hide: { generalAds: ['#normal-card'] },
                prune: [],
                click: [],
                allow: [],
              },
            },
          },
        })
      },
      { url: DEFAULT_SETTINGS.listUrl },
    )

    await expect(page.locator('#normal-card'), '원격 규칙이 반영돼야 한다').toBeHidden()
    // 번들 기본 규칙도 그대로 살아 있다 (합집합 병합)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  })
})

test('차단 통계가 쌓인다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // 콘텐츠 스크립트는 3초마다 모아서 보고한다
  await expect
    .poll(
      async () => {
        const stored = (await background.evaluate(() => chrome.storage.local.get('stats'))) as {
          stats?: { pruned: number; skipped: number }
        }
        return stored.stats?.pruned ?? 0
      },
      { timeout: 20_000, message: '프루닝 건수가 배지까지 올라와야 한다' },
    )
    .toBeGreaterThan(0)
})
