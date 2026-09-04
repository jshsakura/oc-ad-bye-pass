// PiP 버튼이 어디에 놓이는가.
//
// 이 계산이 틀리면 아이폰에서 검색창과 유튜브 자기 음소거 버튼 위에 36px 버튼이
// 앉습니다. 실제로 그렇게 됐고, 신고는 "소리를 켤 수가 없다" 로 왔습니다.
// 누를 수 없었던 게 아니라 우리 버튼을 누르고 있었던 겁니다.
//
// 산수라서 브라우저 없이 잠급니다.

import assert from 'node:assert/strict'
import test from 'node:test'
import { placeButton, playerOwnedByHost, type Rect } from '../src/isolated/pip.ts'

const SIZE = 36
const VIEW = { top: 0, bottom: 800, left: 0, right: 400 }
const rect = (top: number, height: number, left = 0, width = 400): Rect => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  height,
})

test('영상 오른쪽 아래 모서리에 놓는다', () => {
  const spot = placeButton(rect(100, 220), VIEW, SIZE)
  assert.deepEqual(spot, { top: 100 + 220 - SIZE - 3, left: 400 - SIZE - 3 })
})

test('영상이 화면 위로 밀려나면 붙이지 않는다', () => {
  // 예전에는 여기서 버튼을 뷰포트 맨 위로 끌어올렸다. m.youtube 에서 그 자리가
  // 검색창이다. 영상 밖에 놓느니 안 보이는 편이 낫다.
  assert.equal(placeButton(rect(-200, 220), VIEW, SIZE), null)
})

test('모서리가 화면 아래로 넘어가도 붙이지 않는다', () => {
  // 영상 위쪽은 보이지만 오른쪽 아래 모서리가 접힌 경우.
  assert.equal(placeButton(rect(700, 220), VIEW, SIZE), null)
})

test('버튼이 통째로 들어갈 때만 붙인다', () => {
  const view = { top: 0, bottom: 800, left: 0, right: 400 }
  // 버튼은 아래에서 3px 띄워 앉으므로, 영상 아래가 화면을 3px 넘어가는 데까지는
  // 버튼이 온전히 들어간다. 경계는 거기다.
  assert.notEqual(placeButton(rect(803 - 220, 220), view, SIZE), null)
  assert.equal(placeButton(rect(804 - 220, 220), view, SIZE), null)
})

test('썸네일처럼 작은 상자에는 안 붙인다', () => {
  assert.equal(placeButton(rect(100, 60), VIEW, SIZE), null)
  assert.equal(placeButton(null, VIEW, SIZE), null)
})

test('아이폰의 보이는 뷰포트를 기준으로 삼는다', () => {
  // 키보드가 올라오면 visualViewport 가 줄어든다. 레이아웃 뷰포트로 재면
  // 버튼이 키보드 뒤에 숨는다.
  const shrunk = { top: 0, bottom: 300, left: 0, right: 400 }
  assert.equal(placeButton(rect(100, 220), shrunk, SIZE), null)
  assert.notEqual(placeButton(rect(20, 220), shrunk, SIZE), null)
})

// ── 어느 영상에 붙일 것인가 ─────────────────────────────────────────────────
//
// "하나 재생될 때는 문제가 없고 여러 개면 이상하다" 는 신고가 이 점수표를
// 가리킵니다. 보이는지 여부가 아예 빠져 있어서, 검색 결과처럼 미리보기가
// 여럿인 페이지에서 화면 밖 영상이 이길 수 있었습니다.

import { pickVideo, videoScore, type VideoState } from '../src/isolated/pip.ts'

const v = (over: Partial<VideoState> = {}): VideoState => ({
  playing: false,
  started: false,
  ready: false,
  visibleHeight: 0,
  width: 300,
  ...over,
})

test('보이는 영상이 재생 중인 화면 밖 영상을 이긴다', () => {
  const offscreenPlaying = v({ playing: true, started: true, ready: true, visibleHeight: 0 })
  const onscreenIdle = v({ visibleHeight: 200 })
  assert.equal(pickVideo([offscreenPlaying, onscreenIdle], (x) => x), onscreenIdle)
})

test('둘 다 보이면 재생 중인 쪽을 고른다', () => {
  const idle = v({ visibleHeight: 200 })
  const playing = v({ visibleHeight: 200, playing: true })
  assert.equal(pickVideo([idle, playing], (x) => x), playing)
})

test('살짝 걸친 것은 보이는 것으로 치지 않는다', () => {
  // 80px 이 기준이다. 그보다 적게 걸친 것은 사실상 화면 밖이고, 거기 버튼을
  // 붙이면 클램프 없이도 엉뚱한 자리에 뜬다.
  const sliver = v({ visibleHeight: 40, playing: true, started: true, ready: true })
  const solid = v({ visibleHeight: 300 })
  assert.equal(pickVideo([sliver, solid], (x) => x), solid)
})

test('점수가 같으면 넓은 쪽', () => {
  const narrow = v({ visibleHeight: 200, width: 200 })
  const wide = v({ visibleHeight: 200, width: 500 })
  assert.equal(pickVideo([narrow, wide], (x) => x), wide)
})

test('하나뿐이면 무조건 그것 — 신고에서 문제가 없던 경우', () => {
  const only = v({ playing: true })
  assert.equal(pickVideo([only], (x) => x), only)
  assert.equal(pickVideo([], (x: VideoState) => x), null)
})

test('점수는 보이는 것이 나머지 전부를 합한 것보다 크다', () => {
  // 이 부등식이 깨지면 다시 화면 밖 영상이 이긴다.
  const everythingButVisible = videoScore(v({ playing: true, started: true, ready: true }))
  const visibleOnly = videoScore(v({ visibleHeight: 200 }))
  assert.ok(visibleOnly > everythingButVisible, `${visibleOnly} > ${everythingButVisible}`)
})

// ── 어느 화면에 붙일 것인가 ─────────────────────────────────────────────────
//
// 인라인 미리보기를 작은 화면으로 띄울 이유가 없습니다. 그리고 미리보기가
// 깔린 목록은 스크롤로 계속 움직이는 화면이라, 고정 버튼이 있을 자리가 아닙니다.

import { isWatchPage } from '../src/isolated/pip.ts'

test('시청 화면에서만 붙인다', () => {
  assert.equal(isWatchPage('https://m.youtube.com/watch?v=abc'), true)
  assert.equal(isWatchPage('https://www.youtube.com/watch?v=abc&t=10'), true)
  assert.equal(isWatchPage('https://www.youtube-nocookie.com/embed/abc'), true)
})

test('검색·피드·쇼츠에는 붙이지 않는다', () => {
  assert.equal(isWatchPage('https://m.youtube.com/results?search_query=x'), false)
  assert.equal(isWatchPage('https://m.youtube.com/'), false)
  assert.equal(isWatchPage('https://m.youtube.com/feed/subscriptions'), false)
  // 쇼츠는 플레이어 옷을 입은 피드다.
  assert.equal(isWatchPage('https://m.youtube.com/shorts/abc'), false)
})

test('유튜브가 아닌 곳에는 아예 붙지 않는다', () => {
  assert.equal(isWatchPage('https://example.com/watch'), false)
  assert.equal(isWatchPage('not a url'), false)
})

// ── 남이 화면을 가져갔을 때 ──────────────────────────────────────────────
//
// OC Easy Mode 가 유튜브 화면을 자기 UI 로 덮고 #movie_player 를 CSS 로 옮깁니다.
// 우리 버튼은 영상의 상자에서 자리를 계산하는데 그 상자를 옮기는 것이 상대라,
// UI 한가운데에 박히고 재생 상태가 바뀔 때마다 깜빡였습니다. 서로 조정해서 풀
// 수 있는 문제가 아니라 — 재는 대상을 상대가 움직이고 있으니 — 그릴지 말지의
// 문제입니다.

/** 최소한의 가짜 document. 이 판단에 필요한 세 가지만 답합니다. */
const fakeDoc = (opts: { styleId?: boolean; host?: boolean; attr?: boolean }): Document =>
  ({
    getElementById: (id: string) => (opts.styleId && id === 'oc-easy-mode' ? {} : null),
    querySelector: (sel: string) => (opts.host && sel === 'oc-easy-mode' ? {} : null),
    documentElement: { hasAttribute: (a: string) => !!opts.attr && a === 'data-oc-abp-no-pip' },
  }) as unknown as Document

test('아무도 화면을 가져가지 않았으면 버튼을 그린다', () => {
  assert.equal(playerOwnedByHost(fakeDoc({})), false)
})

test('이지 모드의 스타일 노드만 있어도 물러난다', () => {
  assert.equal(playerOwnedByHost(fakeDoc({ styleId: true })), true)
})

test('이지 모드의 섀도우 호스트만 있어도 물러난다', () => {
  // 둘 중 하나면 충분합니다. 한쪽만 보면 상대가 구성을 바꿀 때 조용히 되살아납니다.
  assert.equal(playerOwnedByHost(fakeDoc({ host: true })), true)
})

test('html 의 양보 속성으로도 물러난다 — 다음 확장은 우리 릴리스를 기다리지 않는다', () => {
  assert.equal(playerOwnedByHost(fakeDoc({ attr: true })), true)
})
