// 자막 자동 선택 — the wiring from the toggle down to the player call.
//
// The chooser's decisions are unit-tested; what only a browser can prove is
// the path: storage write → ISOLATED recompute → config message → MAIN world
// timer → setOption on the player element. The fixture's #movie_player gets a
// stub caption API installed from the page context, which is the same world
// the real call happens in.

import type { Page } from '@playwright/test'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts'
import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

async function writeSettings(
  background: { evaluate: (fn: (s: Settings) => unknown, arg: Settings) => Promise<unknown> },
  settings: Settings,
) {
  await background.evaluate((value) => chrome.storage.sync.set({ settings: value }), settings)
}

/** Give the fixture's #movie_player the caption half of the player API. */
async function stubCaptionApi(page: Page, tracks: unknown[], translatable: unknown[]) {
  await page.evaluate(
    ([trackList, translationList]) => {
      const calls: unknown[] = []
      ;(window as unknown as { __captionCalls: unknown[] }).__captionCalls = calls
      Object.assign(document.getElementById('movie_player') as object, {
        getVideoData: () => ({ video_id: 'fixture-video' }),
        loadModule: () => {},
        getOption: (module: string, option: string) => {
          if (module !== 'captions') return undefined
          if (option === 'tracklist') return trackList
          if (option === 'translationLanguages') return translationList
          return undefined
        },
        setOption: (module: string, option: string, value: unknown) => {
          calls.push({ module, option, value })
        },
      })
    },
    [tracks, translatable] as [unknown[], unknown[]],
  )
}

const captionCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __captionCalls?: unknown[] }).__captionCalls ?? [])

// The target language is the browser locale, which fixtures.ts pins to ko-KR.
const settingsWith = (autoCaptions: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  toggles: { ...DEFAULT_SETTINGS.toggles, autoCaptions },
})

test.describe('자막 자동 선택', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('브라우저 언어의 트랙이 있으면 그 트랙을 고른다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubCaptionApi(page, [{ languageCode: 'en' }, { languageCode: 'ko' }], [])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => captionCalls(page), { timeout: 8000 }).toEqual([
      { module: 'captions', option: 'track', value: { languageCode: 'ko' } },
    ])
    expect(await page.getAttribute('html', 'data-oc-ad-bye-pass-captions')).toBe('matched')
  })

  test('맞는 트랙이 없으면 브라우저 언어로 자동 번역을 켠다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubCaptionApi(page, [{ languageCode: 'en' }], [{ languageCode: 'ko' }])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => captionCalls(page), { timeout: 8000 }).toEqual([
      {
        module: 'captions',
        option: 'track',
        value: { languageCode: 'en', translationLanguage: { languageCode: 'ko' } },
      },
    ])
    expect(await page.getAttribute('html', 'data-oc-ad-bye-pass-captions')).toBe('translated')
  })


  test('같은 영상에는 한 번만 손댄다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubCaptionApi(page, [{ languageCode: 'ko' }], [])

    await writeSettings(background, settingsWith(true))
    await expect.poll(() => captionCalls(page), { timeout: 8000 }).toHaveLength(1)

    // Two more timer ticks pass; a second call would mean we fight the user.
    await page.waitForTimeout(2500)
    expect(await captionCalls(page)).toHaveLength(1)
  })

  test('토글이 꺼져 있으면 아무것도 하지 않는다 (대조군)', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubCaptionApi(page, [{ languageCode: 'ko' }], [])

    // Write settings anyway so the config message definitely travelled.
    await writeSettings(background, settingsWith(false))

    await page.waitForTimeout(2500)
    expect(await captionCalls(page)).toHaveLength(0)
    expect(await page.getAttribute('html', 'data-oc-ad-bye-pass-captions')).toBeNull()
  })
})
