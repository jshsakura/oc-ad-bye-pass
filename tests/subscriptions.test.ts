// Multi-list subscriptions: the migration, the cache shape, and the language gate.
//
// The migration is the part with teeth. Settings outlive builds, so the array
// these tests are about has to be produced from a string that older builds
// wrote, and getting it wrong does not throw — it silently unsubscribes someone
// from the list they were using.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readCaches } from '../src/shared/cache.ts'
import { buildStylesheet, resolveRules, type FilterList } from '../src/shared/filterlist.ts'
import {
  ANNOYANCE_LIST_URL,
  DEFAULT_LIST_URL,
  DEFAULT_SETTINGS,
  MAX_LISTS,
  parseBackup,
} from '../src/shared/settings.ts'

/** The only exported door into `mergeSettings`, which is what does the migrating. */
function migrate(stored: unknown) {
  const result = parseBackup(JSON.stringify({ app: 'oc-ad-bye-pass', settings: stored }))
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.settings
}

test('예전 listUrl 하나는 구독 목록으로 옮겨온다', () => {
  const custom = 'https://example.com/mine.json'
  const settings = migrate({ listUrl: custom })

  assert.equal(settings.lists[0]?.url, custom, '쓰던 주소가 맨 앞에 남아야 한다')
  assert.ok(
    settings.lists.some((sub) => sub.url === ANNOYANCE_LIST_URL),
    '새 기본 구독이 따라 들어와야 한다',
  )
})

test('기본 주소를 쓰던 사람은 기본 목록 그대로가 된다', () => {
  const settings = migrate({ listUrl: DEFAULT_LIST_URL })
  assert.deepEqual(settings.lists, DEFAULT_SETTINGS.lists)
})

test('리스트를 전부 지운 상태는 기본값으로 되돌아가지 않는다', () => {
  // 빈 배열은 실수가 아니라 "원격 리스트를 안 쓰겠다" 는 선택이다.
  const settings = migrate({ lists: [] })
  assert.deepEqual(settings.lists, [])
})

test('주소가 아닌 것과 중복은 걸러내고 상한을 지킨다', () => {
  const settings = migrate({
    lists: [
      { url: DEFAULT_LIST_URL, enabled: true },
      { url: DEFAULT_LIST_URL, enabled: false },
      { url: 'javascript:alert(1)', enabled: true },
      { url: 'file:///etc/passwd', enabled: true },
      { url: 42, enabled: true },
      ...Array.from({ length: 20 }, (_, i) => ({ url: `https://e.com/${i}.json`, enabled: true })),
    ],
  })

  assert.equal(settings.lists.filter((l) => l.url === DEFAULT_LIST_URL).length, 1, '중복 하나만')
  assert.ok(!settings.lists.some((l) => l.url.startsWith('javascript:')))
  assert.ok(!settings.lists.some((l) => l.url.startsWith('file:')))
  assert.equal(settings.lists.length, MAX_LISTS)
})

test('예전 캐시 한 덩어리도 읽어낸다', () => {
  const list = { name: 'x', version: 1, updatedAt: '', rules: { hide: {}, prune: [], click: [], allow: [] } }
  const old = { url: DEFAULT_LIST_URL, fetchedAt: 1, list, dropped: 0, error: null }

  assert.deepEqual(readCaches(old), { [DEFAULT_LIST_URL]: old }, '단일 캐시는 URL 로 색인된다')
  assert.deepEqual(readCaches({ [DEFAULT_LIST_URL]: old }), { [DEFAULT_LIST_URL]: old })
  assert.deepEqual(readCaches(null), {})
  assert.deepEqual(readCaches({ [DEFAULT_LIST_URL]: { nonsense: true } }), {}, '망가진 항목은 버린다')
})

function listWith(over: Partial<FilterList>): FilterList {
  return {
    name: 'l',
    version: 1,
    updatedAt: '',
    rules: { hide: {}, prune: [], click: [], allow: [] },
    ...over,
  }
}

test('여러 리스트의 규칙이 합쳐지고, allow 는 리스트를 가로질러 적용된다', () => {
  const a = listWith({ rules: { hide: { generalAds: ['.from-a'] }, prune: [], click: [], allow: [] } })
  const b = listWith({
    // b 가 a 의 규칙을 오탐으로 지목한다. 사이트가 깨진 사람은 어느 리스트가
    // 깨뜨렸는지 모르므로, 예외는 전체에 걸려야 한다.
    rules: { hide: { generalAds: ['.from-b'] }, prune: [], click: [], allow: ['.from-a'] },
  })
  const resolved = resolveRules([a, b], [])

  assert.ok(resolved.hide.generalAds?.includes('.from-b'))
  assert.ok(!resolved.hide.generalAds?.includes('.from-a'), '다른 리스트의 allow 도 먹어야 한다')
})

test('호스트 규칙은 자기 그룹 스위치와 자기 언어에만 붙는다', () => {
  const korean = listWith({
    lang: 'ko',
    rules: {
      hide: {},
      domains: { genericAds: { 'example.kr': ['.kr-ad'] } },
      prune: [],
      click: [],
      allow: [],
    },
  })
  const cookies = listWith({
    rules: {
      hide: {},
      domains: { cookieBanners: { 'example.kr': ['.cookie-wall'] } },
      prune: [],
      click: [],
      allow: [],
    },
  })
  const resolved = resolveRules([korean, cookies], [])
  const toggles = { ...DEFAULT_SETTINGS.toggles }

  const ko = buildStylesheet(resolved, toggles, 'generic', 'example.kr', 'ko')
  assert.ok(ko.includes('.kr-ad'), '한국어에서는 한국 리스트의 호스트 규칙이 붙는다')
  assert.ok(ko.includes('.cookie-wall'), '언어를 안 밝힌 리스트는 어디서나 붙는다')

  const en = buildStylesheet(resolved, toggles, 'generic', 'example.kr', 'en')
  assert.ok(!en.includes('.kr-ad'), '영어에서는 한국 사이트 규칙을 들고 다니지 않는다')
  assert.ok(en.includes('.cookie-wall'), '쿠키 규칙은 언어와 무관하다')

  const off = buildStylesheet(resolved, { ...toggles, cookieBanners: false }, 'generic', 'example.kr', 'ko')
  assert.ok(off.includes('.kr-ad'), '광고 스위치는 그대로다')
  assert.ok(!off.includes('.cookie-wall'), '쿠키 스위치를 끄면 쿠키 규칙만 빠진다')
})

test('예전 평면 domains 도 광고 그룹으로 읽는다', () => {
  const legacy = listWith({
    rules: {
      hide: {},
      // 그룹이 생기기 전 형식: 키가 곧 호스트다.
      domains: { 'example.kr': ['.legacy-ad'] } as never,
      prune: [],
      click: [],
      allow: [],
    },
  })
  const css = buildStylesheet(
    resolveRules([legacy], []),
    DEFAULT_SETTINGS.toggles,
    'generic',
    'example.kr',
    'ko',
  )
  assert.ok(css.includes('.legacy-ad'))
})
