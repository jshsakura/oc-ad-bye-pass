// Safari 폴백 — MAIN world 스크립트를 페이지에 직접 꽂는다.
//
// 정상 경로는 background/mainWorld.ts 의 registerContentScripts 다. 그게 실패했을
// 때(구버전 Safari, 권한 거부 등) 1계층이 통째로 죽는 것을 막는 마지막 수단이다.
//
// **이 경로는 정상 경로보다 느리다.** 확장 리소스라 로컬 로드이긴 하지만
// script-inserted 스크립트라 파서를 막지 못한다. 유튜브 인라인 스크립트가 먼저
// 돌면 ytInitialPlayerResponse 를 놓칠 수 있다 — 즉 첫 재생 광고가 샐 수 있다.
// 2·3계층은 그대로 동작하므로 "아무것도 안 막힘"보다는 낫다.
//
// Chrome 에서는 이 파일 전체가 번들에서 사라진다 (IS_SAFARI 가 상수 false).

import { INSTALLED_ATTR } from '../shared/messages.ts'

export function injectMainWorldFallback(): void {
  // 빌드 상수다 (shared/target.ts 참조). Chrome 빌드에서는 이 아래가 전부 사라진다.
  if (!__IS_SAFARI__) return
  // 정상 경로가 이미 훅을 걸었으면 할 일이 없다.
  if (document.documentElement?.hasAttribute(INSTALLED_ATTR)) return

  // 아직 안 걸렸다고 해서 실패했다는 뜻은 아니다 — 두 콘텐츠 스크립트의 실행 순서는
  // 보장되지 않으므로 MAIN 이 우리 다음일 수도 있다. 그래도 기다리지 않고 바로
  // 꽂는다. 늦게 거는 훅은 쓸모가 없고, 중복 실행은 main/index.ts 의 플래그가 막는다.
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('main.js')
  // script-inserted 기본값은 async=true 다. false 로 두면 삽입 순서대로 실행된다.
  script.async = false
  script.addEventListener('load', () => script.remove())
  script.addEventListener('error', () => {
    console.warn('[oc-ad-bye-pass] main.js 주입이 차단되었습니다 — 1계층이 동작하지 않습니다')
    script.remove()
  })

  const parent = document.head ?? document.documentElement
  parent.insertBefore(script, parent.firstChild)
}
