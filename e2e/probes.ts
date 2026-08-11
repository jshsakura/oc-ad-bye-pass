// 확장이 살아 있는지를 "지문"이 아니라 "실제로 광고를 막고 있는가"로 판정한다.
//
// 예전에는 window.__ocAdByePassInstalled 플래그와 <style id="oc-ad-bye-pass"> 를 보고
// 판정했는데, 그건 테스트가 편하려고 확장에 이름표를 달아둔 것이었다. 그 이름표는
// 유튜브 페이지 스크립트도 똑같이 읽을 수 있다 — 즉 탐지 지문이다. 지문을 없애기로
// 했으니 테스트도 흔적이 아니라 효과를 보도록 바꾼다.
//
// 덤으로 이게 더 나은 테스트다. 구현이 어떻게 바뀌든(스타일 태그, insertCSS,
// adoptedStyleSheets, MAIN world 등록이든 폴백 주입이든) "광고가 막히는가"만 본다.

import type { Page } from '@playwright/test'

/**
 * 1계층이 살아 있는가.
 * 페이지에서 광고 필드가 든 JSON 을 새로 파싱해 보고, 잘려 나오는지 확인한다.
 */
export function layer1Active(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const parsed = JSON.parse('{"adPlacements":[{}],"videoDetails":{"videoId":"probe"}}') as Record<
      string,
      unknown
    >
    return parsed.adPlacements === undefined && parsed.videoDetails !== undefined
  })
}

/**
 * 2계층이 살아 있는가.
 * 광고 렌더러 태그를 하나 만들어 붙였다가, 숨겨지는지 보고 즉시 치운다.
 *
 * 참고로 이건 유튜브가 광고 차단기를 탐지하는 바로 그 방법이기도 하다 —
 * 광고 요소를 그려놓고 높이가 0인지 확인한다. CSS 로 숨기는 이상 이건 못 피한다.
 * 그래서 1계층(광고를 아예 안 받기)이 주력이어야 한다.
 */
export function layer2Active(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probe = document.createElement('ytd-ad-slot-renderer')
    probe.textContent = 'probe'
    document.documentElement.appendChild(probe)
    const hidden = getComputedStyle(probe).display === 'none'
    probe.remove()
    return hidden
  })
}

/** 확장이 페이지에 전혀 개입하지 않는 상태인가 (유튜브 밖에서 기대하는 모습) */
export async function extensionInactive(page: Page): Promise<boolean> {
  return !(await layer1Active(page)) && !(await layer2Active(page))
}
