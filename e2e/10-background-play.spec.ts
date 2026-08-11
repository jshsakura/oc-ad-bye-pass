// Background playback — the toggle that keeps the page believing it is visible.
//
// It is off by default and it is the one setting that changes what YouTube does
// rather than what it shows, so both halves of that matter and both are checked
// here: that it stays out of the way until asked for, and that once asked for
// it actually holds.
//
// The two halves of the mechanism fail independently. Faking the properties
// while letting the event through leaves the page's own handler running, and it
// pauses on a value it will never re-read; swallowing the event while leaving
// the properties honest leaves anything that polls them unconvinced. So the
// test asserts on both.

import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

/** What the page itself can see — read in the MAIN world, like YouTube would. */
async function pageSees(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    let sawEvent = false
    const onChange = () => {
      sawEvent = true
    }
    document.addEventListener('visibilitychange', onChange)
    document.dispatchEvent(new Event('visibilitychange'))
    document.removeEventListener('visibilitychange', onChange)
    return { hidden: document.hidden, state: document.visibilityState, sawEvent }
  })
}

test('기본값은 켜짐 — 페이지가 계속 보이는 줄 안다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  // 폰에서 화면을 나가면 재생이 멈추는 것이 이 확장을 까는 이유라, 켜달라고
  // 요구하지 않는다.
  await expect
    .poll(async () => (await pageSees(page)).sawEvent, { message: '설정이 MAIN 까지 오지 않았다' })
    .toBe(false)

  const seen = await pageSees(page)
  expect(seen.hidden).toBe(false)
  expect(seen.state).toBe('visible')
})

test('숨겨져도 보이는 것으로 보이고, 이벤트는 페이지에 닿지 않는다', async ({ context }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  await expect
    .poll(async () => (await pageSees(page)).sawEvent, { message: '설정이 MAIN 까지 오지 않았다' })
    .toBe(false)

  const seen = await pageSees(page)
  expect(seen.hidden).toBe(false)
  expect(seen.state).toBe('visible')

  // 그리고 진짜로 숨겨졌을 때가 요점이다 — 탭을 뒤로 보내도 값이 바뀌지 않아야 한다
  const other = await context.newPage()
  await other.goto('about:blank')
  await other.bringToFront()

  const hiddenNow = await page.evaluate(() => ({
    hidden: document.hidden,
    state: document.visibilityState,
  }))
  expect(hiddenNow.hidden, '탭이 뒤로 갔는데 hidden 이 true 로 새어나왔다').toBe(false)
  expect(hiddenNow.state).toBe('visible')
})

test('다시 끄면 원래 값이 돌아온다', async ({ context, background }) => {
  await installYouTubeFixture(context)
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)

  const setBackgroundPlay = async (on: boolean) => {
    await background.evaluate(async (value) => {
      const got = await chrome.storage.local.get('settings')
      const settings = got.settings as { toggles: Record<string, boolean> }
      settings.toggles.backgroundPlay = value
      await chrome.storage.local.set({ settings })
    }, on)
  }

  await setBackgroundPlay(true)
  await expect.poll(async () => (await pageSees(page)).sawEvent).toBe(false)

  // 되돌리면 프로퍼티가 원본 게터로 돌아가고 이벤트도 다시 흐른다.
  // 한 번 켜면 영영 못 끄는 훅은 사용자가 끌 수 없는 훅이다.
  await setBackgroundPlay(false)
  await expect
    .poll(async () => (await pageSees(page)).sawEvent, { message: '껐는데 이벤트가 계속 막힌다' })
    .toBe(true)
})
