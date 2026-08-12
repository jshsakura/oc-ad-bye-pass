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



// 되돌리기의 판단은 함수에서 사라졌다.
//
// 네 가지가 같은 결정을 나눠 갖고 있었고 — 가시성 검사, 스스로 재무장하는 유예,
// 출발 모드와의 비교, 그리고 별도의 "무조건 되돌리기" 갈래 — 그것들이 서로 겹쳐서
// 창이 열린 지 0.25초 만에 창을 닫았다. 사람이 돌아왔다는 증거는 하나도 없이.
// 이제 규칙은 하나다: 포커스가 여기 있으면 영상도 여기 있어야 한다.

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

// 나가는 손짓의 판정은 사라졌다.
//
// 화면 맨 아래에서 위로 쓸어올리는 동작을 잡으려 했지만, 이 브라우저는 애초에
// 사용자 제스처를 요구하지 않았고(활성화=만료 상태로도 창이 열린다), 페이지는 그
// 터치를 받지도 못한다 — 한 세션 내내 센 터치 중 화면 아래에 가장 가까웠던 것이
// 477px 이었다. 맨 아래는 브라우저 툴바 몫이다.
