import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLogLines } from '../src/shared/log.ts'

test('시간과 날짜가 바뀌어도 최근 정지 기록을 남긴다', () => {
  const old = '2026-09-30T14:59:59.999Z 재생: playing'
  const pause = '2026-09-30T15:00:00.001Z 재생: pause'
  assert.equal(mergeLogLines(old, pause, pause.length), pause)
  const nextDay = '2026-10-01T00:00:00.000Z 시작: youtube'
  assert.equal(mergeLogLines(nextDay, old), `${old}\n${nextDay}`)
})

test('중복과 잘린 줄, 시간 없는 이전 형식은 기록을 덮지 않는다', () => {
  const line = '2026-09-30T15:00:00.001Z 재생: pause'
  assert.equal(mergeLogLines(`59:59.999 시작: generic\n${line}`, `1Z broken\n${line}`), line)
})
