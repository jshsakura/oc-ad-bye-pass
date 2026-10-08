import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'
import type { Settings } from '../src/shared/settings.ts'

test.use({ autoplayPolicy: 'user-gesture-required' })

test('첫 유성 재생이 정책으로 거절되면 멈춰 있고, 클릭 뒤에는 재생한다', async ({ context, background }) => {
  await background.evaluate(async () => {
    const got = await chrome.storage.local.get('settings')
    const settings = got.settings as Settings
    settings.toggles.playerFallback = false
    await chrome.storage.local.set({ settings })
  })
  await installYouTubeFixture(context)
  await context.addInitScript(() => {
    document.addEventListener('loadedmetadata', (event) => {
      const video = event.target
      if (!(video instanceof HTMLVideoElement)) return
      document.getElementById('movie_player')?.classList.remove('ad-showing')
      video.loop = true
      void video.play().then(
        () => document.documentElement.setAttribute('data-first-play', 'allowed'),
        (error: DOMException) => document.documentElement.setAttribute('data-first-play', error.name),
      )
    }, { capture: true, once: true })
    document.addEventListener('click', () => {
      void document.querySelector('video')?.play()
    })
  })
  const page = await context.newPage()
  await page.goto(YOUTUBE_URL)
  await expect(page.locator('html')).toHaveAttribute('data-first-play', 'NotAllowedError')
  expect(await page.evaluate(() => document.querySelector('video')!.paused)).toBe(true)
  await page.locator('video').evaluate((video) => {
    video.style.width = '200px'
    video.style.height = '100px'
  })
  await page.locator('video').click()
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(false)
})
