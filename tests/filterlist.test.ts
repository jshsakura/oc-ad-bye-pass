// 원격 리스트 검증기 테스트. 이 확장에서 신뢰 경계에 있는 유일한 코드라서
// 브라우저 없이 돌 수 있게 순수 함수로 짜 두었다.
//
//   node --test tests/
//
// document 가 없는 환경이므로 defaultCanParseSelector 는 문자 검사까지만 한다
// (실제 파싱 검사는 콘텐츠 스크립트의 resolveRules 가 한 번 더 한다).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_CLICK_SELECTORS,
  MAX_LIST_BYTES,
  buildStylesheet,
  isSafeClickSelector,
  isSafePrunePath,
  isSafeSelector,
  parseFilterList,
  resolveRules,
  validateFilterList,
  type FilterList,
} from '../src/shared/filterlist.ts'
import { BUNDLED_HIDE } from '../src/shared/selectors.ts'
import { DEFAULT_SETTINGS, TOGGLE_KEYS } from '../src/shared/settings.ts'

function listWith(rules: Record<string, unknown>, version = 1) {
  return { name: 'test', version, updatedAt: '2026-08-10', rules }
}

test('정상 리스트를 통과시킨다', () => {
  const result = validateFilterList(
    listWith({
      hide: { generalAds: ['ytd-ad-slot-renderer', '#masthead-ad'] },
      prune: ['adPlacements', 'playerConfig.adConfig'],
      click: ['.ytp-ad-overlay-close-button'],
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
  // 나쁜 것만 빠지고 멀쩡한 건 살아남는다
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
      // 번들에 있던 규칙 하나를 예외로 끈다
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

// --- 적대적 리뷰에서 나온 것들 (회귀 방지) ---------------------------------

test('페이지를 통째로 지우는 셀렉터는 거부한다', () => {
  // 리스트가 털리면 전 사용자의 페이지가 백지가 되고, 캐시에 남아서
  // 확장을 끄기 전에는 돌아오지 않는다.
  for (const selector of ['*', 'html', ':root', 'body', 'head', 'HTML', ' * ']) {
    assert.equal(isSafeSelector(selector), false, `허용되면 안 됨: ${selector}`)
  }

  const result = validateFilterList(listWith({ hide: { generalAds: ['html', '#masthead-ad'] } }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.list.rules.hide.generalAds, ['#masthead-ad'])
})

test('누를 수 있는 셀렉터는 닫기/건너뛰기 뜻이 있어야 한다', () => {
  // click 은 숨기는 게 아니라 사용자 대신 누른다. 매니페스트 매치에
  // studio.youtube.com 이 포함되므로 임의 버튼을 누를 수 있으면 영상·채널 삭제까지 된다.
  assert.equal(isSafeClickSelector('.ytp-ad-overlay-close-button'), true)
  assert.equal(isSafeClickSelector('.ytp-ad-skip-button-modern'), true)

  for (const evil of ['#danger', '#confirm-button', 'button.delete', 'tp-yt-paper-button']) {
    assert.equal(isSafeClickSelector(evil), false, `허용되면 안 됨: ${evil}`)
  }
})

test('악성 리스트의 click 규칙은 걸러지고 개수도 조인다', () => {
  const many = Array.from({ length: 100 }, (_, i) => `.ad-close-${i}`)
  const result = validateFilterList(
    listWith({ hide: {}, click: ['#danger', ...many] }),
  )
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.ok(!result.list.rules.click.includes('#danger'), '의도 없는 셀렉터는 빠져야 한다')
  assert.equal(result.list.rules.click.length, MAX_CLICK_SELECTORS)
  // sweep 이 셀렉터마다 문서 전체를 훑기 때문에 개수 상한이 곧 성능 상한이다
  assert.ok(MAX_CLICK_SELECTORS <= 50)
})

test('병합 결과의 click 도 상한과 검사를 다시 통과한다', () => {
  // 캐시에 예전 규칙이 남아 있을 수 있고, 서비스 워커에는 DOM 이 없어서
  // 저장 시점에는 실제 매칭 검사를 못 했다.
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
  assert.ok(resolved.click.includes('.something-close-button'))
  assert.ok(resolved.click.length <= MAX_CLICK_SELECTORS)
})

test('전부 꺼져 있고 내 규칙도 없으면 빈 스타일시트', () => {
  const toggles = { ...DEFAULT_SETTINGS.toggles }
  for (const key of TOGGLE_KEYS) toggles[key] = false
  assert.equal(buildStylesheet(resolveRules(null, []), toggles), '')
})
