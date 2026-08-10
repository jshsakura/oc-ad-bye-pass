// 1계층의 핵심. 광고 필드는 확실히 지우고, 그 외에는 절대 손대지 않아야 한다.
// (유튜브를 깨뜨리는 사고는 대부분 "너무 많이 지워서" 난다.)

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pruneAdFields } from '../src/main/prune.ts'
import { BUNDLED_PRUNE } from '../src/shared/selectors.ts'

test('플레이어 응답 최상위의 광고 필드를 지운다', () => {
  const response: Record<string, unknown> = {
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{}],
    adSlots: [{}],
    adBreakHeartbeatParams: 'xxx',
    videoDetails: { videoId: 'abc' },
    streamingData: { formats: [] },
  }

  const removed = pruneAdFields(response, BUNDLED_PRUNE)

  assert.equal(removed, 4)
  assert.ok(!('adPlacements' in response))
  assert.ok(!('playerAds' in response))
  assert.ok(!('adSlots' in response))
  assert.ok(!('adBreakHeartbeatParams' in response))
  assert.deepEqual(response.videoDetails, { videoId: 'abc' })
  assert.deepEqual(response.streamingData, { formats: [] })
})

test('playerResponse 로 한 겹 감싸인 응답도 처리한다', () => {
  const wrapped = {
    playerResponse: { adPlacements: [{}], videoDetails: { videoId: 'abc' } },
    otherStuff: 1,
  }

  assert.equal(pruneAdFields(wrapped, BUNDLED_PRUNE), 1)
  assert.ok(!('adPlacements' in wrapped.playerResponse))
  assert.equal(wrapped.otherStuff, 1)
})

test('점으로 이어진 경로를 따라간다', () => {
  const playerConfig: Record<string, unknown> = { adConfig: { x: 1 }, audioConfig: { y: 2 } }

  assert.equal(pruneAdFields({ playerConfig }, ['playerConfig.adConfig']), 1)
  assert.ok(!('adConfig' in playerConfig))
  assert.deepEqual(playerConfig.audioConfig, { y: 2 })
})

test('경로 중간이 없으면 아무 일도 없다', () => {
  const response = { videoDetails: {} }
  assert.equal(pruneAdFields(response, ['playerConfig.adConfig', 'a.b.c.d']), 0)
  assert.deepEqual(response, { videoDetails: {} })
})

test('배열로 온 응답은 항목마다 처리한다', () => {
  const batch = [{ adPlacements: [] }, { adSlots: [] }, { videoDetails: {} }]
  assert.equal(pruneAdFields(batch, BUNDLED_PRUNE), 2)
  assert.deepEqual(batch, [{}, {}, { videoDetails: {} }])
})

test('객체가 아니면 그냥 0 을 돌려준다', () => {
  for (const value of [null, undefined, 1, 'x', true]) {
    assert.equal(pruneAdFields(value, BUNDLED_PRUNE), 0)
  }
})

test('깊은 곳까지 파고들지 않는다 — 피드 광고는 2계층(CSS) 담당', () => {
  // 응답이 수 MB 라 전체 순회하면 스크롤이 끊긴다. 의도적으로 얕게 본다.
  const deep = { contents: { section: { item: { adPlacements: [{}] } } } }
  assert.equal(pruneAdFields(deep, BUNDLED_PRUNE), 0)
  assert.ok('adPlacements' in deep.contents.section.item)
})

test('프로토타입을 오염시키지 않는다', () => {
  const response: Record<string, unknown> = { adPlacements: [] }
  pruneAdFields(response, ['__proto__.polluted', 'adPlacements'])
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  assert.ok(!('adPlacements' in response))
})
