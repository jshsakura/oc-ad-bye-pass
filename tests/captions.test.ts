// The caption chooser is the decision half of the 자막 한국어 우선 toggle; the
// player half cannot run under node, so the cases live here.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseCaptionSelection } from '../src/main/captions.ts'

const KO = { languageCode: 'ko' }

test('한국어 트랙이 있으면 그것을 고른다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'en' }, { languageCode: 'ko' }], [KO])
  assert.deepEqual(pick, { languageCode: 'ko' })
})

test('지역 변형(ko-KR)도 한국어로 본다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ko-KR' }], [])
  assert.deepEqual(pick, { languageCode: 'ko-KR' })
})

test('한국어가 없으면 영어 트랙 기반의 자동 번역을 켠다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ja' }, { languageCode: 'en' }], [KO])
  assert.deepEqual(pick, {
    languageCode: 'en',
    translationLanguage: { languageCode: 'ko' },
  })
})

test('영어도 없으면 첫 트랙을 번역 기반으로 쓴다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ja' }], [KO])
  assert.deepEqual(pick, {
    languageCode: 'ja',
    translationLanguage: { languageCode: 'ko' },
  })
})

test('한국어 번역이 지원 목록에 없으면 건드리지 않는다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'en' }], [{ languageCode: 'ja' }])
  assert.equal(pick, null)
})

test('자동 생성(asr) 영어 트랙도 번역 기반이 된다', () => {
  // YouTube marks auto-generated tracks with the same languageCode; nothing in
  // the chooser depends on how the track was made.
  const pick = chooseCaptionSelection([{ languageCode: 'en-US' }], [KO])
  assert.deepEqual(pick, {
    languageCode: 'en-US',
    translationLanguage: { languageCode: 'ko' },
  })
})

test('트랙 목록이 비어 있으면 null — 호출부가 자막 없음으로 기록한다', () => {
  assert.equal(chooseCaptionSelection([], [KO]), null)
})

test('languageCode 가 빠진 항목은 무시한다', () => {
  const pick = chooseCaptionSelection([{}, { languageCode: 'ko' }], [])
  assert.deepEqual(pick, { languageCode: 'ko' })
})
