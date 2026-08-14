// Loads the built dist/ into a real Chromium as an extension.
//
// Extensions only load in a persistent context. Headless has to be full
// Chromium's new headless mode (channel: 'chromium'), not headless-shell, or
// extensions do not work at all.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test'

const DIST = path.resolve(import.meta.dirname, '..', 'dist')
const DIST_ORION = path.resolve(import.meta.dirname, '..', 'dist-orion')

/**
 * The control group has to run under identical conditions for the comparison to
 * mean anything. Autoplay policy is relaxed because checking that layer 3 really
 * plays and skips an ad requires play() to work without a user gesture.
 */
export const LAUNCH_ARGS = ['--no-first-run', '--autoplay-policy=no-user-gesture-required']

export interface ExtensionFixtures {
  context: BrowserContext
  /** The service worker — used to poke chrome.storage directly or read stats. */
  background: Worker
  extensionId: string
}

// One fixture, parameterised by which build to load. Chromium is the only engine
// Playwright loads an extension into, but the Orion *package* still runs there —
// its content scripts are the same file, only the manifest differs — so a feature
// that ships only in the Orion build (the PiP button) is tested against it.
function extensionTest(extensionPath: string) {
  return base.extend<ExtensionFixtures>({
    context: async ({}, use) => {
      if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
        throw new Error(`build first: npm run build:all (${extensionPath} is missing)`)
      }
      const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Pin the UI language. The extension seeds its language from the browser
      // locale on install (detectLang), and the specs select popup controls by
      // their Korean labels ('진단', …). Without this the suite would render in
      // whatever locale the host machine runs, and those selectors would miss.
      locale: 'ko-KR',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...LAUNCH_ARGS,
      ],
    })
    // **No test may reach the network.**
    //
    // The extension force-fetches its filter list on install — onInstalled calls
    // updateFilters(true) — and that happens once per test, because each test
    // gets its own freshly installed extension. Unrouted, the request goes to
    // the live raw.githubusercontent.com. Two things follow, and both were
    // observed: the suite starts depending on GitHub being reachable, and the
    // response (whatever list is on main today) drops into the cache at an
    // arbitrary moment, changing what is hidden in the middle of an assertion.
    //
    // It cost two days' worth of confusing red CI on 06 before it was traced.
    // Routing it here covers every spec, including the ones that never mention
    // the list and would fail in a way pointing nowhere near it.
    //
    // The served list is valid and empty: rules merge as a union, so bundled
    // behaviour is untouched by it.
    for (const pattern of [
      'https://raw.githubusercontent.com/**',
      'https://gist.githubusercontent.com/**',
    ]) {
      await context.route(pattern, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            name: 'e2e install-time list',
            version: 1,
            updatedAt: '2026-08-10',
            rules: { hide: { generalAds: [] }, prune: [], click: [], allow: [] },
          }),
        }),
      )
    }

    await use(context)
    await context.close()
  },

  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

    /*
     * Wait for the install to finish, not merely for the worker to exist.
     *
     * onInstalled seeds the default settings asynchronously and the worker is live
     * well before that write lands. Every spec that pokes chrome.storage reads
     * `settings` and patches it, so arriving early does not fail where the mistake
     * is — it throws "Cannot read properties of undefined" from inside a helper, on
     * a different test each run, on CI and not on a developer's machine.
     */
    await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const got = await chrome.storage.local.get('settings')
        if (got.settings) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('기본 설정이 저장되지 않았습니다 — 설치가 끝나지 않았습니다')
    })

    await use(worker)
  },

    extensionId: async ({ background }, use) => {
      await use(new URL(background.url()).host)
    },
  })
}

/** The Chrome/Edge package (dist). The default for almost every spec. */
export const test = extensionTest(DIST)
export const expect = test.expect

/** The Orion package (dist-orion) — for features that ship only there. */
export const orionTest = extensionTest(DIST_ORION)
export const orionExpect = orionTest.expect
