// The caption chooser is the decision half of the 자막 자동 선택 toggle; the
// player half cannot run under node, so the cases live here.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseCaptionSelection, isSelectionApplied, videoLanguage } from '../src/main/captions.ts'

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

// ── 적용한 선택이 유지되는가 ────────────────────────────────────────────────
//
// CC 버튼을 누르면 유튜브가 자기가 저장해 둔 자막 상태를 복원합니다. 대부분
// 영어입니다. 한 번 적용하고 손을 떼는 규칙에서는 그게 그대로 남았고, 가만히
// 두면 잘 되는데 성질 급해서 버튼을 누르면 영어가 되는 증상이 그것이었습니다.
//
// 되돌려 놓아도 되는 이유는 CC 를 누르는 것이 언어를 고르는 행위가 아니기
// 때문입니다. 언어를 직접 고른 사람과는 싸우면 안 되고, 그 경계가 아래 세 번째
// 케이스입니다.

test('플레이어가 다른 언어를 보여 주고 있으면 되돌릴 대상이다', () => {
  const chosen = { languageCode: 'ko' }
  assert.equal(isSelectionApplied({ languageCode: 'en' }, chosen), false)
  assert.equal(isSelectionApplied({ languageCode: 'ko' }, chosen), true)
  // 지역 변종은 같은 언어로 본다.
  assert.equal(isSelectionApplied({ languageCode: 'KO' }, chosen), true)
})

test('자동 번역은 원본과 대상 언어가 둘 다 맞아야 유지된 것이다', () => {
  const chosen = { languageCode: 'en', translationLanguage: { languageCode: 'ko' } }
  assert.equal(isSelectionApplied({ ...chosen }, chosen), true)
  // 번역이 풀리고 원본 영어만 남은 상태 — 되돌려야 한다.
  assert.equal(isSelectionApplied({ languageCode: 'en' }, chosen), false)
  // 다른 언어로 번역돼 있는 상태.
  assert.equal(
    isSelectionApplied({ languageCode: 'en', translationLanguage: { languageCode: 'ja' } }, chosen),
    false,
  )
})

test('읽을 수 없으면 틀렸다고 하지 않는다', () => {
  // null 은 "다르다" 가 아니라 "모르겠다" 다. 모르는 채로 되돌리는 것이
  // 사용자와 싸우기 시작하는 방법이다.
  const chosen = { languageCode: 'ko' }
  for (const unreadable of [undefined, null, 'ko', 42, {}, { languageCode: '' }]) {
    assert.equal(isSelectionApplied(unreadable, chosen), null, String(unreadable))
  }
})
