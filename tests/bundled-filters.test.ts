// Checks that the filters/video.json we publish passes the extension's own
// validator. Pushing a broken one makes every installed extension fail to
// update, so CI blocks it.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseFilterList } from '../src/shared/filterlist.ts'

const LIST_PATH = fileURLToPath(new URL('../filters/video.json', import.meta.url))

test('filters/video.json 이 검증을 통과한다', () => {
  const result = parseFilterList(readFileSync(LIST_PATH, 'utf8'))
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  if (!result.ok) return

  assert.deepEqual(result.dropped, [], '걸러진 규칙이 있으면 안 된다')
  assert.ok(result.list.version >= 1, 'version 은 1 이상')
  assert.ok(Object.keys(result.list.rules.hide).length > 0, 'hide 규칙이 비어 있다')
  assert.ok(result.list.rules.prune.includes('adPlacements'), 'adPlacements 프루닝은 필수')
})
