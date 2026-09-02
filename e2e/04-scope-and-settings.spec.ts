// The "only runs on YouTube" promise, and whether settings and the filter list reach the real page.

import type { BrowserContext, Page, Worker } from '@playwright/test'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts'
import { expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import {
  OTHER_SITE_URL,
  YOUTUBE_URL,
  installOtherSiteFixture,
  installYouTubeFixture,
} from './youtube-fixture.ts'

/** Parse fresh from the page — the surest way to know whether the MAIN world hook is live right now. */
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

test.describe('범위 — 유튜브 밖에서는 필요한 것만 한다', () => {
  test('MAIN world 훅은 유튜브 밖으로 나가지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    // Layer 1 rewrites JSON.parse. There is no reason for that to run on a
    // bank's website, so the MAIN world script stays matched to YouTube only —
    // even though the ISOLATED one now runs everywhere.
    expect(await layer1Active(page), '다른 사이트에서 JSON.parse 가 후킹되면 안 된다').toBe(false)
    expect(await lateParseHasAds(page)).toBe(true)
  })

  test('유튜브 전용 셀렉터는 다른 사이트로 새지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    // ytd-* would never match here anyway; the point is that they are not even
    // emitted, so the stylesheet stays small on every page on the web.
    expect(await layer2Active(page), '유튜브 셀렉터가 나가면 안 된다').toBe(false)
    await expect(page.locator('#masthead-ad')).toBeVisible()
  })

  test('범용 광고 자리는 다른 사이트에서도 숨긴다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    await expect(page.locator('#generic-ad'), '광고망 마커가 붙은 자리').toBeHidden()
    await expect(page.locator('#real-content'), '본문은 그대로여야 한다').toBeVisible()
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
    // Other groups stay on
    await expect(page.locator('#merch')).toBeHidden()
  })

  test('마스터 스위치를 끄면 1계층 프루닝도 멈춘다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    // While it is on, even a fresh parse comes back pruned
    await expect.poll(() => lateParseHasAds(page)).toBe(false)

    await writeSettings(background, { ...DEFAULT_SETTINGS, enabled: false })

    // Once the setting reaches the MAIN world the hook stands down
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
      // An attempt to escape the stylesheet, plus one sound rule
      customRules: 'body { display: none }\n#normal-card',
    })

    // The sound rule applies…
    await expect(page.locator('#normal-card')).toBeHidden()

    // …while the escape attempt never enters the stylesheet at all.
    // Checked by result rather than by inspecting the style node: is the page still intact?
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe('block')
    expect(
      await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.textContent = 'probe'
        document.body.appendChild(probe)
        const display = getComputedStyle(probe).display
        probe.remove()
        return display
      }),
      '광고와 무관한 요소까지 숨는 규칙이 들어가면 안 된다',
    ).toBe('block')
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

    // Reproduces exactly the state the background leaves behind after validating
    // and caching — the very path used when YouTube renames a tag and only the
    // JSON needs shipping.
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
      { url: DEFAULT_SETTINGS.lists[0].url },
    )

    await expect(page.locator('#normal-card'), '원격 규칙이 반영돼야 한다').toBeHidden()
    // The bundled defaults survive alongside it (union merge)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  })
})

test('차단 통계가 쌓인다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // The content script batches its reports every 3 seconds
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

/**
 * Seed the settings and open the popup with every toggle on screen.
 *
 * The sponsor row is YouTube's, and the popup leads with what applies where you
 * are standing — opened over a blank tab, that is the other list. The foot
 * button that widens it is the one a person would press.
 */
async function popupWithAllToggles(
  context: BrowserContext,
  background: Worker,
  extensionId: string,
  patch: Record<string, unknown>,
) {
  await background.evaluate(async (patch: Record<string, unknown>) => {
    const got = await chrome.storage.sync.get('settings')
    const s = (got.settings ?? {}) as Record<string, unknown>
    await chrome.storage.sync.set({ settings: { ...s, ...patch, savedAt: Date.now() } })
  }, patch)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('.foot button').first().click()
  await page.locator('.sponsor-cats').waitFor()
  return page
}

const storedCategories = (background: Worker) => async () =>
  (await background.evaluate(async () => {
    const got = await chrome.storage.sync.get('settings')
    return (got.settings as { sponsorCategories: string[] }).sponsorCategories
  })) as string[]

test('스폰서 카테고리를 빠르게 여러 개 눌러도 하나도 안 잃는다', async ({ context, background, extensionId }) => {
  // Each checkbox replaces the whole list, and the list it starts from used to
  // be the one that render closed over. Ticking four faster than the storage
  // round trip meant the last writer won and two of the four vanished.
  const page = await popupWithAllToggles(context, background, extensionId, {
    sponsorCategories: ['sponsor'],
  })

  const boxes = page.locator('.sponsor-cat input')
  await expect(boxes).toHaveCount(9)
  // No awaiting the round trip between clicks — that is the point.
  for (const i of [1, 3, 5, 7]) await boxes.nth(i).click({ force: true, noWaitAfter: true })

  const stored = storedCategories(background)
  await expect.poll(stored, { timeout: 8000 }).toEqual([
    'sponsor',
    'selfpromo',
    'intro',
    'preview',
    'filler',
  ])

  // Unticking in a row is just as ordinary a thing to do.
  for (const i of [1, 3]) await boxes.nth(i).click({ force: true, noWaitAfter: true })
  await expect.poll(stored, { timeout: 8000 }).toEqual(['sponsor', 'preview', 'filler'])
})

test('종류는 스위치 옆에 있고, 스위치가 어느 쪽이든 고를 수 있다', async ({
  context,
  background,
  extensionId,
}) => {
  // This used to be a card on the settings view, behind a button, with every box
  // disabled until the switch — in the list you had just left — was on. Setting
  // it up therefore meant two screens in a fixed order, and the settings view
  // read the switch once on open, so it had to be reopened to notice.
  const page = await popupWithAllToggles(context, background, extensionId, {
    toggles: { sponsorSkip: false },
    sponsorCategories: [],
  })

  // In the popup itself: no press on the settings button on the way here.
  await expect(page.locator('.sponsor-cats')).toBeVisible()

  // No `force`: a click that has to be forced is a box the user could not have
  // pressed, which is the whole bug.
  const first = page.locator('.sponsor-cat input').first()
  await expect(first).toBeEnabled()
  await first.click()
  await expect.poll(storedCategories(background), { timeout: 8000 }).toEqual(['sponsor'])

  // And turning the switch on right there leaves them just as editable — the
  // gate is gone in both directions, not moved to the other side.
  await page.getByRole('switch', { name: '스폰서 구간 건너뛰기' }).click()
  await expect(first).toBeEnabled()
  await expect
    .poll(
      async () =>
        (await background.evaluate(async () => {
          const got = await chrome.storage.sync.get('settings')
          return (got.settings as { toggles: Record<string, boolean> }).toggles.sponsorSkip
        })) as boolean,
      { timeout: 8000 },
    )
    .toBe(true)
})
