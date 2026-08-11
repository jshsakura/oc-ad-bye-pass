// Tests for the remote list validator. This is the only code in the extension
// sitting on a trust boundary, so it is written as pure functions that run
// without a browser.
//
//   node --test tests/
//
// With no document available, defaultCanParseSelector only gets as far as the
// character checks — the real parse check runs again in resolveRules inside the
// content script.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_CLICK_SELECTORS,
  MAX_LIST_BYTES,
  buildStylesheet,
  isSafePrunePath,
  isSafeSelector,
  parseFilterList,
  resolveRules,
  validateFilterList,
  type FilterList,
} from '../src/shared/filterlist.ts'
import { BUNDLED_CLICK, BUNDLED_HIDE } from '../src/shared/selectors.ts'
import { DEFAULT_SETTINGS, TOGGLE_KEYS } from '../src/shared/settings.ts'

function listWith(rules: Record<string, unknown>, version = 1) {
  return { name: 'test', version, updatedAt: '2026-08-10', rules }
}

test('정상 리스트를 통과시킨다', () => {
  const result = validateFilterList(
    listWith({
      hide: { generalAds: ['ytd-ad-slot-renderer', '#masthead-ad'] },
      prune: ['adPlacements', 'playerConfig.adConfig'],
      allow: [],
    }),
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.list.rules.hide.generalAds, ['ytd-ad-slot-renderer', '#masthead-ad'])
  assert.deepEqual(result.list.rules.prune, ['adPlacements', 'playerConfig.adConfig'])
  assert.equal(result.dropped.length, 0)
})

test('스타일시트를 탈출하려는 셀렉터는 버린다', () => {
  const evil = [
    'a { } body { display: none }',
    '@import url(https://evil.example/x.css)',
    'div /* comment */ span',
    'a<b',
    'a; b',
  ]
  for (const selector of evil) {
    assert.equal(isSafeSelector(selector), false, `허용되면 안 됨: ${selector}`)
  }

  const result = validateFilterList(listWith({ hide: { generalAds: [...evil, 'ytd-ad-slot-renderer'] } }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  // Only the bad ones are dropped; the sound one survives
  assert.deepEqual(result.list.rules.hide.generalAds, ['ytd-ad-slot-renderer'])
  assert.equal(result.dropped.length, evil.length)
})

test('제어문자가 든 셀렉터를 버린다', () => {
  const withNul = `ytd-ad-slot-renderer${String.fromCharCode(0)}`
  assert.equal(isSafeSelector(withNul), false)
  assert.equal(isSafeSelector(`a${String.fromCharCode(10)}b`), false)
})

test('프루닝 경로는 점으로 이은 식별자만 받는다', () => {
  assert.equal(isSafePrunePath('adPlacements'), true)
  assert.equal(isSafePrunePath('playerConfig.adConfig'), true)
  assert.equal(isSafePrunePath('a.__proto__.b'), false)
  assert.equal(isSafePrunePath('constructor'), false)
  assert.equal(isSafePrunePath('prototype'), false)
  assert.equal(isSafePrunePath('a-b'), false)
  assert.equal(isSafePrunePath('a b'), false)
  assert.equal(isSafePrunePath('a.'), false)
  assert.equal(isSafePrunePath(42), false)
})

test('알 수 없는 hide 그룹은 무시한다', () => {
  const result = validateFilterList(
    listWith({ hide: { generalAds: ['#masthead-ad'], nopeNotAGroup: ['body'] } }),
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(Object.keys(result.list.rules.hide), ['generalAds'])
  assert.ok(result.dropped.some((d) => d.includes('nopeNotAGroup')))
})

test('version 이 캐시본보다 낮으면 거부한다 (롤백 방지)', () => {
  const older = validateFilterList(listWith({ hide: {} }, 3), { minVersion: 5 })
  assert.equal(older.ok, false)

  const newer = validateFilterList(listWith({ hide: {} }, 7), { minVersion: 5 })
  assert.equal(newer.ok, true)
})

test('version 이 정수가 아니면 거부한다', () => {
  assert.equal(validateFilterList(listWith({ hide: {} }, 1.5)).ok, false)
  assert.equal(validateFilterList({ rules: { hide: {} } }).ok, false)
  assert.equal(validateFilterList({ version: 1 }).ok, false)
  assert.equal(validateFilterList([]).ok, false)
  assert.equal(validateFilterList(null).ok, false)
})

test('크기 상한을 넘는 리스트는 파싱 전에 거부한다', () => {
  const huge = JSON.stringify(
    listWith({ hide: { generalAds: [`a${'b'.repeat(MAX_LIST_BYTES)}`] } }),
  )
  const result = parseFilterList(huge)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /너무 큽니다/)
})

test('망가진 JSON 은 예외 없이 실패를 돌려준다', () => {
  const result = parseFilterList('{ not json')
  assert.equal(result.ok, false)
})

test('번들 규칙과 원격 규칙을 합치고 allow 로 뺀다', () => {
  const remote: FilterList = {
    name: 'r',
    version: 2,
    updatedAt: '',
    rules: {
      hide: { generalAds: ['ytd-brand-new-ad-renderer'] },
      prune: ['newAdField'],
      click: [],
      // Switch off one of the bundled rules via an exception
      allow: ['#masthead-ad'],
    },
  }
  const resolved = resolveRules(remote, ['my-own-ad-thing'])

  assert.ok(resolved.hide.generalAds?.includes('ytd-brand-new-ad-renderer'), '원격 규칙이 들어와야 한다')
  assert.ok(resolved.hide.generalAds?.includes('ytd-ad-slot-renderer'), '번들 규칙이 남아야 한다')
  assert.ok(!resolved.hide.generalAds?.includes('#masthead-ad'), 'allow 에 든 건 빠져야 한다')
  assert.deepEqual(resolved.custom, ['my-own-ad-thing'])
  assert.ok(resolved.prune.includes('adPlacements') && resolved.prune.includes('newAdField'))
})

test('원격 리스트가 없어도 번들 규칙만으로 동작한다', () => {
  const resolved = resolveRules(null, [])
  assert.deepEqual(resolved.hide.generalAds, BUNDLED_HIDE.generalAds)
})

test('켜진 그룹만, 셀렉터 하나당 규칙 하나로 스타일시트를 만든다', () => {
  const resolved = resolveRules(null, ['my-custom-ad'])
  const toggles = { ...DEFAULT_SETTINGS.toggles }
  for (const key of TOGGLE_KEYS) toggles[key] = false
  toggles.shortsAds = true

  const css = buildStylesheet(resolved, toggles)
  const lines = css.split('\n')

  assert.ok(lines.every((line) => line.endsWith('{ display: none !important; }')))
  assert.ok(css.includes('ytd-reel-video-renderer:has(ytd-ad-slot-renderer)'), 'shorts 그룹은 켜져 있다')
  assert.ok(!css.includes('#masthead-ad'), 'generalAds 는 꺼져 있어야 한다')
  assert.ok(css.includes('my-custom-ad'), '내 규칙은 토글과 무관하게 항상 들어간다')
})

// --- Findings from the adversarial review (regression guards) ----------------

test('페이지를 통째로 지우는 셀렉터는 거부한다', () => {
  // A compromised list would blank the page for every user, and it persists in
  // cache until the extension is switched off.
  for (const selector of ['*', 'html', ':root', 'body', 'head', 'HTML', ' * ']) {
    assert.equal(isSafeSelector(selector), false, `허용되면 안 됨: ${selector}`)
  }

  const result = validateFilterList(listWith({ hide: { generalAds: ['html', '#masthead-ad'] } }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.list.rules.hide.generalAds, ['#masthead-ad'])
})

test('remote lists never contribute click rules', () => {
  // A click rule makes us press a button as the user. The manifest match covers
  // studio.youtube.com, so an arbitrary click means channel/video deletion.
  //
  // A name-based allowlist was tried first and defeated: the attacker owns the
  // whole selector string, so they kept the target and appended a harmless
  // condition containing the magic word — `#danger:not([data-close])`.
  const result = validateFilterList(
    listWith({ hide: {}, click: ['#danger:not([data-close])', '.ytp-ad-overlay-close-button'] }),
  )
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.list.rules.click, [], 'no remote click rule survives')
  assert.ok(result.dropped.some((d) => d.startsWith('click:')), 'and the user is told')
})

test('resolved click rules come only from the bundle', () => {
  // An older build may have cached remote click rules, so the merge step
  // enforces this too rather than trusting validation alone.
  const remote: FilterList = {
    name: 'r',
    version: 2,
    updatedAt: '',
    rules: {
      hide: {},
      prune: [],
      click: ['#danger', '.something-close-button'],
      allow: [],
    },
  }
  const resolved = resolveRules(remote, [])
  assert.ok(!resolved.click.includes('#danger'))
  assert.ok(!resolved.click.includes('.something-close-button'), 'remote rule must not leak in')
  assert.deepEqual(resolved.click, BUNDLED_CLICK)
  assert.ok(resolved.click.length <= MAX_CLICK_SELECTORS)
})

test('selectors that blank the page are rejected even without touching the root', () => {
  // `body > *` and `div` never match html/body themselves, so a root check
  // lets them through — and they empty the document anyway.
  for (const selector of ['body > *', 'body *', 'div', 'span', '* > *', 'html > body > *']) {
    assert.equal(isSafeSelector(selector), false, `must be rejected: ${selector}`)
  }

  // Real ad selectors keep working: the subject carries an id, class,
  // attribute, or a custom-element name.
  for (const selector of [
    '#masthead-ad',
    '.ytp-ad-overlay-slot',
    'ytd-ad-slot-renderer',
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'div[class*="advert"]',
    '[id^="google_ads"]',
  ]) {
    assert.equal(isSafeSelector(selector), true, `must be allowed: ${selector}`)
  }
})

test('전부 꺼져 있고 내 규칙도 없으면 빈 스타일시트', () => {
  const toggles = { ...DEFAULT_SETTINGS.toggles }
  for (const key of TOGGLE_KEYS) toggles[key] = false
  assert.equal(buildStylesheet(resolveRules(null, []), toggles), '')
})
