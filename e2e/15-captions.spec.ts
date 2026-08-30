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
        // Like the real player: `tracklist` leaves the auto-generated track out
        // unless it is asked for. Reproducing that here is the point — with a
        // stub that always hands back everything, the caller can forget to ask
        // and every test still passes, which is how a video whose only captions
        // are auto-generated came to read as a video with none.
        getOption: (module: string, option: string, args?: { includeAsr?: boolean }) => {
          if (module !== 'captions') return undefined
          if (option === 'tracklist') {
            return args?.includeAsr
              ? trackList
              : (trackList as Array<{ kind?: string }>).filter((t) => t.kind !== 'asr')
          }
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

/**
 * A player that remembers what it was told, and can be made to forget.
 *
 * The stub above answers `getOption('captions','track')` with nothing, which is
 * the "cannot read" case — correct for the tests that assert we do not touch a
 * video twice. This one tracks the current selection, so pressing CC can be
 * simulated: YouTube answers that button by restoring the caption state it has
 * saved, over whatever was just chosen.
 */
async function stubStatefulCaptionApi(page: Page, tracks: unknown[], translatable: unknown[]) {
  await page.evaluate(
    ([trackList, translationList]) => {
      const calls: unknown[] = []
      ;(window as unknown as { __captionCalls: unknown[] }).__captionCalls = calls
      let current: unknown = null
      ;(window as unknown as { __pressCC: () => void }).__pressCC = () => {
        // What the button really does: the player's own saved state wins.
        current = { languageCode: 'en' }
      }
      Object.assign(document.getElementById('movie_player') as object, {
        getVideoData: () => ({ video_id: 'fixture-video' }),
        loadModule: () => {},
        getOption: (module: string, option: string) => {
          if (module !== 'captions') return undefined
          if (option === 'tracklist') return trackList
          if (option === 'translationLanguages') return translationList
          if (option === 'track') return current
          return undefined
        },
        setOption: (module: string, option: string, value: unknown) => {
          calls.push({ module, option, value })
          if (option === 'track') current = value
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


  test('자동 생성 자막밖에 없는 영상도 번역해서 켠다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    // The shape reported from the phone: one track, English, auto-generated,
    // with Korean among the translation languages. The player hides that track
    // from `tracklist` unless includeAsr is asked for, so before v0.18.2 this
    // came back empty and the verdict was no-captions on a video that has them.
    await stubCaptionApi(page, [{ languageCode: 'en', kind: 'asr' }], [{ languageCode: 'ko' }])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => captionCalls(page), { timeout: 8000 }).toEqual([
      {
        module: 'captions',
        option: 'track',
        value: { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'ko' } },
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

test('CC 버튼이 영어로 되돌려 놓으면 다시 내 언어로 맞춘다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await stubStatefulCaptionApi(page, [{ languageCode: 'en' }, { languageCode: 'ko' }], [])

  await writeSettings(background, settingsWith(true))
  await expect.poll(() => captionCalls(page), { timeout: 8000 }).toHaveLength(1)

  // 성질 급해서 CC 를 직접 누른 경우. 유튜브가 자기가 저장해 둔 영어를 복원한다.
  await page.evaluate(() => (window as unknown as { __pressCC: () => void }).__pressCC())

  await expect.poll(() => captionCalls(page), { timeout: 8000 }).toEqual([
    { module: 'captions', option: 'track', value: { languageCode: 'ko' } },
    { module: 'captions', option: 'track', value: { languageCode: 'ko' } },
  ])
  await expect.poll(() => page.getAttribute('html', 'data-oc-ad-bye-pass-captions')).toBe('matched:kept')
})

test('직접 고른 언어와는 싸우지 않는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await stubStatefulCaptionApi(page, [{ languageCode: 'en' }, { languageCode: 'ko' }], [])

  await writeSettings(background, settingsWith(true))
  await expect.poll(() => captionCalls(page), { timeout: 8000 }).toHaveLength(1)

  // 되돌리기는 횟수가 정해져 있다. 한도까지 쓰고 나면 화면에 있는 것이
  // 사용자의 선택이고, 그 뒤로는 손대지 않는다.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => (window as unknown as { __pressCC: () => void }).__pressCC())
    await page.waitForTimeout(1200)
  }

  const calls = await captionCalls(page)
  expect(calls.length, '되돌리기가 무한히 반복되면 안 된다').toBeLessThanOrEqual(4)
  expect(await page.evaluate(() => (window as unknown as { __captionCalls: unknown[] }).__captionCalls.length)).toBe(calls.length)
})

/**
 * The verdict has to arrive with its evidence.
 *
 * A dump saying `native-language` was not answerable on its own: it is correct
 * on a Korean video and wrong on an English one, and telling which meant
 * opening that video and measuring it separately. The numbers that produced the
 * decision travel with it now, so one dump settles it.
 */
test('판정 옆에 근거가 함께 남는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await stubCaptionApi(page, [{ languageCode: 'en' }, { languageCode: 'ko' }], [])

  await writeSettings(background, settingsWith(true))
  await expect.poll(() => page.getAttribute('html', 'data-oc-ad-bye-pass-captions'), {
    timeout: 8000,
  }).toBe('matched')

  const evidence = await page.getAttribute('html', 'data-oc-ad-bye-pass-captions-detail')
  // Every decision below follows from the browser's language list, and nothing
  // else in a dump shows what that list was — so it is the one field that must
  // always be there.
  expect(evidence, '근거가 없다').toContain('want=ko')
  expect(evidence).toContain('tracks=2')
  expect(evidence).toContain('picked=ko')
})

test('안 켜기로 한 판정에도 근거가 남는다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  // 한국어 자동 생성 트랙만 있는 한국어 영상 — 손대지 않는 것이 맞다.
  await stubCaptionApi(page, [{ languageCode: 'ko', kind: 'asr' }], [])

  await writeSettings(background, settingsWith(true))
  await expect.poll(() => page.getAttribute('html', 'data-oc-ad-bye-pass-captions'), {
    timeout: 8000,
  }).toBe('native-language')

  // 아무것도 안 한 판정이야말로 근거가 가장 필요하다. 무엇을 보고 물러났는지가
  // 없으면 "왜 자막이 안 켜지냐" 는 물음에 답할 수가 없다.
  const evidence = await page.getAttribute('html', 'data-oc-ad-bye-pass-captions-detail')
  expect(evidence).toContain('spoken=ko')
  expect(evidence).toContain('want=ko')
})
