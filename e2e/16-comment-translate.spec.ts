// 댓글 자동 번역 — the toggle down to a real click on a real element.
//
// The label logic is unit-tested; what only a browser proves is that the
// sweep finds the controls, presses each one once, and stays off when the
// toggle is off.

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

const settingsWith = (commentTranslate: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  toggles: { ...DEFAULT_SETTINGS.toggles, commentTranslate },
})

/** A comment section shaped like YouTube's: translate controls plus decoys. */
async function installComments(page: Page) {
  await page.evaluate(() => {
    const pressed: string[] = []
    ;(window as unknown as { __pressed: string[] }).__pressed = pressed
    const host = document.createElement('div')
    host.id = 'comments'
    for (const [id, label] of [
      ['c1', '번역'],
      ['c2', 'Translate to Korean'],
      ['c3', '원문 보기'], // already translated — pressing this undoes it
      ['c4', '답글'], // a decoy that must never be pressed
    ]) {
      const comment = document.createElement('div')
      const button = document.createElement('button')
      button.id = `translate-button-${id}`
      button.setAttribute('id', 'translate-button')
      button.dataset.name = id
      button.textContent = label
      button.addEventListener('click', () => pressed.push(id))
      comment.append(button)
      host.append(comment)
    }
    document.body.append(host)
  })
}

const pressed = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pressed?: string[] }).__pressed ?? [])

/** Nudge the DOM so the extension sweeps again. */
const nudge = (page: Page) =>
  page.evaluate(() => {
    document.getElementById('late-mount')!.appendChild(document.createElement('span'))
  })

test.describe('댓글 자동 번역', () => {
  test.beforeEach(async ({ context }) => {
    await installYouTubeFixture(context)
  })

  test('번역 버튼만 누르고, 원문 보기와 다른 버튼은 그대로 둔다', async ({
    context,
    background,
  }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await installComments(page)

    await writeSettings(background, settingsWith(true))
    await nudge(page)

    await expect.poll(() => pressed(page), { timeout: 8000 }).toEqual(['c1', 'c2'])
  })

  test('같은 버튼을 두 번 누르지 않는다', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await installComments(page)

    await writeSettings(background, settingsWith(true))
    await expect.poll(() => pressed(page), { timeout: 8000 }).toHaveLength(2)

    // Several more sweeps go by; a second press would mean fighting the reader,
    // who may have pressed "원문 보기" in between.
    for (let i = 0; i < 3; i += 1) {
      await nudge(page)
      await page.waitForTimeout(300)
    }
    expect(await pressed(page)).toEqual(['c1', 'c2'])
  })

  test('토글이 꺼져 있으면 아무것도 누르지 않는다 (대조군)', async ({ context, background }) => {
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await installComments(page)

    await writeSettings(background, settingsWith(false))
    await nudge(page)
    await page.waitForTimeout(1200)

    expect(await pressed(page)).toEqual([])
  })
})
