// Named devices rather than numbers, because the threshold is only defensible
// if the gap it sits in is real: the widest phone is 440 and the smallest
// tablet is 744, and nothing ships between them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenKind } from '../src/ui/device.ts'

const PHONES: Array<[string, number, number]> = [
  ['iPhone SE', 375, 667],
  ['iPhone 16', 393, 852],
  ['iPhone 16 Pro', 402, 874],
  ['iPhone 16 Pro Max', 440, 956],
  ['Galaxy S24', 360, 780],
  ['Pixel 9 Pro XL', 448, 998],
]

const DESKTOPS: Array<[string, number, number]> = [
  ['iPad mini', 744, 1133],
  ['iPad Pro 13', 1024, 1366],
  ['MacBook Air 13', 1280, 800],
  ['1080p monitor', 1920, 1080],
  ['4K monitor', 3840, 2160],
]

test('폰은 세로로도 가로로도 폰이다', () => {
  for (const [name, w, h] of PHONES) {
    assert.equal(screenKind(w, h), 'phone', `${name} 세로`)
    // A phone held sideways reports 844 for screen.width, which is why the
    // short side decides and not the width.
    assert.equal(screenKind(h, w), 'phone', `${name} 가로`)
  }
})

test('태블릿과 PC 는 데스크톱이다', () => {
  for (const [name, w, h] of DESKTOPS) {
    assert.equal(screenKind(w, h), 'desktop', `${name} 세로`)
    assert.equal(screenKind(h, w), 'desktop', `${name} 가로`)
  }
})

test('경계는 500 이고, 그 위는 데스크톱이다', () => {
  assert.equal(screenKind(500, 900), 'phone')
  assert.equal(screenKind(501, 900), 'desktop')
})
