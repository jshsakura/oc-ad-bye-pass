import type { Settings } from '../src/shared/settings.ts'
import { expect, test } from './fixtures.ts'

const body = `
  <style>body { font: 16px sans-serif } body * { display: block; min-height: 24px }</style>
  <ytd-rich-section-renderer id="shelf"><ytd-rich-shelf-renderer is-shorts>Shorts shelf</ytd-rich-shelf-renderer></ytd-rich-section-renderer>
  <ytm-reel-shelf-renderer id="mobile-shelf">Mobile Shorts</ytm-reel-shelf-renderer>
  <ytd-rich-item-renderer id="short-card"><a href="/shorts/abc">Short</a></ytd-rich-item-renderer>
  <ytd-video-renderer id="search-short"><a id="thumbnail" href="/shorts/abc">Search short</a></ytd-video-renderer>
  <yt-shorts-lockup-view-model id="lockup">Shorts card</yt-shorts-lockup-view-model>
  <ytd-guide-entry-renderer id="menu"><a href="/shorts">Shorts</a></ytd-guide-entry-renderer>
  <ytm-pivot-bar-item-renderer id="mobile-menu"><span class="pivot-shorts">Shorts</span></ytm-pivot-bar-item-renderer>
  <yt-tab-shape id="channel-tab"><a href="/@creator/shorts">Shorts tab</a></yt-tab-shape>
  <ytd-rich-item-renderer id="normal"><a href="/watch?v=abc">Normal video</a></ytd-rich-item-renderer>
  <ytd-video-renderer id="normal-search"><a id="thumbnail" href="/watch?v=xyz">Normal result</a><p>Description mentioning <a href="/shorts/abc">a short</a></p></ytd-video-renderer>
  <ytd-reel-video-renderer id="player">Direct Shorts player</ytd-reel-video-renderer>
  <ytd-ad-slot-renderer id="ad">Ad</ytd-ad-slot-renderer>
`
const shorts = ['shelf', 'mobile-shelf', 'short-card', 'search-short', 'lockup', 'menu', 'mobile-menu', 'channel-tab']

for (const host of ['www.youtube.com', 'm.youtube.com']) {
  test(`쇼츠 숨김 — 기본값, 즉시 적용, 복원 및 범위 (${host})`, async ({ context, background, extensionId }) => {
    await context.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body }))
    const page = await context.newPage()
    await page.goto(`https://${host}/`)

    for (const id of shorts) await expect(page.locator('#' + id)).toBeVisible()
    await expect(page.locator('#ad')).toBeHidden()

    const popup = await context.newPage()
    await popup.setViewportSize({ width: 393, height: 852 })
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    // The extension page is the active tab: expose YouTube-only toggles.
    const toggle = popup.getByRole('switch', { name: '쇼츠 숨기기', exact: true })
    await popup.getByRole('button', { name: '전체 항목 보기', exact: true }).click()
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    for (const id of shorts) await expect(page.locator('#' + id)).toBeHidden()
    for (const id of ['normal', 'normal-search', 'player']) await expect(page.locator('#' + id)).toBeVisible()

    await page.evaluate(() => {
      const late = document.createElement('ytm-reel-shelf-renderer')
      late.id = 'late'
      late.textContent = 'Late SPA shelf'
      document.body.append(late)
    })
    await expect(page.locator('#late')).toBeHidden()
    await popup.screenshot({ path: '/tmp/oc-hide-shorts-' + host + '.png', fullPage: true })
    await popup.reload()
    await popup.getByRole('button', { name: '전체 항목 보기', exact: true }).click()
    await expect(popup.getByRole('switch', { name: '쇼츠 숨기기', exact: true })).toBeChecked()
    await popup.getByRole('switch', { name: '쇼츠 숨기기', exact: true }).uncheck()
    for (const id of [...shorts, 'late']) await expect(page.locator('#' + id)).toBeVisible()
    await expect(page.locator('#ad')).toBeHidden()

    const update = async (patch: { enabled?: boolean; allowlist?: string[] }) => {
      await background.evaluate(async (patch) => {
        const stored = await chrome.storage.local.get('settings')
        const settings = stored.settings as Settings
        const next = { ...settings, ...patch, toggles: { ...settings.toggles, hideShorts: true }, savedAt: Date.now() }
        await chrome.storage.local.set({ settings: next })
        await chrome.storage.sync.set({ settings: next })
      }, patch)
    }
    await update({ enabled: true })
    await expect(page.locator('#shelf')).toBeHidden()
    await update({ enabled: false })
    await expect(page.locator('#shelf')).toBeVisible()
    await update({ enabled: true, allowlist: [host] })
    await expect(page.locator('#shelf')).toBeVisible()

    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body }))
    await page.goto('https://example.com/')
    await expect(page.locator('#shelf')).toBeVisible()
  })
}
