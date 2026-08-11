// The allowlist is the escape hatch for global injection, so its edges matter:
// a "turn it off" that half-works is what makes people uninstall instead.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addToAllowlist,
  hostFromUrl,
  isAllowlisted,
  normalizeHost,
  removeFromAllowlist,
  siteKindFor,
} from '../src/shared/sites.ts'

test('YouTube is recognised across all of its hosts', () => {
  for (const host of [
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'studio.youtube.com',
    'www.youtube-nocookie.com',
    'youtu.be',
  ]) {
    assert.equal(siteKindFor(host), 'youtube', host)
  }

  // Look-alikes must not pass — a hostname ending check that got this wrong
  // would hand YouTube's full three layers to an attacker's domain.
  for (const host of ['notyoutube.com', 'youtube.com.evil.test', 'myyoutube.com', 'example.com']) {
    assert.equal(siteKindFor(host), 'generic', host)
  }
})

test('hosts are normalised so the list needs one entry, not two', () => {
  assert.equal(normalizeHost('WWW.Example.COM'), 'example.com')
  assert.equal(normalizeHost('shop.example.com'), 'shop.example.com')
})

test('only pages we could act on yield a host', () => {
  assert.equal(hostFromUrl('https://www.example.com/a?b=c'), 'example.com')
  assert.equal(hostFromUrl('http://example.com'), 'example.com')
  // Nothing to block on these, and the popup must not offer a switch for them.
  assert.equal(hostFromUrl('chrome://extensions'), null)
  assert.equal(hostFromUrl('about:blank'), null)
  assert.equal(hostFromUrl('file:///tmp/x.html'), null)
  assert.equal(hostFromUrl(undefined), null)
  assert.equal(hostFromUrl('not a url'), null)
})

test('an entry covers its subdomains', () => {
  const list = ['example.com']
  assert.equal(isAllowlisted('example.com', list), true)
  assert.equal(isAllowlisted('shop.example.com', list), true)
  assert.equal(isAllowlisted('a.b.example.com', list), true)
  // Suffix matching must not leak into a different registrable domain.
  assert.equal(isAllowlisted('notexample.com', list), false)
  assert.equal(isAllowlisted('example.com.evil.test', list), false)
})

test('adding is idempotent and keeps the list sorted', () => {
  let list = addToAllowlist('www.Example.com', [])
  assert.deepEqual(list, ['example.com'])

  // Already covered by the parent entry — nothing to add.
  list = addToAllowlist('shop.example.com', list)
  assert.deepEqual(list, ['example.com'])

  list = addToAllowlist('another.test', list)
  assert.deepEqual(list, ['another.test', 'example.com'])
})

test('removing also clears the parent entry that was covering it', () => {
  // Otherwise "turn it back on" appears to do nothing: the broader entry still
  // matches, and the user is left flipping a switch with no effect.
  const list = ['example.com']
  assert.deepEqual(removeFromAllowlist('shop.example.com', list), [])
  assert.deepEqual(removeFromAllowlist('example.com', list), [])
  assert.deepEqual(removeFromAllowlist('unrelated.test', list), ['example.com'])
})
