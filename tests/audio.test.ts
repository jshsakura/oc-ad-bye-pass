// Which dubbing track to switch to.
//
// The player side of this is timing and cannot be tested without a player, but
// the choice itself is a function of the track list and the viewer's languages
// — and it is where the feature is wrong or right. The cases below are the ones
// that would actually reach a child's screen.

import assert from 'node:assert/strict'
import test from 'node:test'
import { audioLangOf, chooseAudioTrack, isDescriptive, isSameTrack } from '../src/main/audio.ts'

const track = (lang: string, over: Record<string, unknown> = {}) => ({
  id: `251;${lang}`,
  languageInfo: { id: lang, name: lang },
  ...over,
})

test('내 언어 트랙이 있으면 그것을 고른다', () => {
  const tracks = [track('en-US', { isDefault: true }), track('ko'), track('ja')]
  assert.equal(audioLangOf(chooseAudioTrack(tracks, ['ko'])!), 'ko')
})

test('언어 순서를 지킨다', () => {
  const tracks = [track('en'), track('ja')]
  // 브라우저가 ko 를 먼저 원해도 없으면 다음 순위로 내려간다.
  assert.equal(audioLangOf(chooseAudioTrack(tracks, ['ko', 'ja', 'en'])!), 'ja')
})

test('내 언어 음성이 없으면 아무것도 바꾸지 않는다', () => {
  // "음성을 한국어로 고정" 이 "한국어가 없으면 아무거나로 바꿔라" 일 수는 없다.
  // 그 시점에서 플레이어가 고른 것이 이미 최선이다.
  assert.equal(chooseAudioTrack([track('en'), track('ja')], ['ko']), null)
})

test('화면 해설 트랙은 절대 고르지 않는다', () => {
  // 같은 언어의 진짜 트랙이라 언어만 보면 걸린다. 아이에게 화면 해설을
  // 틀어 주는 것은 안 바꾸느니만 못하다.
  const tracks = [
    track('en'),
    track('ko', { displayName: 'Korean (descriptive)' }),
    track('ko', { displayName: '한국어' }),
  ]
  const picked = chooseAudioTrack(tracks, ['ko'])!
  assert.equal(picked.displayName, '한국어')

  // 그것뿐이면 안 고른다.
  assert.equal(
    chooseAudioTrack([track('en'), track('ko', { displayName: '한국어 화면 해설' })], ['ko']),
    null,
  )
})

test('같은 언어가 여럿이면 원본으로 표시된 것을 고른다', () => {
  const dub = track('ko', { displayName: 'a' })
  const original = track('ko', { displayName: 'b', isDefault: true })
  assert.equal(chooseAudioTrack([track('en'), dub, original], ['ko']), original)
})

test('언어를 languageInfo 로도, id 안의 base64 로도 읽는다', () => {
  assert.equal(audioLangOf({ languageInfo: { id: 'ko-KR' } }), 'ko')
  // 플레이어가 쓰는 id 형식: `251;<base64("lang=ko")>`, URL 인코딩된 채로 온다.
  const encoded = encodeURIComponent(Buffer.from('lang=ko').toString('base64'))
  assert.equal(audioLangOf({ id: `251;${encoded}` }), 'ko')
  assert.equal(audioLangOf({ id: 'no-semicolon' }), null)
  assert.equal(audioLangOf({}), null)
})

test('화면 해설 판별은 영어와 한국어 표기를 모두 본다', () => {
  assert.equal(isDescriptive({ displayName: 'English descriptive' }), true)
  assert.equal(isDescriptive({ languageInfo: { id: 'ko', name: '한국어 화면 해설' } }), true)
  assert.equal(isDescriptive({ displayName: '한국어' }), false)
})

test('이미 그 트랙이면 갈아끼우지 않는다', () => {
  const a = track('ko')
  assert.equal(isSameTrack(a, { ...a }), true, 'id 가 같으면 같은 트랙')
  assert.equal(isSameTrack(a, track('en')), false)
  assert.equal(isSameTrack(null, a), false)
  // id 가 없으면 언어로 비교한다.
  assert.equal(isSameTrack({ languageInfo: { id: 'ko' } }, { languageInfo: { id: 'ko-KR' } }), true)
})
