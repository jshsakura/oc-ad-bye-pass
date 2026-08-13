// The techniques, checked in WebKit.
//
// Everything else in this directory runs in Chromium, because that is the only
// engine that loads an extension. But the target is an iPhone, and an iPhone is
// WebKit — Orion, Safari, all of it. Chromium agreeing proves the code is
// correct on the engine nobody installs this on.
//
// WebKit cannot load the extension, so what runs here is the mechanism rather
// than the product: the exact overrides src/main/backgroundPlay.ts performs and
// the visibility techniques src/main/backgroundPlay.ts relies on, executed against a real
// WebKit. If one of them cannot work there, the feature cannot work there, and
// that is worth knowing without a phone in hand.

import { createServer } from 'node:http'
import { readFile } from 'node:fs'
import { join } from 'node:path'
import { expect, test as base, webkit } from '@playwright/test'
import { buildStylesheet, resolveRules } from '../src/shared/filterlist.ts'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'

const test = base.extend<{ wk: import('@playwright/test').Page }>({
  wk: async ({}, use) => {
    const browser = await webkit.launch()
    const page = await browser.newPage()
    await page.goto('about:blank')
    await use(page)
    await browser.close()
  },
})

test('WebKit 에서 document.hidden 을 가려낼 수 있다', async ({ wk }) => {
  // src/main/backgroundPlay.ts 의 install() 과 같은 순서로 한다.
  const result = await wk.evaluate(() => {
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    if (!hidden?.get || !visibility?.get) return { supported: false }

    const state = { on: true }
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => (state.on ? false : hidden.get?.call(document)),
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (state.on ? 'visible' : visibility.get?.call(document)),
    })

    const spoofed = { hidden: document.hidden, state: document.visibilityState }
    state.on = false
    const restored = { hidden: document.hidden, state: document.visibilityState }
    return { supported: true, spoofed, restored }
  })

  // 프로토타입에 접근자가 있어야 가려낼 수 있다. 없으면 이 기능은 WebKit 에서 불가능하다.
  expect(result.supported, 'Document.prototype 에 접근자가 없다 — 방식 자체를 바꿔야 한다').toBe(true)
  expect(result.spoofed).toEqual({ hidden: false, state: 'visible' })
  // 끄면 원래 값으로 돌아온다 — 원본 게터를 호출하고 있다는 뜻이다.
  expect(result.restored?.state).toBe('visible')
})

test('WebKit 에서 visibilitychange 를 캡처 단계에서 삼킬 수 있다', async ({ wk }) => {
  const reached = await wk.evaluate(() => {
    let sawIt = false
    const swallow = (e: Event) => e.stopImmediatePropagation()
    window.addEventListener('visibilitychange', swallow, true)
    document.addEventListener('visibilitychange', swallow, true)
    document.addEventListener('visibilitychange', () => {
      sawIt = true
    })
    document.dispatchEvent(new Event('visibilitychange'))
    return sawIt
  })
  expect(reached, '페이지의 핸들러까지 이벤트가 도달했다 — 재생이 그대로 멈춘다').toBe(false)
})

test('사이트가 WebKit 에서 오류 없이 뜨고, 브라우저 언어를 따른다', async () => {
  // file:// 로 열면 WebKit 이 build.json 페치를 CORS 로 막는다. 배포된 사이트는
  // https 라 그런 일이 없으니, 그 조건을 흉내내지 않고 실제로 http 로 띄운다.
  const root = join(process.cwd(), 'site')
  const server = createServer((req, res) => {
    const rel = (req.url ?? '/').split('?')[0]

    // build.json is written by .github/workflows/pages.yml at deploy time, so it
    // is not in the repository. The deploy is what this test is standing in for,
    // and a footer that silently stays empty is one of the things it should
    // catch — so serve what the workflow serves.
    // The deploy copies the rule list in beside the page (pages.yml), and the
    // page links to it. Serving only site/ makes that link 404, which shows up
    // as a console error the test then blames on the page.
    if (rel === '/filters/video.json') {
      readFile(join(process.cwd(), 'filters', 'video.json'), (err, body) => {
        if (err) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(body)
      })
      return
    }

    if (rel === '/build.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version: '0.0.0-test', filterVersion: 1, builtAt: '2026-08-11' }))
      return
    }

    const file = join(root, rel === '/' ? 'index.html' : rel)
    readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end()
        return
      }
      const type = file.endsWith('.json')
        ? 'application/json'
        : file.endsWith('.png')
          ? 'image/png'
          : file.endsWith('.woff2')
            ? 'font/woff2'
            : 'text/html; charset=utf-8'
      res.writeHead(200, { 'content-type': type }).end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }

  const browser = await webkit.launch()
  try {
    // 한국어 브라우저는 한국어, 그 밖은 영어. 그 판정이 이 엔진에서도 서는지 본다.
    for (const [locale, expected] of [
      ['ko-KR', 'ko'],
      ['en-US', 'en'],
    ] as const) {
      const context = await browser.newContext({ locale })
      const page = await context.newPage()
      const errors: string[] = []
      // Anything the page itself gets wrong counts. What does not is the call to
      // api.github.com for the version — GitHub rate-limits by IP and a CI runner
      // shares its address with the world, so a 403 there says nothing about this
      // page, and while every release is a prerelease `releases/latest` is a 404
      // by design. The page already treats that call as optional; the test has to
      // as well, or the release breaks on somebody else's quota or on our own
      // decision not to publish yet.
      //
      // Matched on the request URL as well as the text: a failed subresource is
      // reported as a bare "Failed to load resource: ... 404" with the address
      // only in the message's location, so filtering on the text alone lets it
      // through.
      const ours = (text: string, url = '') =>
        !text.includes('api.github.com') && !url.includes('api.github.com')
      page.on('pageerror', (e) => {
        if (ours(String(e))) errors.push(String(e))
      })
      page.on('console', (m) => {
        if (m.type() === 'error' && ours(m.text(), m.location()?.url ?? '')) errors.push(m.text())
      })

      await page.goto(`http://127.0.0.1:${port}/`)
      // Waited for rather than slept through. 900ms was enough on this desk and
      // not on a CI runner, where it failed the release rather than the page.
      await page.waitForFunction(() => !!document.documentElement.dataset.lang, null, {
        timeout: 15_000,
      })
      await page.waitForFunction(() => (document.getElementById('build')?.textContent ?? '') !== '', null, {
        timeout: 15_000,
      })

      const seen = await page.evaluate(() => {
        const shown = (el: Element) => el.getClientRects().length > 0
        return {
          lang: document.documentElement.dataset.lang,
          ko: [...document.querySelectorAll('[lang="ko"]')].filter(shown).length,
          en: [...document.querySelectorAll('[lang="en"]')].filter(shown).length,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          marks: document.querySelectorAll('.mark svg path').length,
          footer: document.getElementById('build')?.textContent?.trim() ?? '',
        }
      })

      expect(errors, `${locale}: ${errors.join('\n')}`).toEqual([])
      expect(seen.lang, `${locale} 인데 ${seen.lang} 로 떴다`).toBe(expected)
      // CSS 로 한쪽만 보이게 하는 방식이 WebKit 에서도 서야 한다. 안 서면 두 언어가
      // 나란히 나온다 — 크로미움에서는 절대 보이지 않을 실패다.
      const [visible, hidden] = expected === 'ko' ? [seen.ko, seen.en] : [seen.en, seen.ko]
      expect(visible, '고른 언어가 보이지 않는다').toBeGreaterThan(0)
      expect(hidden, '두 언어가 동시에 보인다').toBe(0)

      expect(seen.overflow, '가로 스크롤이 생겼다').toBe(false)
      expect(seen.marks, '아이콘이 그려지지 않았다').toBeGreaterThan(0)
      expect(seen.footer, '푸터가 비어 있다 — build.json 을 못 읽었다').not.toBe('')

      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})

test('2계층 스타일시트가 WebKit 에서 실제로 광고를 숨긴다', async ({ wk }) => {
  // Orion 에는 네트워크 차단이 없다. 그래서 유튜브 밖에서 광고를 가리는 일은
  // 전부 이 스타일시트 한 장에 달려 있고, 그 셀렉터들은 :has() 같은 최신 문법을
  // 쓴다 — 크로미움이 이해한다고 WebKit 이 이해한다는 보장이 없다. 하나라도
  // 버려지면 그 규칙만 조용히 죽는다.
  const css = buildStylesheet(resolveRules(null, []), DEFAULT_SETTINGS.toggles, 'youtube')
  expect(css, '스타일시트가 비어 있다').not.toBe('')

  const result = await wk.evaluate((sheet) => {
    document.body.innerHTML = `
      <ytd-display-ad-renderer id="ad-card">광고</ytd-display-ad-renderer>
      <ytd-rich-item-renderer id="normal-card">평범한 영상</ytd-rich-item-renderer>
      <div id="masthead-ad">배너</div>
      <ytd-reel-video-renderer id="shorts-ad"><ytd-ad-slot-renderer></ytd-ad-slot-renderer></ytd-reel-video-renderer>
      <ytd-reel-video-renderer id="shorts-normal"><span>쇼츠</span></ytd-reel-video-renderer>`

    const style = document.createElement('style')
    style.textContent = sheet
    document.head.appendChild(style)

    // 브라우저가 버린 규칙은 cssRules 에 들어오지 않는다. 몇 개나 살아남았는지
    // 세어 두면, 문법을 못 알아들어 통째로 사라지는 경우를 잡을 수 있다.
    const total = sheet.split('\n').length
    const parsed = (style.sheet as CSSStyleSheet).cssRules.length

    const hidden = (id: string) => getComputedStyle(document.getElementById(id)!).display === 'none'
    return {
      total,
      parsed,
      adCard: hidden('ad-card'),
      masthead: hidden('masthead-ad'),
      shortsAd: hidden('shorts-ad'),
      normalCard: hidden('normal-card'),
      shortsNormal: hidden('shorts-normal'),
    }
  }, css)

  // 문법을 못 알아들어 버려진 규칙이 있는지 — 몇 개가 사라졌는지 그대로 드러난다.
  expect(result.parsed, `규칙 ${result.total}개 중 ${result.parsed}개만 남았다`).toBe(result.total)

  expect(result.adCard, '광고 카드가 그대로 보인다').toBe(true)
  expect(result.masthead, '상단 배너가 그대로 보인다').toBe(true)
  // :has() 짜리 — WebKit 16.4 부터다. 여기서 깨지면 Shorts 광고가 샌다.
  expect(result.shortsAd, ':has() 규칙이 먹지 않았다 — Shorts 광고가 샌다').toBe(true)

  // 그리고 멀쩡한 것을 지우지 않아야 한다. 피드가 통째로 사라지는 실패가 여기다.
  expect(result.normalCard, '평범한 카드까지 숨겼다').toBe(false)
  expect(result.shortsNormal, '광고 없는 Shorts 까지 숨겼다').toBe(false)
})
