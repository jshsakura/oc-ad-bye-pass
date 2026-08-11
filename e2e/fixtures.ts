// Loads the built dist/ into a real Chromium as an extension.
//
// Extensions only load in a persistent context. Headless has to be full
// Chromium's new headless mode (channel: 'chromium'), not headless-shell, or
// extensions do not work at all.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test'

const EXTENSION_PATH = path.resolve(import.meta.dirname, '..', 'dist')

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

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`build first: npm run build (${EXTENSION_PATH} is missing)`)
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        ...LAUNCH_ARGS,
      ],
    })
    await use(context)
    await context.close()
  },

  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await use(worker)
  },

  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host)
  },
})

export const expect = test.expect
