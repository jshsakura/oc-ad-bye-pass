// public/icons/icon{16,48,128}.png 을 생성한다.
// 이미지 라이브러리 없이 zlib 만으로 RGBA PNG 를 직접 인코딩한다.
// 디자인: 유튜브 레드 원 + 흰 재생 삼각형 + 대각선 취소선.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(import.meta.dirname), 'public', 'icons')
const SS = 4 // 슈퍼샘플링 배수 (안티에일리어싱)

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

/** 점과 선분 사이 거리 (취소선 두께 판정용) */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const RED = [230, 33, 23]
const WHITE = [255, 255, 255]

/**
 * 단위 좌표(0..1)에서의 색. null 이면 투명.
 * 16px 에서도 뭉개지지 않아야 해서 형태를 최대한 단순하게 잡았다 —
 * 유튜브 레드 원 + 흰 대각선(금지 표시).
 */
function sample(x, y) {
  if (Math.hypot(x - 0.5, y - 0.5) > 0.47) return null
  return distToSegment(x, y, 0.21, 0.21, 0.79, 0.79) < 0.075 ? WHITE : RED
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
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
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
        // 커버리지로 나눠 색을 구하고, 알파는 전체 샘플 대비 비율
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
