// Generates public/icons/icon{16,48,128}.png.
// Encodes RGBA PNGs directly using nothing but zlib — no image library.
//
// Design: a shield with the spark inside it. A purple tile, a dark shield, and
// the spark in peach at its centre — the project's two colours doing the two
// jobs, blocking and marking.
//
// It is drawn as geometry rather than traced from the reference render, because
// the icon has to survive being 16 pixels wide in a toolbar and a downscaled
// illustration does not.
//
// Two earlier designs and why they are gone. A YouTube-red "blocked" sign
// matched nothing else the project owns and named YouTube back when this was
// YouTube-only. A white tile with a purple spark on it turned out to be Kagi
// Orion's own icon — poor manners in a package that sits in Orion's extension
// list, under a notice saying we are not affiliated with them.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(import.meta.dirname), 'public', 'icons')
const SS = 4 // Supersampling factor (anti-aliasing)

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = y * (width * 4 + 1)
    raw[dst] = 0 // filter: none
    rgba.copy(raw, dst + 1, src, src + width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TILE = [126, 77, 197] // #7e4dc5 — mauve, the site's accent
const SHIELD = [24, 24, 37] // #181825 — the site's panel colour
const PEACH = [250, 179, 135] // #fab387

/** Signed distance to a rounded square centred on the tile. Negative inside. */
function roundedSquare(x, y, half, radius) {
  const qx = Math.abs(x - 0.5) - (half - radius)
  const qy = Math.abs(y - 0.5) - (half - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/**
 * The four-pointed spark, as a superellipse: |x|^p + |y|^p <= 1 with p below 1
 * puts the points on the axes and bows the sides inward. No path data needed.
 */
function inSpark(x, y, cy, half, power) {
  const nx = Math.abs(x - 0.5) / half
  const ny = Math.abs(y - cy) / half
  return nx ** power + ny ** power <= 1
}

/**
 * A shield: straight shoulders that taper to a point.
 *
 * Drawn rather than traced so it can be tuned per size. The taper is a quarter
 * cosine — a straight one reads as a kite, and a circular one as a spade.
 */
function inShield(x, y, top, bottom, halfWidth) {
  if (y < top || y > bottom) return false
  const t = (y - top) / (bottom - top)
  const straight = 0.42
  const w =
    t <= straight ? halfWidth : halfWidth * Math.cos(((t - straight) / (1 - straight)) * (Math.PI / 2)) ** 0.7
  if (Math.abs(x - 0.5) > w) return false
  // Round the shoulders, or the top edge meets the sides in a hard corner.
  const r = 0.055
  if (t * (bottom - top) < r) {
    const dx = Math.abs(x - 0.5) - (halfWidth - r)
    const dy = top + r - y
    if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > r) return false
  }
  return true
}

/**
 * Colour at unit coordinates (0..1), or null for transparent.
 *
 * Full bleed: browsers shrink this into their own chrome, and a tile that
 * arrives with margin already built in ends up a speck. The spark is drawn
 * slightly larger at 16px, where a faithful scale is four unreadable pixels.
 */
function sample(x, y, size) {
  if (roundedSquare(x, y, 0.5, 0.22) > 0) return null

  // The shield's centre of mass sits above its point, so the spark is placed
  // there rather than at the middle of the tile — centred on the tile it looks
  // like it is sliding out of the bottom.
  const CENTRE = 0.46

  // At 16px three tones inside sixteen pixels is one too many, and the shield's
  // taper is two pixels wide. That size keeps the spark alone: it is the part
  // that has to be recognisable in a toolbar.
  if (size <= 16) return inSpark(x, y, 0.5, 0.42, 0.62) ? PEACH : TILE

  if (!inShield(x, y, 0.14, 0.88, 0.33)) return TILE
  return inSpark(x, y, CENTRE, 0.19, 0.62) ? PEACH : SHIELD
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, size)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      if (a > 0) {
        // Divide colour by coverage; alpha is the share of samples that hit
        const cov = a / 255
        rgba[i] = Math.round(r / cov)
        rgba[i + 1] = Math.round(g / cov)
        rgba[i + 2] = Math.round(b / cov)
        rgba[i + 3] = Math.round(a / n)
      }
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of [16, 48, 128]) {
  const file = join(OUT_DIR, `icon${size}.png`)
  writeFileSync(file, render(size))
  console.log('wrote', file)
}
