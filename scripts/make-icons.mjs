// Generates public/icons/icon{16,48,128}.png from one SVG definition.
//
// **Rendered by a browser, not hand-encoded.** There used to be a PNG encoder
// in this file — zlib and a CRC table, no image library, quite pleasing. Orion
// on iOS refused every package built with the icons it produced, with no error
// beyond "Something went wrong", while the identical package carrying the
// previous icons installed. Six packages, split cleanly on that one difference.
//
// The files it wrote passed every check that could be made of them: signature,
// chunk order, CRCs, colour type, exact pixel byte counts. Whatever the
// difference is, it is below what those checks can see — which is the argument
// for not hand-rolling the format at all. Chromium writes ordinary PNGs and is
// already a dependency here.
//
// Design: the spark inside a shield. Mauve tile, panel-coloured shield, peach
// spark with a white core. At 16px only the white *core* is dropped — the
// shield stays, because without it the toolbar shows a bare spark that reads as
// a different app than the full mark on the site and in the store. Two tones at
// sixteen pixels (dark shield, peach spark) hold up; three did not.
//
// The mark sits inside the circle inscribed in the tile, with room to spare.
// Chrome shows the square; Orion crops it to a circle, and at full size the
// shield's shoulders ran right up against that crop.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const OUT_DIR = join(dirname(import.meta.dirname), 'public', 'icons')

const SHIELD =
  'M13.44 13.44a3.52 3.52 0 0 1 3.52-3.52h30.08a3.52 3.52 0 0 1 3.52 3.52V29.14' +
  'C50.56 42 42.5 50.5 32 55.68 21.5 50.5 13.44 42 13.44 29.14Z'
const SPARK = 'M32 2c2 16 12 26 28 30-16 4-26 14-28 30-2-16-12-26-28-30C20 28 30 18 32 2Z'

const TILE = '#7e4dc5'
const PANEL = '#181825'
const PEACH = '#fab387'

/** The full mark. At 16 only the white core comes out; the shield stays. */
function svg(size) {
  const small = size <= 16
  const spark =
    `<path fill="${PEACH}" transform="translate(19.39 16.19) scale(0.4128)" d="${SPARK}"/>` +
    (small ? '' : `<path fill="#ffffff" transform="translate(25.53 22.34) scale(0.2208)" d="${SPARK}"/>`)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${TILE}"/>` +
    `<g transform="translate(32 32) scale(0.9) translate(-32 -32)">` +
    `<path fill="${PANEL}" d="${SHIELD}"/></g>` +
    spark +
    '</svg>'
  )
}

const browser = await chromium.launch()
mkdirSync(OUT_DIR, { recursive: true })

for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // A transparent background so the tile's rounded corners stay rounded.
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`)
  const png = await page.screenshot({ omitBackground: true })
  const file = join(OUT_DIR, `icon${size}.png`)
  writeFileSync(file, png)
  await page.close()
  console.log('wrote', file, png.length, 'bytes')
}

await browser.close()
