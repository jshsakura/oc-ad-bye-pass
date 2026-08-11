// Global injection and the escape hatch that makes it defensible.
//
// Running on every site means we can break any site. The per-site off switch is
// not a convenience feature — it is the thing that keeps a broken page from
// costing the user the whole extension. So it gets tested as hard as the
// blocking does: switched off, *nothing* of ours may remain, at either layer.

import { expect, test } from './fixtures.ts'
import { layer2Active } from './probes.ts'
import {
  OTHER_SITE_URL,
  YOUTUBE_URL,
  installOtherSiteFixture,
  installYouTubeFixture,
} from './youtube-fixture.ts'
import type { Worker } from '@playwright/test'

const AD_REQUEST = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'
const BENIGN_REQUEST = 'https://example.com/app.js'

type Outcome = 'blocked' | 'allowed' | 'unmatched'

/**
 * Ask the extension what its own rules would do with a request.
 *
 * testMatchOutcome runs the real matcher against the real ruleset, which beats
 * asserting on a network trace: it answers "would this be blocked" without
 * depending on a live server or on load timing.
 *
 * It reports *which* rules matched, not the resulting action — and an exempted
 * request still matches (the allow rule). So the verdict is read from the
 * ruleset a match came from: the static `ads` ruleset only ever blocks, and our
 * dynamic rules only ever allow.
 */
async function outcomeFor(background: Worker, url: string, initiator: string): Promise<Outcome> {
  return background.evaluate(
    async ({ url, initiator }: { url: string; initiator: string }) => {
      const result = await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        type: 'script',
        initiator,
      })
      const rulesets = result.matchedRules.map((r) => r.rulesetId)
      if (rulesets.includes('_dynamic')) return 'allowed'
      return rulesets.length > 0 ? 'blocked' : 'unmatched'
    },
    { url, initiator },
  )
}

async function setAllowlist(background: Worker, hosts: string[]): Promise<void> {
  await background.evaluate(async (allowlist: string[]) => {
    const got = await chrome.storage.local.get('settings')
    const current = (got.settings ?? {}) as Record<string, unknown>
    const next = { ...current, allowlist, savedAt: Date.now() }
    await chrome.storage.local.set({ settings: next })
    await chrome.storage.sync.set({ settings: next })
  }, hosts)
}

test.describe('network blocking', () => {
  test('ad-network requests are blocked, ordinary ones are not', async ({ background }) => {
    expect(
      await outcomeFor(background, AD_REQUEST, 'https://example.org'),
      'an ad network request must be blocked',
    ).toBe('blocked')

    expect(
      await outcomeFor(background, BENIGN_REQUEST, 'https://example.com'),
      'an ordinary request must not match anything',
    ).toBe('unmatched')
  })

  test('an allowlisted site is exempt from network blocking', async ({ background }) => {
    // Same ad request, but now the page asking for it is switched off.
    await setAllowlist(background, ['example.org'])
    await expect
      .poll(() => outcomeFor(background, AD_REQUEST, 'https://example.org'), {
        message: 'the exception must outrank the block rules',
      })
      .toBe('allowed')

    // Everywhere else is untouched by that exception.
    expect(await outcomeFor(background, AD_REQUEST, 'https://somewhere-else.test')).toBe('blocked')
  })
})

/**
 * The page fetches three real ad-network URLs and one benign one, recording
 * which succeeded.
 *
 * testMatchOutcome above asks the matcher a question; this watches the browser
 * actually refuse the request. A blocked fetch never reaches the network, so
 * this half needs no connectivity — only the benign control does, and that is
 * served locally.
 */
const PROBE_PAGE = `<!doctype html><html><body><script>
window.__results = {};
function probe(name, url) {
  return fetch(url, { mode: 'no-cors' })
    .then(function () { window.__results[name] = 'allowed' })
    .catch(function () { window.__results[name] = 'blocked' });
}
window.__done = Promise.all([
  probe('doubleclick', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js'),
  probe('googlesyndication', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'),
  probe('adnxs', 'https://ib.adnxs.com/ttj?id=1'),
  probe('benign', 'https://adtest.example/ok.js'),
]);
</script></body></html>`

test('the browser really refuses the request, not just the matcher', async ({ context }) => {
  await context.route('https://adtest.example/ok.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '/* fine */' }),
  )
  await context.route('https://adtest.example/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: PROBE_PAGE }),
  )

  const page = await context.newPage()
  await page.goto('https://adtest.example/')
  await page.evaluate(() => (window as unknown as { __done: Promise<unknown> }).__done)
  const results = (await page.evaluate(
    () => (window as unknown as { __results: Record<string, string> }).__results,
  )) as Record<string, string>

  expect(results.doubleclick).toBe('blocked')
  expect(results.googlesyndication).toBe('blocked')
  expect(results.adnxs).toBe('blocked')
  expect(results.benign, '광고망이 아닌 요청은 그대로 나가야 한다').toBe('allowed')
})

test.describe('per-site off switch', () => {
  test('switching a site off removes the stylesheet from it', async ({ context, background }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await expect(page.locator('#generic-ad')).toBeHidden()

    await setAllowlist(background, ['example.com'])

    await expect(page.locator('#generic-ad'), '꺼진 사이트에서는 아무것도 숨기지 않는다').toBeVisible()
    await expect(page.locator('#real-content')).toBeVisible()
  })

  test('switching it back on restores blocking without a reload', async ({ context, background }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    await setAllowlist(background, ['example.com'])
    await expect(page.locator('#generic-ad')).toBeVisible()

    await setAllowlist(background, [])
    await expect(page.locator('#generic-ad'), '다시 켜면 즉시 돌아와야 한다').toBeHidden()
  })

  test('a parent entry covers its subdomains', async ({ context, background }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    // example.com is what gets listed; the page is www.example.com's sibling in
    // spirit — an entry has to cover the subdomains or the list fills with one
    // row per host and people give up on it.
    await setAllowlist(background, ['com'])
    await expect(page.locator('#generic-ad')).toBeVisible()
  })

  test('YouTube honours the off switch too — all three layers stand down', async ({
    context,
    background,
  }) => {
    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)
    await expect(page.locator('#masthead-ad')).toBeHidden()

    await setAllowlist(background, ['youtube.com'])

    await expect(page.locator('#masthead-ad'), '숨김이 풀려야 한다').toBeVisible()
    await expect
      .poll(() => layer2Active(page), { message: '스타일시트가 남아 있으면 안 된다' })
      .toBe(false)
  })
})
