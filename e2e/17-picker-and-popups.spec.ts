// The element picker, and the pop-up guard.
//
// Both act away from the video site, which is new ground for this suite: until
// now everything off YouTube was one stylesheet and nothing else. Each is
// tested for the thing that would actually hurt — the picker writing a rule
// that does not survive a rebuild, and the guard eating a window somebody asked
// for.

import { expect, test } from './fixtures.ts'
import { OTHER_SITE_URL, installOtherSiteFixture } from './youtube-fixture.ts'
import type { BrowserContext, Page, Worker } from '@playwright/test'

async function worker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
}

/** Settings are read from the extension context, which the page cannot reach. */
async function customRules(context: BrowserContext): Promise<string[]> {
  const background = await worker(context)
  return background.evaluate(async () => {
    const got = await chrome.storage.local.get('settings')
    const settings = got.settings as { customRules?: string } | undefined
    return (settings?.customRules ?? '').split('\n').filter(Boolean)
  })
}

async function patchSettings(context: BrowserContext, patch: Record<string, unknown>): Promise<void> {
  const background = await worker(context)
  await background.evaluate(async (value) => {
    const got = await chrome.storage.local.get('settings')
    const next = { ...(got.settings ?? {}), ...value, savedAt: Date.now() }
    await chrome.storage.local.set({ settings: next })
    await chrome.storage.sync.set({ settings: next })
  }, patch)
}

/** Start the picker the way the popup does — by writing the request key. */
async function startPicker(context: BrowserContext, page: Page): Promise<void> {
  const background = await worker(context)
  await background.evaluate(
    async (target) => chrome.storage.local.set({ pickerRequest: { url: target, at: Date.now() } }),
    page.url(),
  )
}

const PICKER = '#oc-ad-bye-pass-picker'

test.describe('요소 선택기', () => {
  test('고른 것이 규칙이 되고, 그 규칙이 실제로 숨긴다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await expect(page.locator('#generic-ad')).toBeHidden() // 이미 리스트가 잡는 것
    await expect(page.locator('#real-content')).toBeVisible()

    await startPicker(context, page)
    await expect.poll(() => page.locator(PICKER).count()).toBe(1)

    // The overlay must not be reachable from the page. A picker the page can
    // reach into is a picker an anti-adblock script can dismantle.
    expect(
      await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).shadowRoot === null, PICKER),
      '섀도우 루트가 페이지에 노출되면 안 된다',
    ).toBe(true)

    const box = (await page.locator('#real-content').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.keyboard.press('Enter')

    await expect.poll(() => customRules(context)).toEqual(['#real-content'])
    // The picker closes itself once the rule is in.
    await expect.poll(() => page.locator(PICKER).count()).toBe(0)
    // And the rule it wrote does the thing it was written for.
    await expect(page.locator('#real-content')).toBeHidden()
  })

  test('Esc 는 아무것도 남기지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    await startPicker(context, page)
    await expect.poll(() => page.locator(PICKER).count()).toBe(1)
    await page.keyboard.press('Escape')

    await expect.poll(() => page.locator(PICKER).count()).toBe(0)
    expect(await customRules(context)).toEqual([])
    await expect(page.locator('#real-content')).toBeVisible()
  })

  test('선택기가 떠 있는 동안 페이지는 클릭을 못 받는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await page.evaluate(() => {
      ;(window as unknown as { __clicks: number }).__clicks = 0
      document.addEventListener('click', () => {
        ;(window as unknown as { __clicks: number }).__clicks++
      })
    })

    await startPicker(context, page)
    await expect.poll(() => page.locator(PICKER).count()).toBe(1)

    const box = (await page.locator('#real-content').boundingBox())!
    await page.mouse.click(box.x + 5, box.y + 5)

    // One stray click on a link and the page navigates, taking the picker and
    // the reader's place on the page with it.
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0)
    await page.keyboard.press('Escape')
  })
})

test.describe('팝업 차단', () => {
  /** Open a window from a real press on the given element. */
  async function openFrom(page: Page, selector: string): Promise<boolean> {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)!
      ;(window as unknown as { __opened: unknown }).__opened = 'pending'
      el.addEventListener(
        'click',
        () => {
          ;(window as unknown as { __opened: unknown }).__opened = window.open(
            'https://example.com/opened',
            '_blank',
          )
        },
        { once: true },
      )
    }, selector)
    await page.click(selector)
    return page.evaluate(() => (window as unknown as { __opened: unknown }).__opened !== null)
  }

  test('아무것도 누르지 않은 창은 막는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)

    // From a page script on a timer: no press of any kind precedes it.
    const opened = await page.evaluate(async () => {
      const script = document.createElement('script')
      script.textContent =
        'setTimeout(() => { window.__timerOpened = window.open("https://example.com/popunder") }, 50)'
      document.documentElement.appendChild(script)
      await new Promise((r) => setTimeout(r, 300))
      return (window as unknown as { __timerOpened: unknown }).__timerOpened !== null
    })
    expect(opened, '제스처 없는 window.open 은 막혀야 한다').toBe(false)
  })

  test('누를 수 있는 것을 눌렀으면 연다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await page.evaluate(() => {
      const button = document.createElement('button')
      button.id = 'opener'
      button.textContent = 'open'
      button.style.cssText = 'position:fixed;top:0;left:0;width:120px;height:40px;z-index:9'
      document.body.appendChild(button)
    })

    // The failure this guards against would cost people their bank logins.
    expect(await openFrom(page, '#opener'), '버튼에서 연 창은 통과해야 한다').toBe(true)
  })

  test('본문 아무데나 누른 것을 창으로 바꾸는 건 막는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await page.evaluate(() => {
      const plain = document.createElement('div')
      plain.id = 'plain'
      plain.textContent = 'just text'
      plain.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:9'
      document.body.appendChild(plain)
    })

    // This is the pop-under browsers do not catch: a real click, on nothing
    // that opens anything.
    expect(await openFrom(page, '#plain'), '누를 수 없는 것에서 연 창은 막아야 한다').toBe(false)
  })

  test('토글을 끄면 막지 않는다', async ({ context }) => {
    await installOtherSiteFixture(context)
    const page = await context.newPage()
    await page.goto(OTHER_SITE_URL)
    await patchSettings(context, { toggles: { popups: false } })

    await page.evaluate(() => {
      const plain = document.createElement('div')
      plain.id = 'plain'
      plain.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:60px;z-index:9'
      document.body.appendChild(plain)
    })

    // The setting travels ISOLATED -> MAIN by postMessage, so let it land.
    await expect.poll(() => openFrom(page, '#plain')).toBe(true)
  })
})
