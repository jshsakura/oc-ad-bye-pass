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
  // 아직 나갔다 온 적이 없다. 빈 칸이나 "없음" 으로 두면 자동 전환이 시도됐다가
  // 실패한 것과 구분이 안 되는데, 그 둘은 고칠 곳이 다르다.

  // 그리고 기록. 폰에는 콘솔이 없고, 알고 싶은 순간은 앱을 나가 있는 동안이라
  // 그때 남길 수 있는 곳은 DOM 뿐이다 — 스토리지 쓰기는 얼어붙는 사이에 날아간다.
  await expect(panel).toContainText('--- 기록 ---')
  await expect(panel).toContainText('시작: youtube')
})

test('1계층이 늦게 붙어도 아니오로 굳지 않는다', async ({ context, extensionId }) => {
  await installYouTubeFixture(context)
  const youtube = await context.newPage()
  await youtube.goto(YOUTUBE_URL)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  const layer1Reported = () =>
    popup.evaluate(async () => {
      const got = await chrome.storage.local.get('diagnostics')
      return (got.diagnostics as { layer1: boolean } | undefined)?.layer1
    })

  // 주입 폴백에서 실제로 나는 순서를 만든다 — 리포트가 먼저 쓰이고 마커가
  // 나중에 붙는다. 마커를 떼고 설정을 건드리면 그 상태로 리포트가 다시 쓰인다.
  await youtube.evaluate(() => document.documentElement.removeAttribute('data-oc-ad-bye-pass'))
  // 팝업이 확장 페이지 위에서 열려 유튜브 전용 항목은 접혀 있다.
  await popup.getByRole('button', { name: '전체 항목 보기' }).click()
  await popup.getByRole('switch', { name: '작은 화면(PiP) 버튼' }).click()
  await expect.poll(layer1Reported, { message: '전제가 안 만들어졌다' }).toBe(false)

  // 늦게 도착한 1계층. 이걸 못 보고 넘어가면 멀쩡한 계층을 놓고 몇 시간을 쓴다.
  await youtube.evaluate(() => document.documentElement.setAttribute('data-oc-ad-bye-pass', '1'))
  await expect.poll(layer1Reported, { message: '늦게 붙은 1계층을 다시 보고하지 않았다' }).toBe(true)

  await popup.getByRole('button', { name: '진단' }).click()
  await expect(popup.locator('.diag pre')).toContainText('1계층 설치됨: 예')
})
