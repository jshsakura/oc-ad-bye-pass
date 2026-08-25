// The element picker's selector generator.
//
// Only the part that needs no DOM is here — whether a class name is worth
// building a rule out of. That is the judgement the whole feature rests on: a
// picker that offers `.sc-a1b2c3d` produces a rule that matches today and
// nothing next week, and the user has no way to tell those two apart.

import assert from 'node:assert/strict'
import test from 'node:test'
import { isCustomElement, isStableClass, isStableId } from '../src/shared/picker.ts'

test('사람이 지은 이름은 규칙으로 쓴다', () => {
  for (const token of ['ad', 'ad-banner', 'adWrapper', 'sidebar_ad', 'cookie-consent', 'gnb']) {
    assert.equal(isStableClass(token), true, `써야 한다: ${token}`)
  }
})

test('빌드가 지은 이름은 쓰지 않는다', () => {
  for (const token of [
    'sc-a1b2c3',      // styled-components 해시
    'css-1x2y3z4',    // emotion
    'item-1234567',   // 일련번호
    'a3f8b21c9d',     // 통짜 해시
    'x'.repeat(41),   // 손으로 쓰기엔 너무 길다
  ]) {
    assert.equal(isStableClass(token), false, `쓰면 안 된다: ${token}`)
  }
})

test('CSS 식별자로 그대로 쓸 수 없는 것은 거른다', () => {
  // 이스케이프가 필요한 이름은 셀렉터에 이어붙이는 순간 깨진다.
  for (const token of ['', '3col', 'a b', 'has.dot', 'has#hash', 'has:colon', '한글']) {
    assert.equal(isStableClass(token), false, `거절해야 한다: ${JSON.stringify(token)}`)
  }
})

test('id 는 클래스와 같은 기준으로 본다', () => {
  assert.equal(isStableId('masthead-ad'), true)
  assert.equal(isStableId('ember12345'), false)
})

test('이름에 하이픈이 있으면 태그 자체가 표식이다', () => {
  assert.equal(isCustomElement('ytd-ad-slot-renderer'), true)
  assert.equal(isCustomElement('div'), false)
  assert.equal(isCustomElement('span'), false)
})
