// Bakes the link-preview card into site/og.png.
//
//   node scripts/build-og.mjs
//
// Why a script and not a one-off: og.png is the first thing anyone sees of this
// project — it shows before the page does — and it repeats copy that lives in
// site/index.html. Committing a binary nobody can regenerate means the card
// silently drifts from the site the moment a word changes.
//
// The layout is HTML rendered by Chromium rather than a drawing, so it uses the
// site's own palette tokens and the site's own font file. An approximation of
// the palette would be worse than none.
//
// **The background plate (assets/og-bg.png) is optional.** When it is there it is
// used as-is; when it is not, the CRT texture is drawn in CSS. Either way the
// type is laid out here, never generated — an image model cannot be trusted with
// Hangul, and a card is mostly type.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = dirname(import.meta.dirname)
const SITE = join(ROOT, 'site')
// Build input, not published — it is 1MB and nothing on the page loads it.
const BG = join(ROOT, 'assets', 'og-bg.png')

// Inlined as a data URI on purpose. Loaded over file:// the font is blocked by
// Chromium's origin rules, and the failure is close to invisible — the card
// renders in the fallback face and still looks almost right.
const font = readFileSync(join(SITE, 'fonts', 'zen-tokyo-zoo-latin.woff2')).toString('base64')
const bg = existsSync(BG) ? readFileSync(BG).toString('base64') : null

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  :root {
    --crust: #11111b; --mantle: #181825; --surface1: #45475a;
    --text: #cdd6f4; --subtext0: #a6adc8; --overlay0: #6c7086;
    --mauve: #7e4dc5; --mauve-ink: #b18aee; --peach-ink: #fab387; --teal-ink: #94e2d5;
    --dot: rgba(157, 110, 224, 0.20);
    --scanline: rgba(0, 0, 0, 0.13);
  }
  @font-face {
    font-family: 'Zen Tokyo Zoo';
    src: url(data:font/woff2;base64,${font}) format('woff2');
    font-display: block;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: 'Noto Sans KR', 'Noto Sans CJK KR', system-ui, sans-serif;
    color: var(--text);
    background-color: var(--crust);
    ${bg
      ? `background-image: url(data:image/png;base64,${bg});
         background-size: 1200px 630px;`
      : `background-image:
           radial-gradient(circle at 1px 1px, var(--dot) 2.2px, transparent 0),
           repeating-linear-gradient(0deg, var(--scanline) 0 2px, transparent 2px 6px);
         background-size: 34px 34px, auto;`}
    display: flex; align-items: center;
  }
  /* Safe margin. Some clients crop the card's edges. */
  .card { position: relative; padding: 0 84px; width: 100%; }

  .top { display: flex; align-items: center; gap: 30px; margin-bottom: 40px; }
  .mark {
    width: 116px; height: 116px; border-radius: 26px; flex: none;
    overflow: hidden; display: grid; place-items: center;
    box-shadow: 0 18px 50px -18px rgba(126, 77, 197, 0.9);
  }
  .mark svg { width: 100%; height: 100%; display: block; }

  h1 { font-family: 'Zen Tokyo Zoo', monospace; font-size: 76px; line-height: 1; letter-spacing: 0.02em; }
  h1 .a { color: var(--peach-ink); }
  h1 .b { color: var(--mauve-ink); }

  .lede { font-size: 33px; font-weight: 700; line-height: 1.5; }
  .lede b { color: var(--teal-ink); }
  .sub { margin-top: 14px; font-size: 23px; font-weight: 400; color: var(--subtext0); }

  .chips { display: flex; gap: 12px; margin-top: 40px; }
  .chip {
    font-size: 21px; font-weight: 600;
    padding: 12px 22px; border-radius: 999px;
    background: rgba(24, 24, 37, 0.72); border: 1px solid var(--surface1); color: var(--subtext0);
  }
  .chip.on { border-color: var(--mauve); color: var(--mauve-ink); }

  .url { position: absolute; left: 84px; bottom: 56px; font-size: 22px; color: var(--overlay0); }
</style></head><body>
  <div class="card">
    <div class="top">
      <div class="mark">
        <svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7e4dc5"/><g transform="translate(32 32) scale(0.9) translate(-32 -32)"><path fill="#181825" d="M13.44 13.44a3.52 3.52 0 0 1 3.52-3.52h30.08a3.52 3.52 0 0 1 3.52 3.52V29.14C50.56 42 42.5 50.5 32 55.68 21.5 50.5 13.44 42 13.44 29.14Z"/></g><path fill="#fab387" transform="translate(19.39 16.19) scale(0.4128)" d="M32 2c2 16 12 26 28 30-16 4-26 14-28 30-2-16-12-26-28-30C20 28 30 18 32 2Z"/><path fill="#ffffff" transform="translate(25.53 22.34) scale(0.2208)" d="M32 2c2 16 12 26 28 30-16 4-26 14-28 30-2-16-12-26-28-30C20 28 30 18 32 2Z"/></svg>
      </div>
      <h1><span class="a">AD</span> <span class="b">BYE-PASS</span></h1>
    </div>
    <p class="lede">유튜브 광고를 <b>응답 단계에서</b> 잘라냅니다.</p>
    <p class="sub">플레이어가 광고를 받지 않으니, 건너뛸 것도 남지 않습니다.</p>
    <div class="chips">
      <span class="chip on">iPhone · Orion</span>
      <span class="chip">Chrome · Edge</span>
      <span class="chip">Manifest V3</span>
      <span class="chip">GPLv3</span>
    </div>
  </div>
  <div class="url">jshsakura.github.io/oc-ad-bye-pass</div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)

// Measure rather than trust. Both of these fail quietly: a blocked web font
// renders in the fallback face and still looks nearly right, and a missing CJK
// font renders Hangul as tofu — which is only obvious if someone looks.
const type = await page.evaluate(() => {
  const measure = (text, font) => {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = font
    return ctx.measureText(text).width
  }
  return {
    titled: measure('AD', "76px 'Zen Tokyo Zoo'"),
    fallback: measure('AD', '76px monospace'),
    hangul: measure('잘라냅니다', "33px 'Noto Sans KR', system-ui"),
  }
})
if (Math.abs(type.titled - type.fallback) < 1) {
  throw new Error(`제목 웹폰트가 안 먹었다 (${type.titled}px = 폴백 ${type.fallback}px)`)
}
if (type.hangul < 100) {
  throw new Error(`한글이 렌더되지 않았다 — 두부일 가능성 (${type.hangul}px)`)
}

await page.screenshot({ path: join(SITE, 'og.png') })
await browser.close()

console.log(`og.png ← ${bg ? 'og-bg.png + 텍스트' : 'CSS 질감 + 텍스트'}`)
console.log(`  제목 ${type.titled.toFixed(1)}px (폴백 ${type.fallback.toFixed(1)}px) · 한글 ${type.hangul.toFixed(0)}px`)
