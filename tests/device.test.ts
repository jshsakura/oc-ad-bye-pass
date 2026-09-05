// Named devices rather than numbers, because the threshold is only defensible
// if the gap it sits in is real: the widest phone is 440 and the smallest
// tablet is 744, and nothing ships between them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsPipButton, screenKind } from '../src/ui/device.ts'

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

// ── 어디에 PiP 버튼을 그리나 ─────────────────────────────────────────────
//
// 버튼은 아이폰에서 잰 사실 하나 때문에 있습니다: WebKit 은 살아있는 제스처
// 안에서만 작은 창을 열고, 유튜브는 WebKit 자체 PiP 컨트롤이 있는 네이티브
// 컨트롤을 자기 것으로 덮습니다. 그래서 우리 버튼 탭이 유일한 길입니다.
// 데스크톱 크롬은 우클릭 두 번과 주소창 미디어 컨트롤, 파이어폭스는 영상 위
// 자체 토글이 있습니다. 거기서 우리 버튼은 플레이어 위에 뜬 중복입니다.

test('WebKit 이면 그린다 — Orion 아이폰도, Orion 맥도', () => {
  assert.equal(needsPipButton({ webkit: true, phone: true }), true)
  assert.equal(needsPipButton({ webkit: true, phone: false }), true)
})

test('폰이면 엔진과 무관하게 그린다 — 제스처가 유일한 길인 건 폰의 사정이다', () => {
  assert.equal(needsPipButton({ webkit: false, phone: true }), true)
})

test('데스크톱 Blink·Gecko 에는 그리지 않는다 — 브라우저가 자기 PiP 를 갖고 있다', () => {
  assert.equal(needsPipButton({ webkit: false, phone: false }), false)
})
