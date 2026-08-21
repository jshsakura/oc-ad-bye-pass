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

test('내 언어로 말하는 영상에는 자막을 켜지 않는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  // asr 트랙의 언어가 곧 영상의 음성 언어다 (픽스처 로케일은 ko-KR)
  await stubCaptionApi(page, [{ languageCode: 'ko', kind: 'asr' }, { languageCode: 'en' }], [])

  await writeSettings(background, settingsWith(true))

  await expect
    .poll(() => page.getAttribute('html', 'data-oc-ad-bye-pass-captions'), { timeout: 8000 })
    .toBe('native-language')
  expect(await captionCalls(page)).toHaveLength(0)
})

test('플레이어 목록이 비면 응답 데이터의 트랙으로 적용한다 (모바일 경로)', async ({
  context,
  background,
}) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  // 목록이 끝내 채워지지 않는 모바일 플레이어를 흉내낸다
  await stubCaptionApi(page, [], [])
  // 영상 응답이 JSON.parse 를 지나가며 캡처된다 — 1계층과 같은 길
  await page.evaluate(() => {
    JSON.parse(
      JSON.stringify({
        videoDetails: { videoId: 'fixture-video' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { languageCode: 'en', vssId: 'a.en', kind: 'asr', isTranslatable: true, name: { simpleText: 'English' } },
            ],
            translationLanguages: [{ languageCode: 'ko', languageName: { simpleText: '한국어' } }],
          },
        },
      }),
    )
  })

  await writeSettings(background, settingsWith(true))

  // 5초의 유예(플레이어 목록 우선) 뒤에 응답 데이터 경로가 적용된다
  await expect.poll(() => captionCalls(page), { timeout: 15000 }).toEqual([
    {
      module: 'captions',
      option: 'track',
      value: {
        languageCode: 'en',
        languageName: 'English',
        displayName: 'English',
        kind: 'asr',
        vss_id: 'a.en',
        name: '',
        is_servable: true,
        is_default: false,
        is_translateable: true,
        translationLanguage: { languageCode: 'ko', languageName: '한국어' },
      },
    },
  ])
  expect(await page.getAttribute('html', 'data-oc-ad-bye-pass-captions')).toBe('translated:data')
})
