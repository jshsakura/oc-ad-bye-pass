// Which language a reader gets, and what they see when it has a gap.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BASE_LANG,
  CATALOGS_FOR_TESTS as CATALOGS,
  LANGS,
  LANG_LABEL,
  makeT,
  pickLang,
} from '../src/shared/i18n.ts'
import { en } from '../src/shared/locales/en.ts'
import { ko } from '../src/shared/locales/ko.ts'

test('영어가 기준이고, 모든 언어에 이름이 있다', () => {
  assert.equal(BASE_LANG, 'en')
  assert.ok(LANGS.includes('en'))
  // A language in the picker with no name in it is a blank row.
  for (const lang of LANGS) assert.ok(LANG_LABEL[lang], `${lang} 이름 없음`)
})

test('번역이 빠지면 영어로 나온다 — 한국어가 아니라', () => {
  // The gap is what matters: whoever reads it is by definition not served by
  // the language it fell back from.
  for (const lang of LANGS) {
    const t = makeT(lang)
    const catalog = CATALOGS[lang] as Record<string, string | undefined>
    for (const key of Object.keys(en)) {
      const expected = catalog[key] ?? en[key as keyof typeof en]
      assert.equal(t(key as never), expected, `${lang} · ${key}`)
    }
  }
  // A gap really does come out in English, not in whatever came first.
  const t = makeT('ko')
  for (const key of Object.keys(en).filter((k) => !(k in ko))) {
    assert.equal(t(key as never), en[key as keyof typeof en], `${key} 가 영어로 안 떨어짐`)
  }
})

test('모든 언어가 모든 키를 갖고 있고, 남는 키는 없다', () => {
  // A locale may legitimately be partial — but one that is *meant* to be whole
  // and quietly lost a key would show English in the middle of a sentence, and
  // nothing else would notice. A key that exists only in a translation is dead
  // weight: nothing reads it.
  const base = Object.keys(en)
  for (const lang of LANGS) {
    const keys = Object.keys(CATALOGS[lang])
    assert.deepEqual(
      base.filter((k) => !keys.includes(k)),
      [],
      `${lang} 에 빠진 키`,
    )
    assert.deepEqual(
      keys.filter((k) => !base.includes(k)),
      [],
      `${lang} 에만 있는 키`,
    )
  }
})

test('플레이스홀더는 언어가 바뀌어도 살아남는다', () => {
  // `{n}`, `{host}`, `{v}` are filled in at runtime. A translator who drops one
  // leaves a sentence with a hole in it, and one who invents another leaves
  // literal braces on screen — neither shows up until someone reads that line.
  const holders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',')
  for (const lang of LANGS) {
    const catalog = CATALOGS[lang] as Record<string, string | undefined>
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const other = catalog[key]
      if (other === undefined) continue
      assert.equal(holders(other), holders(en[key]), `${lang} · ${key} 의 {변수} 가 어긋났다`)
    }
  }
})

test('브라우저 언어를 순서대로 따른다', () => {
  assert.equal(pickLang(['ko-KR', 'en-US'], ['en', 'ko']), 'ko')
  assert.equal(pickLang(['en-GB'], ['en', 'ko']), 'en')
  // Exact beats loose, and an earlier preference beats a later one: someone
  // asking for pt-BR first must not be handed English on a loose match.
  assert.equal(pickLang(['pt-BR', 'en'], ['en', 'pt-BR', 'pt']), 'pt-BR')
  assert.equal(pickLang(['pt-PT', 'en'], ['en', 'pt']), 'pt')
})

test('지원하지 않는 언어는 null 이고, 부르는 쪽이 기준 언어로 떨어뜨린다', () => {
  assert.equal(pickLang(['sw', 'am'], ['en', 'ko']), null)
  assert.equal(pickLang([], ['en', 'ko']), null)
  assert.equal(pickLang([''], ['en', 'ko']), null)
})

test('은퇴한 언어가 설정에 남아 있어도 죽지 않는다', () => {
  // A setting outlives the version that wrote it.
  const t = makeT('xx' as never)
  assert.equal(t('popup.foot.settings'), en['popup.foot.settings'])
})
