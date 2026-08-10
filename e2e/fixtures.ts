// 빌드된 dist/ 를 실제 Chromium 에 확장으로 물려서 띄운다.
//
// 확장은 persistent context 에서만 로드된다. headless 는 headless-shell 이 아니라
// 정식 Chromium(channel: 'chromium')의 새 headless 모드를 써야 확장이 동작한다.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test'

const EXTENSION_PATH = path.resolve(import.meta.dirname, '..', 'dist')

/**
 * 대조군도 같은 조건에서 돌려야 비교가 성립한다.
 * autoplay 정책을 풀어두는 이유: 3계층이 광고 영상을 실제로 재생/스킵하는지 보려면
 * 사용자 제스처 없이도 play() 가 먹어야 한다.
 */
export const LAUNCH_ARGS = ['--no-first-run', '--autoplay-policy=no-user-gesture-required']

export interface ExtensionFixtures {
  context: BrowserContext
  /** 서비스 워커 — chrome.storage 를 직접 조작하거나 통계를 읽을 때 쓴다 */
  background: Worker
  extensionId: string
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`먼저 빌드해야 한다: npm run build (${EXTENSION_PATH} 없음)`)
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
