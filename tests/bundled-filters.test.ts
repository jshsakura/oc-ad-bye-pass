// 저장소에 올리는 filters/youtube.json 이 확장의 검증기를 통과하는지 확인한다.
// 이게 깨진 채로 push 되면 모두의 확장이 갱신에 실패하므로 CI 에서 막는다.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseFilterList } from '../src/shared/filterlist.ts'

const LIST_PATH = fileURLToPath(new URL('../filters/youtube.json', import.meta.url))

test('filters/youtube.json 이 검증을 통과한다', () => {
  const result = parseFilterList(readFileSync(LIST_PATH, 'utf8'))
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  if (!result.ok) return

  assert.deepEqual(result.dropped, [], '걸러진 규칙이 있으면 안 된다')
  assert.ok(result.list.version >= 1, 'version 은 1 이상')
  assert.ok(Object.keys(result.list.rules.hide).length > 0, 'hide 규칙이 비어 있다')
  assert.ok(result.list.rules.prune.includes('adPlacements'), 'adPlacements 프루닝은 필수')
})
