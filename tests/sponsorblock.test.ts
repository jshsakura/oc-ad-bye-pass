// The parts that decide what gets skipped. Everything here is pure, because
// what has to be right is not the seek — that is one line — but which second
// it seeks to, and when it declines to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREFIX_LENGTH,
  hashPrefix,
  mergeSegments,
  pickSegments,
  segmentAt,
} from '../src/shared/sponsorblock.ts'

/** One video's worth of the API's shape. */
const video = (id: string, segments: unknown[]) => [{ videoID: id, segments }]

test('해시 접두사는 짧고, 영상 아이디를 되돌릴 수 없다', async () => {
  const prefix = await hashPrefix('kJQP7kiw5Fk')
  assert.equal(prefix?.length, PREFIX_LENGTH)
  assert.match(prefix!, /^[0-9a-f]+$/)
  // The whole privacy argument rests on this: what leaves the browser must not
  // contain the id, in any form a server could read back.
  assert.ok(!prefix!.includes('kJQP'))
  // Same id, same prefix — otherwise the cache and the server both thrash.
  assert.equal(await hashPrefix('kJQP7kiw5Fk'), prefix)
  assert.notEqual(await hashPrefix('dQw4w9WgXcQ'), '')
})

test('응답에 섞여 온 다른 영상은 버린다', () => {
  // The server answers with every video sharing the prefix. Picking the wrong
  // one would skip a chunk of the video at times that mean nothing.
  const payload = [
    { videoID: 'other', segments: [{ category: 'sponsor', segment: [0, 30] }] },
    { videoID: 'mine', segments: [{ category: 'sponsor', segment: [10, 20] }] },
  ]
  assert.deepEqual(pickSegments(payload, 'mine'), [{ start: 10, end: 20 }])
  assert.deepEqual(pickSegments(payload, 'nobody'), [])
})

test('스폰서가 아니거나 표를 잃은 구간은 안 쓴다', () => {
  const rows = [
    { category: 'sponsor', segment: [10, 20] },
    { category: 'intro', segment: [0, 5] }, // the creator's own work
    { category: 'sponsor', actionType: 'mute', segment: [30, 40] },
    { category: 'sponsor', votes: -2, segment: [50, 60] }, // crowd says it is wrong
  ]
  assert.deepEqual(pickSegments(video('v', rows), 'v'), [{ start: 10, end: 20 }])
})

test('망가진 구간은 조용히 버린다', () => {
  const rows = [
    { category: 'sponsor', segment: [20, 10] }, // backwards
    { category: 'sponsor', segment: [10, 10] }, // zero length
    { category: 'sponsor', segment: [-5, 10] }, // before the start
    { category: 'sponsor', segment: [1] }, // no end
    { category: 'sponsor', segment: ['a', 'b'] },
    { category: 'sponsor', segment: [Infinity, 10] },
    { category: 'sponsor' },
  ]
  assert.deepEqual(pickSegments(video('v', rows), 'v'), [])
  // And a response that is not what we expected at all.
  assert.deepEqual(pickSegments(null, 'v'), [])
  assert.deepEqual(pickSegments({ error: 'nope' }, 'v'), [])
})

test('겹치는 신고는 하나로 합친다', () => {
  // Several people submit the same sponsor with slightly different edges. Left
  // separate, seeking to the end of the first lands inside the second and seeks
  // again — one jump the viewer expected, two they got.
  assert.deepEqual(
    mergeSegments([
      { start: 10, end: 25 },
      { start: 20, end: 30 },
      { start: 60, end: 70 },
    ]),
    [
      { start: 10, end: 30 },
      { start: 60, end: 70 },
    ],
  )
  // Touching exactly is still one segment.
  assert.deepEqual(mergeSegments([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [
    { start: 0, end: 20 },
  ])
  // Fully contained.
  assert.deepEqual(mergeSegments([{ start: 0, end: 100 }, { start: 10, end: 20 }]), [
    { start: 0, end: 100 },
  ])
  // Out of order in, in order out.
  assert.deepEqual(mergeSegments([{ start: 50, end: 60 }, { start: 0, end: 10 }]), [
    { start: 0, end: 10 },
    { start: 50, end: 60 },
  ])
})

test('구간 판정은 조금 일찍 걸리고, 끝에서는 안 걸린다', () => {
  const segments = [{ start: 10, end: 20 }]
  // The lead is 0.3s: a seek takes a moment to land and the player reports time
  // in coarse steps, so waiting for 10.0 exactly means the first fraction of a
  // second of the sponsor is heard. Pin both sides of that window.
  assert.equal(segmentAt(segments, 9.8)?.end, 20, '여유 안쪽은 걸려야 한다')
  assert.equal(segmentAt(segments, 9.6), null, '여유 바깥은 아직 아니다')
  assert.equal(segmentAt(segments, 15)?.end, 20)
  assert.equal(segmentAt(segments, 5), null)
  // And the lead is a parameter, not a constant baked into the check.
  assert.equal(segmentAt(segments, 9.6, 1)?.end, 20)
  assert.equal(segmentAt(segments, 9.8, 0), null)
  // Exclusive at the end, or the seek we just made matches again and loops.
  assert.equal(segmentAt(segments, 20), null)
  assert.equal(segmentAt(segments, 25), null)
})
