// 음성 고정 — the wiring from the toggle down to the player call.
//
// The choice itself is unit-tested (tests/audio.test.ts). What only a browser
// can prove is the path: storage write → ISOLATED recompute → config message →
// MAIN world timer → setAudioTrack on the player element. The fixture's
// #movie_player gets a stub audio API installed from the page context, which is
// the world the real call happens in.

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

/** Give the fixture's #movie_player the audio half of the player API. */
async function stubAudioApi(page: Page, tracks: unknown[], currentIndex = 0) {
  await page.evaluate(
    ([trackList, index]) => {
      const list = trackList as Array<{ id?: string }>
      let current = list[index as number] ?? null
      const calls: unknown[] = []
      ;(window as unknown as { __audioCalls: unknown[] }).__audioCalls = calls
      Object.assign(document.getElementById('movie_player') as object, {
        getVideoData: () => ({ video_id: 'fixture-video' }),
        getAvailableAudioTracks: () => list,
        getAudioTrack: () => current,
        setAudioTrack: (track: { id?: string }) => {
          calls.push(track?.id ?? null)
          current = track
          return true
        },
      })
    },
    [tracks, currentIndex] as [unknown[], number],
  )
}

const audioCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __audioCalls?: unknown[] }).__audioCalls ?? [])

const marker = (page: Page) => page.getAttribute('html', 'data-oc-ad-bye-pass-audio')

// The target language is the browser locale, which fixtures.ts pins to ko-KR.
const settingsWith = (audioLanguage: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  toggles: { ...DEFAULT_SETTINGS.toggles, audioLanguage },
})

const t = (lang: string, over: Record<string, unknown> = {}) => ({
  id: `251;${lang}`,
  languageInfo: { id: lang, name: lang },
  ...over,
})

test.describe('음성 고정', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('더빙된 영상이면 브라우저 언어 음성으로 바꾼다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubAudioApi(page, [t('en', { isDefault: true }), t('ko'), t('ja')])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => audioCalls(page), { timeout: 8000 }).toEqual(['251;ko'])
    await expect.poll(() => marker(page)).toBe('switched(ko)')
  })

  test('내 언어 음성이 없으면 손대지 않는다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubAudioApi(page, [t('en', { isDefault: true }), t('ja')])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => marker(page), { timeout: 8000 }).toBe('no-match')
    expect(await audioCalls(page), '고를 게 없으면 플레이어를 건드리면 안 된다').toEqual([])
  })

  test('음성이 하나뿐인 보통 영상에서는 아무것도 하지 않는다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubAudioApi(page, [t('en', { isDefault: true })])

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => marker(page), { timeout: 8000 }).toBe('single-track')
    expect(await audioCalls(page)).toEqual([])
  })

  test('이미 내 언어면 갈아끼우지 않는다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    // 두 번째 트랙(ko)이 이미 재생 중이다.
    await stubAudioApi(page, [t('en', { isDefault: true }), t('ko')], 1)

    await writeSettings(background, settingsWith(true))

    await expect.poll(() => marker(page), { timeout: 8000 }).toBe('already(ko)')
    expect(await audioCalls(page)).toEqual([])
  })

  test('같은 영상에는 한 번만 손댄다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubAudioApi(page, [t('en', { isDefault: true }), t('ko')])

    await writeSettings(background, settingsWith(true))
    await expect.poll(() => audioCalls(page), { timeout: 8000 }).toHaveLength(1)

    // 타이머가 두 번 더 돈다. 두 번째 호출은 사용자가 손으로 바꾼 것을
    // 되돌린다는 뜻이다.
    await page.waitForTimeout(2500)
    expect(await audioCalls(page)).toHaveLength(1)
  })

  test('토글이 꺼져 있으면 아무것도 하지 않는다 (대조군)', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await stubAudioApi(page, [t('en', { isDefault: true }), t('ko')])

    await writeSettings(background, settingsWith(false))

    await page.waitForTimeout(3000)
    expect(await audioCalls(page)).toEqual([])
    expect(await marker(page)).toBeNull()
  })
})
