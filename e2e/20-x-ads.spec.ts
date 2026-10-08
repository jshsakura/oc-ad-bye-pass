import { expect, test } from './fixtures.ts'
import type { Settings } from '../src/shared/settings.ts'

const fixture = `<!doctype html><html><body>
<main>
  <div data-testid="cellInnerDiv" id="organic"><article data-testid="tweet">Ad와 광고에 대해 이야기하는 일반 글</article></div>
  <div data-testid="cellInnerDiv" id="promotion"><div><div class="layout"><div class="ad" data-testid="placementTracking"><article data-testid="tweet">Ad · 광고 게시글</article></div></div></div></div>
  <div data-testid="cellInnerDiv" id="pixel-ad"><article data-testid="placementTracking"><div data-testid="video-impression-pixel"></div>광고</article></div>
  <div data-testid="cellInnerDiv" id="ordinary-tracking"><article data-testid="placementTracking">일반 항목</article></div>
</main>
</body></html>`

for (const host of ['x.com', 'twitter.com', 'example.org']) {
  test(`${host}: 광고만 숨기고 일반 게시글과 다른 사이트는 유지한다`, async ({ context, background }) => {
    await context.route(`https://${host}/**`, (route) => route.fulfill({ contentType: 'text/html', body: fixture }))
    const page = await context.newPage()
    await page.goto(`https://${host}/home`)
    await page.waitForSelector('#oc-ad-bye-pass', { state: 'attached' })
    await expect(page.locator('#organic')).toBeVisible()
    await expect(page.locator('#ordinary-tracking')).toBeVisible()
    if (host === 'example.org') {
      await expect(page.locator('#promotion')).toBeVisible()
      await expect(page.locator('#pixel-ad')).toBeVisible()
      return
    }
    await expect(page.locator('#promotion')).toBeHidden()
    await expect(page.locator('#pixel-ad')).toBeHidden()

    // Infinite-scroll insertion and reuse of a virtualized cell need no observer.
    await page.evaluate(() => {
      const clone = document.getElementById('promotion')!.cloneNode(true) as HTMLElement
      clone.id = 'late-ad'
      document.querySelector('main')!.append(clone)
    })
    await expect(page.locator('#late-ad')).toBeHidden()
    await page.evaluate(() => document.querySelector('#late-ad [data-testid="placementTracking"]')!.removeAttribute('data-testid'))
    await expect(page.locator('#late-ad')).toBeVisible()

    await background.evaluate(async () => {
      const got = await chrome.storage.local.get('settings')
      const settings = got.settings as Settings
      settings.toggles.genericAds = false
      const updated = { ...settings, savedAt: Date.now() }
      await chrome.storage.local.set({ settings: updated })
      await chrome.storage.sync.set({ settings: updated })
    })
    await expect(page.locator('#promotion')).toBeVisible()
    await expect(page.locator('#pixel-ad')).toBeVisible()
  })
}
