// The decision behind automatic picture-in-picture.
//
// The behaviour itself — leave the tab, the video hands itself to a small
// window — cannot be driven end to end here: a headless Chromium keeps every
// page visible, and none of Page.setWebLifecycleState,
// Emulation.setPageVisibility or setFocusEmulationEnabled moves document.hidden
// off `false`. So the branch that decides is a function, and this covers it;
// e2e/11 covers everything either side of it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldAutoPip } from '../src/isolated/pip.ts'

const playing = { paused: false, ended: false }

test('탭이 앞에 있으면 넘기지 않는다', () => {
  assert.equal(shouldAutoPip({ hidden: false, video: playing }), false)
})

test('숨겨졌고 재생 중이면 넘긴다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: playing }), true)
})

test('영상이 없으면 넘길 것도 없다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: null }), false)
})

test('멈춰 있는 영상은 넘기지 않는다', () => {
  // 떠 있을 이유가 없는 창이 사용자가 하러 간 일 위에 남는다.
  assert.equal(shouldAutoPip({ hidden: true, video: { paused: true, ended: false } }), false)
})

test('끝난 영상도 넘기지 않는다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: { paused: false, ended: true } }), false)
})

// 돌아왔을 때 되돌릴지 — 나갈 때만큼이나 조심할 곳이다. 사용자가 스스로 전체화면으로
// 본 것을 확장이 멋대로 접으면 그건 기능이 아니라 훼방이다.
import { shouldRestoreInline } from '../src/isolated/pip.ts'

test('우리가 넘긴 것만 되돌린다', () => {
  assert.equal(
    shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'picture-in-picture' }),
    true,
  )
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'fullscreen' }), true)
})

test('사용자가 직접 전체화면으로 본 것은 건드리지 않는다', () => {
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: false, mode: 'fullscreen' }), false)
})

test('아직 안 돌아왔으면 되돌리지 않는다', () => {
  assert.equal(
    shouldRestoreInline({ visible: false, engagedByUs: true, mode: 'picture-in-picture' }),
    false,
  )
})

test('이미 인라인이면 할 일이 없다', () => {
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'inline' }), false)
})
