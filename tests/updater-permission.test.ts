// Whether the updater thinks it may fetch its own default list.
//
// It decided it could not, on Orion, about raw.githubusercontent.com — an
// address the manifest declares. chrome.permissions.contains answered false for
// a static host permission, the fetch was never attempted, and the options page
// reported a permission problem for the one URL that cannot have one.

import assert from 'node:assert/strict'
import { test } from 'node:test'

// The manifest's own host_permissions, as shipped.
const DECLARED = ['https://raw.githubusercontent.com/*', 'https://gist.githubusercontent.com/*']

/** Mirrors declaredInManifest() in src/background/updater.ts. */
function declared(origin: string, patterns = DECLARED): boolean {
  return patterns.some((pattern) => {
    const host = pattern.replace(/^\*:\/\//, 'https://').replace(/\/\*$/, '')
    try {
      return new URL(host).origin === origin
    } catch {
      return false
    }
  })
}

test('기본 리스트 주소는 매니페스트에 있으므로 물어볼 것도 없다', () => {
  assert.equal(declared('https://raw.githubusercontent.com'), true)
  assert.equal(declared('https://gist.githubusercontent.com'), true)
})

test('선언하지 않은 주소는 매니페스트로 통과시키지 않는다', () => {
  assert.equal(declared('https://example.com'), false)
  // 접두사가 겹친다고 통과하면 안 된다 — 남의 호스트다
  assert.equal(declared('https://raw.githubusercontent.com.evil.test'), false)
})

test('포트나 스킴이 다르면 다른 오리진이다', () => {
  assert.equal(declared('http://raw.githubusercontent.com'), false)
})
