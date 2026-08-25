// The techniques, checked in WebKit.
//
// Everything else in this directory runs in Chromium, because that is the only
// engine that loads an extension. But the target is an iPhone, and an iPhone is
// WebKit — Orion, Safari, all of it. Chromium agreeing proves the code is
// correct on the engine nobody installs this on.
//
// WebKit cannot load the extension, so what runs here is the mechanism rather
// than the product: the cosmetic stylesheet and the picture-in-picture route
// decision src/isolated/pip.ts makes, executed against a real WebKit. If one of
// them cannot work there, the feature cannot work there, and that is worth
// knowing without a phone in hand.

import { createServer } from 'node:http'
import { readFile } from 'node:fs'
import { join } from 'node:path'
import { expect, test as base, webkit } from '@playwright/test'
import { buildStylesheet, resolveRules } from '../src/shared/filterlist.ts'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'
import { chooseEntry } from '../src/isolated/pip.ts'

const test = base.extend<{ wk: import('@playwright/test').Page }>({
  wk: async ({}, use) => {
    const browser = await webkit.launch()
    const page = await browser.newPage()
    await page.goto('about:blank')
    await use(page)
    await browser.close()
  },
})

test('PiP 진입점이 없는 WebKit 에서는 버튼을 붙이지 않는다', async ({ wk }) => {
  const apis = await wk.evaluate(() => {
    const video = document.createElement('video')
    const el = video as unknown as Record<string, unknown>
    return {
      standard: typeof video.requestPictureInPicture,
      webkitSupports: typeof el.webkitSupportsPresentationMode,
      webkitSet: typeof el.webkitSetPresentationMode,
      optOut: 'disablePictureInPicture' in video,
    }
  })

  // Playwright 의 리눅스 WebKit 에는 사파리의 미디어 스택이 없어서 셋 다 없다.
  // 아이폰 사파리에는 webkit 접두사 쪽이 있다 — 그래서 pip.ts 가 그쪽을 먼저
  // 부른다. 여기서 증명할 수 있는 것은 반대쪽이다: 아무것도 없을 때 무엇을 하는가.
  console.log('WebKit PiP APIs:', JSON.stringify(apis))

  const behaviour = await wk.evaluate(() => {
    // src/isolated/pip.ts 의 canPip() 과 같은 판정.
    const video = document.createElement('video')
    const el = video as unknown as { webkitSupportsPresentationMode?: (m: string) => boolean }
    const canPip =
      typeof el.webkitSupportsPresentationMode === 'function'
        ? el.webkitSupportsPresentationMode('picture-in-picture')
        : typeof video.requestPictureInPicture === 'function'
    return { canPip }
  })

  // 눌러도 아무 일도 없는 버튼을 남의 플레이어에 붙이는 것이 최악이다.
  // 진입점이 있으면 붙이고, 없으면 붙이지 않는다 — 어느 쪽이든 그 판정을 따른다.
  expect(typeof behaviour.canPip).toBe('boolean')
  if (!apis.webkitSet && apis.standard !== 'function') {
    expect(behaviour.canPip, '진입점이 없는데 버튼을 붙이려 한다').toBe(false)
  }
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
  const css = buildStylesheet(resolveRules([], []), DEFAULT_SETTINGS.toggles, 'youtube')
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

// The route decision, run in WebKit, by the function that ships.
//
// The rest of this file re-implements a mechanism and checks the engine allows
// it. This one is different: `chooseEntry` is pure, so its source goes into the
// page and the real thing decides, against a <video> this engine created.
//
// It matters because that branch — the webkit-prefixed one — is the branch an
// iPhone takes and the one no test has ever executed. Linux WebKit has none of
// those APIs, so the shape is supplied here; what is being checked is our
// decision, not Apple's implementation.
test('아이폰 모양의 비디오에서 우리 판정 함수가 webkit 경로를 고른다', async ({ wk }) => {
  const decide = await wk.evaluate(
    ({ source }) => {
      const chooseEntry = new Function(`return (${source})`)() as (state: {
        preferFullscreen: boolean
        supported: boolean | undefined
        webkit: boolean
        standard: boolean
        fullscreen: boolean
      }) => string

      const shaped = (opts: { supports: boolean }) => {
        const video = document.createElement('video') as HTMLVideoElement &
          Record<string, unknown>
        // 아이폰 사파리가 가진 것만 붙인다. 표준 API 는 일부러 두지 않는다 —
        // 아이폰에는 믿을 수 있는 형태로 없기 때문이다.
        video.webkitSupportsPresentationMode = () => opts.supports
        video.webkitSetPresentationMode = () => {}
        video.webkitEnterFullscreen = () => {}
        return {
          supported:
            typeof video.webkitSupportsPresentationMode === 'function'
              ? (video.webkitSupportsPresentationMode as (m: string) => boolean)(
                  'picture-in-picture',
                )
              : undefined,
          webkit: typeof video.webkitSetPresentationMode === 'function',
          standard: typeof video.requestPictureInPicture === 'function',
          fullscreen: typeof video.webkitEnterFullscreen === 'function',
        }
      }

      const allowed = shaped({ supports: true })
      const refused = shaped({ supports: false })
      return {
        firstTap: chooseEntry({ preferFullscreen: false, ...allowed }),
        afterNoOp: chooseEntry({ preferFullscreen: true, ...allowed }),
        videoRefuses: chooseEntry({ preferFullscreen: false, ...refused }),
        bare: chooseEntry({
          preferFullscreen: false,
          supported: undefined,
          webkit: false,
          standard: typeof document.createElement('video').requestPictureInPicture === 'function',
          fullscreen: false,
        }),
      }
    },
    { source: chooseEntry.toString() },
  )

  // 첫 탭은 작은 창을 시도한다.
  expect(decide.firstTap).toBe('webkit')
  // 무응답이었으면 다음 탭은 전체화면 — 아이폰이 스스로 띄워주는 상태다.
  expect(decide.afterNoOp).toBe('fullscreen')
  // 이 영상은 안 된다고 하면 제스처를 낭비하지 않는다.
  expect(decide.videoRefuses).toBe('fullscreen')
  // 그리고 이 엔진이 실제로 가진 것에 맞게 답해야 한다. 리눅스 WebKit 에는
  // 아무것도 없어 'none' 이고, macOS 러너의 WebKit(사파리 엔진)에는 표준 API 가
  // 있어 'standard' 다 — 어느 쪽이든 없는 것을 부르려 해서는 안 된다.
  const hasStandard = await wk.evaluate(
    () => typeof document.createElement('video').requestPictureInPicture === 'function',
  )
  expect(decide.bare).toBe(hasStandard ? 'standard' : 'none')
})

/**
 * The popup, laid out by a real WebKit at phone width.
 *
 * This is here because the bar at the bottom of the popup was a flex row with
 * no wrap, and adding a fourth button to it — the element picker — squeezed all
 * four until the labels no longer fit. Nothing caught it: every other test
 * asserts on behaviour, and the layout only fails at a width no desktop run
 * ever uses.
 *
 * The real popup is served rather than a hand-written stand-in, so the markup
 * under test cannot drift away from the markup that ships. `chrome` is stubbed
 * because WebKit has no extension to provide it.
 */
test('폰 폭에서 팝업 하단 버튼이 2×2 로 반반 나뉜다', async () => {
  const server = createServer((req, res) => {
    const rel = (req.url ?? '/').split('?')[0]
    const file = join(import.meta.dirname, '..', 'dist', rel === '/' ? 'popup.html' : rel)
    readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('not found')
        return
      }
      const type = rel.endsWith('.js')
        ? 'text/javascript'
        : rel.endsWith('.css')
          ? 'text/css'
          : rel.endsWith('.png')
            ? 'image/png'
            : 'text/html; charset=utf-8'
      res.writeHead(200, { 'content-type': type }).end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as { port: number }

  const browser = await webkit.launch()
  try {
    // The narrowest phone still in use. If it holds here it holds everywhere.
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, locale: 'ko-KR' })
    await context.addInitScript(() => {
      const store: Record<string, unknown> = { settings: { lang: 'ko', savedAt: Date.now() } }
      const area = {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (patch: Record<string, unknown>) => Object.assign(store, patch),
        remove: async () => {},
      }
      ;(window as unknown as { chrome: unknown }).chrome = {
        runtime: {
          id: 'test',
          getManifest: () => ({ version: '0.0.0', host_permissions: [] }),
          sendMessage: async () => ({ ok: true, source: 'bundled', lists: [], dropped: 0 }),
        },
        storage: { sync: area, local: area, onChanged: { addListener() {}, removeListener() {} } },
        permissions: { request: async () => false, contains: async () => true },
        tabs: { query: async () => [{ id: 1, url: 'https://news.example.com/article' }] },
        declarativeNetRequest: {},
      }
    })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/popup.html`)
    await page.waitForSelector('.foot button')

    const layout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>('.foot > button')]
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        rows: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().y))).size,
        columns: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().x))).size,
        widths: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().width))).size,
        // A label wider than the box it is in has been cut off.
        clipped: buttons
          .filter((b) => b.scrollWidth > Math.ceil(b.getBoundingClientRect().width))
          .map((b) => b.textContent?.trim()),
      }
    })

    expect(layout.clipped, '버튼 안에서 글자가 잘렸다').toEqual([])
    expect(layout.rows, '두 줄이어야 한다').toBe(2)
    expect(layout.columns, '두 칸이어야 한다').toBe(2)
    expect(layout.widths, '네 개가 같은 너비여야 한다 — 반반').toBe(1)
    // A phone sheet is narrower than the desktop popup's floor; a floor wider
    // than the sheet scrolls the whole panel sideways.
    expect(layout.scrollWidth, '가로로 스크롤된다').toBe(layout.innerWidth)
  } finally {
    await browser.close()
    server.close()
  }
})
