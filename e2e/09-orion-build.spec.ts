// The dormant fallback package — not shipped since v0.13.0, when the full
// package proved to install on Orion (one-time compatibility warning) and
// became the single artifact. dist-orion/ is the same code with
// declarativeNetRequest and two Chrome-only manifest keys stripped out, kept
// buildable in case an Orion version hard-refuses the full manifest again.
// This spec runs only when someone builds it: npm run build:orion.
//
// That strip is exactly the kind of change that looks fine and ships a corpse.
// Removing the API does not remove the calls to it, and a service worker that
// throws on startup leaves an extension which installs, shows its icon, and
// blocks nothing. So this loads the real orion output in a real browser and
// checks the layers are alive without it.
//
// Chromium is not Orion. What it proves is that the build survives the absence
// of declarativeNetRequest — which is the part we control.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { LAUNCH_ARGS, expect, test } from './fixtures.ts'
import { layer1Active, layer2Active } from './probes.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

const ORION_DIST = path.resolve(import.meta.dirname, '..', 'dist-orion')

test.skip(
  !existsSync(path.join(ORION_DIST, 'manifest.json')),
  'dist-orion 이 없다: npm run build:orion',
)

test('Orion 패키지에는 declarativeNetRequest 가 없다', () => {
  const manifest = JSON.parse(readFileSync(path.join(ORION_DIST, 'manifest.json'), 'utf8')) as {
    permissions: string[]
    content_scripts: { world?: string }[]
    web_accessible_resources?: { resources: string[] }[]
    declarative_net_request?: unknown
    minimum_chrome_version?: string
    optional_host_permissions?: string[]
  }

  // The three things Orion is not known to accept.
  expect(manifest.declarative_net_request).toBeUndefined()
  expect(manifest.permissions).not.toContain('declarativeNetRequest')
  expect(manifest.minimum_chrome_version).toBeUndefined()
  expect(manifest.optional_host_permissions).toBeUndefined()

  // The ruleset is 3.6MB and nothing reads it without the key above.
  expect(existsSync(path.join(ORION_DIST, 'rules')), 'rules/ 가 따라왔다').toBe(false)

  // And everything layer 1 needs to reach the page is still declared.
  expect(manifest.content_scripts.some((cs) => cs.world === 'MAIN')).toBe(true)
  expect(manifest.permissions).toContain('scripting')
  expect(manifest.web_accessible_resources?.flatMap((r) => r.resources)).toContain('main.js')
})

test('declarativeNetRequest 없이도 유튜브 차단이 산다', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${ORION_DIST}`,
      `--load-extension=${ORION_DIST}`,
      ...LAUNCH_ARGS,
    ],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

    // A worker that died on startup is the failure this whole spec is here for.
    const alive = await worker.evaluate(() => ({
      version: chrome.runtime.getManifest().version,
      dnr: typeof chrome.declarativeNetRequest,
    }))
    expect(alive.dnr, 'Chromium 에서는 API 가 존재한다 — 매니페스트에 없을 뿐이다').toBeDefined()

    await installYouTubeFixture(context)
    const page = await context.newPage()
    await page.goto(YOUTUBE_URL)

    await expect.poll(() => layer1Active(page), { message: '1계층' }).toBe(true)
    await expect.poll(() => layer2Active(page), { message: '2계층' }).toBe(true)
    await expect(page.locator('#masthead-ad')).toBeHidden()
  } finally {
    await context.close()
  }
})
