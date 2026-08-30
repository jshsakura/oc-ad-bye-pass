// What must be right is what this does NOT report. A watchdog that fires on
// every backgrounded tab is one nobody reads by the second day.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STALL_MS, stallMs } from '../src/isolated/stall.ts'

test('제때 온 틱은 멈춤이 아니다', () => {
  assert.equal(stallMs(1000, true), 0)
  assert.equal(stallMs(1200, true), 0)
  // Just under the threshold, where an ordinary busy frame lives.
  assert.equal(stallMs(1000 + STALL_MS - 1, true), 0)
})

test('오래 밀린 틱은 밀린 만큼을 돌려준다', () => {
  assert.equal(stallMs(1000 + STALL_MS, true), STALL_MS)
  assert.equal(stallMs(6000, true), 5000)
})

test('숨어 있던 동안의 공백은 멈춤이 아니다', () => {
  // A locked phone, a backgrounded tab, picture-in-picture: iOS suspends the
  // timer and the gap runs to minutes with nothing blocked.
  assert.equal(stallMs(300_000, false), 0)
  assert.equal(stallMs(6000, false), 0)
})
