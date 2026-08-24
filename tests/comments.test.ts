// The label decides whether a comment control gets pressed. It is the only
// part of YouTube's translate affordance that is stable across desktop and
// mobile markup, so it carries the whole decision and is worth its own tests.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldClickTranslate } from '../src/isolated/comments.ts'

test('번역 버튼은 누른다', () => {
  assert.equal(shouldClickTranslate('번역'), true)
  assert.equal(shouldClickTranslate('Translate to Korean'), true)
  assert.equal(shouldClickTranslate('  Translate  '), true)
})

test('이미 번역된 뒤의 "원문 보기"는 누르지 않는다', () => {
  // Pressing this undoes the translation, which is how an auto-clicker ends up
  // flipping a comment back and forth forever.
  assert.equal(shouldClickTranslate('원문 보기'), false)
  assert.equal(shouldClickTranslate('Show original'), false)
  assert.equal(shouldClickTranslate('원본 보기'), false)
})

test('관계없는 버튼은 건드리지 않는다', () => {
  assert.equal(shouldClickTranslate('답글'), false)
  assert.equal(shouldClickTranslate('Reply'), false)
  assert.equal(shouldClickTranslate('좋아요'), false)
  assert.equal(shouldClickTranslate(''), false)
  assert.equal(shouldClickTranslate('   '), false)
})

test('긴 본문이 통째로 들어오면 버튼으로 보지 않는다', () => {
  // A comment body that happens to contain the word — the control's own label
  // is always short, so length is the cheap guard against matching prose.
  const prose = '이 영상 번역해주실 분 계신가요? 자막이 없어서 이해가 잘 안 되네요 도와주세요'
  assert.equal(shouldClickTranslate(prose), false)
})
