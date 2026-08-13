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
import { modeToRestore } from '../src/isolated/pip.ts'

// 나갈 때의 판단은 전부 사라졌다.
//
// shouldAutoPip · shouldResumeOnLeave · isHomeSwipe 는 모두 "앱을 나가는 순간
// 영상을 작은 창으로 넘긴다" 를 위한 것이었다. 그건 이 플랫폼에서 불가능하다 —
// WebKit 은 살아있는 사용자 제스처 안에서만 창을 열어주고, 나가는 순간에는 그것이
// 없다. 실기기에서 하루치로 확인했고, 두 곳에서 독립적으로 같은 답을 받았고,
// 애플이 직접 답한 문서도 있다. 그 판단들을 지키는 것은 없는 기능을 지키는 것이다.
//
// 남은 것은 버튼(매번 열린다)과, 돌아왔을 때 어디로 되돌릴지 하나뿐이다.

// 돌아왔을 때 어디로 되돌릴 것인가.
//
// 인라인이 언제나 정답은 아니다. 전체화면으로 보다 나갔다 온 사람에게 페이지에
// 둘러싸인 작은 플레이어를 돌려주는 것은, 어떻게 볼지를 확장이 대신 정하는 것이다.

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
  assert.equal(modeToRestore({ before: null, current: 'picture-in-picture' }), null === null ? 'inline' : 'inline')
})
