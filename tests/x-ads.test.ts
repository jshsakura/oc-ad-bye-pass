import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStylesheet, resolveRules, type FilterList } from '../src/shared/filterlist.ts'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'
import { BUNDLED_DOMAINS } from '../src/shared/selectors.ts'

test('X의 번들 광고 규칙은 언어와 원격 구독 없이 해당 호스트에만 적용된다', () => {
  const rules = resolveRules([], [])
  for (const host of ['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com']) {
    for (const lang of ['ko', 'en'] as const) {
      assert.match(buildStylesheet(rules, DEFAULT_SETTINGS.toggles, 'generic', host, lang), /placementTracking/)
    }
  }
  for (const host of ['example.org', 'notx.com', 'x.com.example.org', 'youtube.com']) {
    assert.doesNotMatch(buildStylesheet(rules, DEFAULT_SETTINGS.toggles, 'generic', host), /placementTracking/)
  }
})

test('다른 사이트 광고 숨김을 끄면 X 규칙도 빠진다', () => {
  const toggles = { ...DEFAULT_SETTINGS.toggles, genericAds: false }
  assert.doesNotMatch(buildStylesheet(resolveRules([], []), toggles, 'generic', 'x.com'), /placementTracking/)
})

test('원격 allow로 번들 도메인 규칙의 오탐을 해제할 수 있다', () => {
  const selectors = BUNDLED_DOMAINS.genericAds!['x.com']
  const remote: FilterList = {
    name: 'exception', version: 1, updatedAt: '2026-10-08',
    rules: { hide: {}, prune: [], click: [], allow: selectors },
  }
  assert.doesNotMatch(buildStylesheet(resolveRules([remote], []), DEFAULT_SETTINGS.toggles, 'generic', 'x.com'), /placementTracking/)
})
