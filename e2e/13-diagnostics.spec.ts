// The diagnostics panel.
//
// It exists because the target device answers nothing. Orion on iOS refuses a
// package with one line and no reason, and every question after that — did the
// MAIN world registration take, is there a PiP entry point, is the network layer
// even present — cost a full round trip through a person with a phone.
//
// Which makes this panel load-bearing, and makes it worth testing: a panel that
// reports confidently and wrongly is worse than none, because the answer it
// gives is the one the next hour of work is spent on.

import { expect, test } from './fixtures.ts'
import { YOUTUBE_URL, installYouTubeFixture } from './youtube-fixture.ts'

test('확장이 자기 자신에 대해 사실을 말한다', async ({ context, extensionId }) => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.getByRole('button', { name: '진단' }).click()

  const text = await popup.locator('.diag pre').textContent()
  expect(text).toContain('oc-ad-bye-pass v')
  // Chrome 빌드다 — 네트워크 계층이 있어야 한다. 없다고 나오면 Orion 빌드를
  // 크롬에 깔았거나 매니페스트에서 키가 빠진 것이고, 둘 다 알아야 할 일이다.
  expect(text).toContain('네트워크 차단(DNR): 있음')
  expect(text).toContain('MAIN world 등록: 됨')
})

test('아무 페이지도 보고하지 않았으면 그렇다고 말한다', async ({ context, extensionId }) => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.getByRole('button', { name: '진단' }).click()

  // 확장 페이지만 열린 상태에서는 보고자가 없다. 빈 칸으로 두면
  // "확인해봤는데 아무 문제 없더라" 로 읽힌다.
  await expect(popup.locator('.diag pre')).toContainText('페이지: 읽지 못함')
})

test('유튜브를 한 번 열면 그 페이지의 사실이 담긴다', async ({ context, extensionId }) => {
  await installYouTubeFixture(context)
  const youtube = await context.newPage()
  await youtube.goto(YOUTUBE_URL)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.getByRole('button', { name: '진단' }).click()

  const panel = popup.locator('.diag pre')
  await expect(panel).toContainText('youtube.com')
  await expect(panel).toContainText('1계층 설치됨: 예')
  await expect(panel).toContainText(/비디오: [1-9]/)
  // 크로미움에는 표준 API 가 있다. 아이폰에서는 여기가 webkit 이어야 하고,
  // 없음 으로 나오면 그 기기에서 PiP 버튼은 붙지 않는다 — 그것이 알고 싶은 값이다.
  await expect(panel).toContainText(/PiP: (webkit|standard)/)
})
