// The caption chooser is the decision half of the 자막 자동 선택 toggle; the
// player half cannot run under node, so the cases live here.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseCaptionSelection, videoLanguage } from '../src/main/captions.ts'

const KO = { languageCode: 'ko' }

test('선호 언어의 트랙이 있으면 그것을 고른다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'en' }, { languageCode: 'ko' }], [KO], ['ko'])
  assert.deepEqual(pick, { languageCode: 'ko' })
})

test('지역 변형(ko-KR)도 같은 언어로 본다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ko-KR' }], [], ['ko'])
  assert.deepEqual(pick, { languageCode: 'ko-KR' })
})

test('영어 설정이면 영어 트랙이 직접 매치다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ja' }, { languageCode: 'en-US' }], [], ['en'])
  assert.deepEqual(pick, { languageCode: 'en-US' })
})

test('맞는 트랙이 없으면 영어 트랙 기반의 자동 번역을 켠다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ja' }, { languageCode: 'en' }], [KO], ['ko'])
  assert.deepEqual(pick, {
    languageCode: 'en',
    translationLanguage: { languageCode: 'ko' },
  })
})

test('영어도 없으면 첫 트랙을 번역 기반으로 쓴다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ja' }], [KO], ['ko'])
  assert.deepEqual(pick, {
    languageCode: 'ja',
    translationLanguage: { languageCode: 'ko' },
  })
})

test('설정 언어 번역이 지원 목록에 없으면 건드리지 않는다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'en' }], [{ languageCode: 'ja' }], ['ko'])
  assert.equal(pick, null)
})

test('영어 설정에서 한국어만 있는 영상이면 영어 번역을 켠다', () => {
  const pick = chooseCaptionSelection([{ languageCode: 'ko' }], [{ languageCode: 'en' }], ['en'])
  assert.deepEqual(pick, {
    languageCode: 'ko',
    translationLanguage: { languageCode: 'en' },
  })
})

test('트랙 목록이 비어 있으면 null. 호출부가 자막 없음으로 기록한다', () => {
  assert.equal(chooseCaptionSelection([], [KO], ['ko']), null)
})

test('languageCode 가 빠진 항목은 무시한다', () => {
  const pick = chooseCaptionSelection([{}, { languageCode: 'ko' }], [], ['ko'])
  assert.deepEqual(pick, { languageCode: 'ko' })
})

test('언어 목록 순서대로 직접 매치를 찾는다', () => {
  const pick = chooseCaptionSelection(
    [{ languageCode: 'ja' }, { languageCode: 'ko' }],
    [],
    ['en', 'ko'],
  )
  assert.deepEqual(pick, { languageCode: 'ko' })
})

test('번역 대상은 목록의 첫 언어다', () => {
  const pick = chooseCaptionSelection(
    [{ languageCode: 'ja' }],
    [{ languageCode: 'en' }, { languageCode: 'ko' }],
    ['en', 'ko'],
  )
  assert.deepEqual(pick, {
    languageCode: 'ja',
    translationLanguage: { languageCode: 'en' },
  })
})

test('videoLanguage 는 자동생성(asr) 트랙의 언어를 읽는다', () => {
  assert.equal(
    videoLanguage([{ languageCode: 'ko' }, { languageCode: 'en-US', kind: 'asr' }]),
    'en',
  )
})

test('asr 트랙이 없으면 영상 언어를 모른다고 답한다', () => {
  assert.equal(videoLanguage([{ languageCode: 'ko' }]), null)
})
