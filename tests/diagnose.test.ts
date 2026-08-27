// 진단 패널이 근거를 읽는 방식.
//
// 판정만으로는 답을 못 합니다. `native-language` 는 한국어 영상에서는 맞고
// 영어 영상에서는 틀린데, 어느 쪽인지 알려면 그 영상을 따로 열어 재야 했습니다.
// 보고 하나당 왕복 한 번이고, 도구가 있는 사람만 할 수 있는 일이었습니다.

import assert from 'node:assert/strict'
import test from 'node:test'
import { captionEvidence } from '../src/popup/diagnose.ts'

test('근거를 사람이 읽는 말로 옮긴다', () => {
  assert.equal(
    captionEvidence('want=ko tracks=1 resp=1 spoken=ko via=:data'),
    '내 언어 ko · 플레이어 트랙 1 · 응답 트랙 1 · 영상 언어 ko · 경로 :data',
  )
})

test('모르는 항목은 버리지 않고 그대로 보여 준다', () => {
  // 나중에 늘어난 항목이 표에 없다고 사라지면, 정작 필요할 때 없습니다.
  assert.equal(captionEvidence('want=ko future=42'), '내 언어 ko · future 42')
})

test('빈 값과 등호 없는 조각에도 죽지 않는다', () => {
  assert.equal(captionEvidence(''), '')
  assert.equal(captionEvidence('lonely'), 'lonely')
  assert.equal(captionEvidence('want=  tracks=0'), '내 언어  · 플레이어 트랙 0')
})
