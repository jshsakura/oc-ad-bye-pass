// The decision behind automatic picture-in-picture.
//
// The behaviour itself — leave the tab, the video hands itself to a small
// window — cannot be driven end to end here: a headless Chromium keeps every
// page visible, and none of Page.setWebLifecycleState,
// Emulation.setPageVisibility or setFocusEmulationEnabled moves document.hidden
// off `false`. So the branch that decides is a function, and this covers it;
// e2e/11 covers everything either side of it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldAutoPip } from '../src/isolated/pip.ts'

const playing = { paused: false, ended: false }

test('탭이 앞에 있으면 넘기지 않는다', () => {
  assert.equal(shouldAutoPip({ hidden: false, video: playing }), false)
})

test('숨겨졌고 재생 중이면 넘긴다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: playing }), true)
})

test('영상이 없으면 넘길 것도 없다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: null }), false)
})

test('멈춰 있는 영상은 넘기지 않는다', () => {
  // 떠 있을 이유가 없는 창이 사용자가 하러 간 일 위에 남는다.
  assert.equal(shouldAutoPip({ hidden: true, video: { paused: true, ended: false } }), false)
})

test('끝난 영상도 넘기지 않는다', () => {
  assert.equal(shouldAutoPip({ hidden: true, video: { paused: false, ended: true } }), false)
})

// 돌아왔을 때 되돌릴지 — 나갈 때만큼이나 조심할 곳이다. 사용자가 스스로 전체화면으로
// 본 것을 확장이 멋대로 접으면 그건 기능이 아니라 훼방이다.
import { shouldRestoreInline } from '../src/isolated/pip.ts'

test('우리가 넘긴 것만 되돌린다', () => {
  assert.equal(
    shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'picture-in-picture' }),
    true,
  )
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'fullscreen' }), true)
})

test('사용자가 직접 전체화면으로 본 것은 건드리지 않는다', () => {
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: false, mode: 'fullscreen' }), false)
})

test('아직 안 돌아왔으면 되돌리지 않는다', () => {
  assert.equal(
    shouldRestoreInline({ visible: false, engagedByUs: true, mode: 'picture-in-picture' }),
    false,
  )
})

test('이미 인라인이면 할 일이 없다', () => {
  assert.equal(shouldRestoreInline({ visible: true, engagedByUs: true, mode: 'inline' }), false)
})

// 어떤 호출을 할지는 탭 안에서 정해져야 한다.
//
// iOS 에서 작은 창도 전체화면도 사용자 제스처를 요구하는데, 첫 호출이 먹었는지
// 알아보려면 기다려야 하고, 기다리고 나면 제스처가 없다. 900ms 뒤에 부른
// 전체화면은 거절당하면서 화면에는 "전체화면으로 넘겼습니다" 만 남았다.
// 그래서 폴백은 다음 탭이 하고, 그 판단이 이 함수다.
import { chooseEntry } from '../src/isolated/pip.ts'

const ios = { webkit: true, standard: false, fullscreen: true }

test('아이폰에서는 webkit 경로가 먼저다', () => {
  assert.equal(chooseEntry({ preferFullscreen: false, supported: true, ...ios }), 'webkit')
})

test('이 영상은 안 된다고 하면 호출을 낭비하지 않는다', () => {
  // webkitSupportsPresentationMode 가 false 면 아무리 불러도 창은 안 열린다.
  // 남은 제스처 한 번을 전체화면에 쓴다 — 아이폰이 스스로 띄워주는 상태다.
  assert.equal(chooseEntry({ preferFullscreen: false, supported: false, ...ios }), 'fullscreen')
})

test('한 번 무응답이었으면 다음 탭은 전체화면이다', () => {
  assert.equal(chooseEntry({ preferFullscreen: true, supported: true, ...ios }), 'fullscreen')
})

test('크로미움에는 표준 API 만 있다', () => {
  assert.equal(
    chooseEntry({
      preferFullscreen: false,
      supported: undefined,
      webkit: false,
      standard: true,
      fullscreen: false,
    }),
    'standard',
  )
})

test('아무 진입점도 없으면 없다고 한다', () => {
  assert.equal(
    chooseEntry({
      preferFullscreen: false,
      supported: undefined,
      webkit: false,
      standard: false,
      fullscreen: false,
    }),
    'none',
  )
})

// 나가는 순간의 멈춤은 누구 것인가.
//
// 기기 로그가 알려준 사실: 나가는 신호가 도착할 때 영상은 이미 멈춰 있다. WebKit 이
// 앱을 백그라운드로 보내면서 엔진 레벨에서 먼저 세우기 때문이다. 그래서 "멈춰 있으면
// 넘어간다" 는 판단은 매번 걸렸다.
//
// 그렇다고 아무 멈춤이나 되살리면, 직접 멈추고 나간 사람의 영상이 그 사람이 하러 간
// 일 위에서 다시 재생된다. 그 둘을 가르는 것이 이 함수다.
import { shouldResumeOnLeave } from '../src/isolated/pip.ts'

const now = 1_000_000

test('엔진이 세운 것이면 되살린다 — 이미 숨겨진 뒤에 멈췄다', () => {
  assert.equal(
    shouldResumeOnLeave({ now, pausedAt: now - 10, pausedWhileHidden: true, lastPlayingAt: now - 50 }),
    true,
  )
})

test('나가는 것과 같은 순간에 멈췄으면 되살린다', () => {
  assert.equal(
    shouldResumeOnLeave({ now, pausedAt: now - 100, pausedWhileHidden: false, lastPlayingAt: now - 200 }),
    true,
  )
})

test('보면서 멈춘 것은 건드리지 않는다', () => {
  // 멈추고 나간 사람의 영상이 다시 켜지면 그건 기능이 아니라 참견이다.
  assert.equal(
    shouldResumeOnLeave({ now, pausedAt: now - 3000, pausedWhileHidden: false, lastPlayingAt: now - 3200 }),
    false,
  )
})

test('한참 전에 멈춘 영상은 되살릴 것이 없다', () => {
  assert.equal(
    shouldResumeOnLeave({ now, pausedAt: now - 60_000, pausedWhileHidden: true, lastPlayingAt: now - 60_000 }),
    false,
  )
})

test('한 번도 재생된 적 없으면 아무것도 안 한다', () => {
  assert.equal(
    shouldResumeOnLeave({ now, pausedAt: 0, pausedWhileHidden: false, lastPlayingAt: 0 }),
    false,
  )
})

// 돌아왔을 때 어디로 되돌릴 것인가.
//
// 인라인이 언제나 정답은 아니다. 전체화면으로 보다가 나갔다 온 사람에게 페이지에
// 둘러싸인 작은 플레이어를 돌려주는 것은, 어떻게 볼지를 확장이 대신 정하는 것이다.
import { modeToRestore } from '../src/isolated/pip.ts'

test('인라인으로 보다 나갔으면 인라인으로 돌아온다', () => {
  assert.equal(modeToRestore({ before: 'inline', current: 'picture-in-picture' }), 'inline')
})

test('전체화면으로 보다 나갔으면 전체화면으로 돌아온다', () => {
  assert.equal(modeToRestore({ before: 'fullscreen', current: 'picture-in-picture' }), 'fullscreen')
})

test('이미 제자리면 건드리지 않는다', () => {
  assert.equal(modeToRestore({ before: 'inline', current: 'inline' }), null)
})

test('작은 창도 전체화면도 아닌 상태는 우리 것이 아니다', () => {
  assert.equal(modeToRestore({ before: 'inline', current: undefined }), null)
})

test('기록이 없으면 인라인이 기본이다', () => {
  assert.equal(modeToRestore({ before: null, current: 'picture-in-picture' }), 'inline')
})

// 나가는 손짓.
//
// 버튼이 되는 이유는 탭이 사용자 제스처를 들고 있기 때문이고, 나가는 순간에는 그것이
// 없다. 그런데 아이폰에서 앱을 나가기 직전에 사람이 실제로 하는 동작이 하나 있다 —
// 화면 맨 아래에서 위로 쓸어올리기. 그 터치는 시스템이 가져가기 전에 페이지에 먼저
// 닿으므로, 나가기 전 마지막으로 창을 요청할 수 있는 순간이다.
//
// 좁게 잡는다. 아래 가장자리에서 시작해야 하고, 위로 가야 하고, 옆보다 위로 더 가야
// 한다 — 페이지 스크롤은 거기서 시작하지 않고, 가로 스와이프는 다른 뜻이다.
import { isHomeSwipe } from '../src/isolated/pip.ts'

test('아래 가장자리에서 위로 쓸어올리면 나가는 손짓이다', () => {
  assert.equal(isHomeSwipe({ fromBottom: 10, up: 60, sideways: 8 }), true)
})

test('화면 한가운데서 시작한 스크롤은 아니다', () => {
  assert.equal(isHomeSwipe({ fromBottom: 300, up: 60, sideways: 5 }), false)
})

test('살짝 움직인 것은 아직 아니다', () => {
  assert.equal(isHomeSwipe({ fromBottom: 8, up: 9, sideways: 2 }), false)
})

test('옆으로 더 갔으면 다른 뜻이다', () => {
  // 아래 가장자리의 가로 스와이프는 탭 전환이지 나가는 것이 아니다.
  assert.equal(isHomeSwipe({ fromBottom: 8, up: 30, sideways: 90 }), false)
})
