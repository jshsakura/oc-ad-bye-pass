// "YouTube 앱에서 보기" 유도 제거.
//
// 이건 광고가 아니라 앱 설치 유도지만, 모바일 웹에서 화면 위쪽을 계속 차지하고
// 확장이 동작하지 않는 앱으로 사용자를 밀어낸다는 점에서 차단 대상이 같다.
//
// 두 종류가 있고 대응이 다르다.
//
// 1. **Safari 스마트 앱 배너** — 페이지가 아니라 iOS Safari 가 직접 그린다.
//    `<meta name="apple-itunes-app">` 를 보고 그리므로 CSS 로는 절대 못 막고,
//    태그를 파서보다 먼저 지우는 수밖에 없다. 이 파일이 하는 일이다.
//
// 2. **유튜브가 직접 그리는 앱 유도 배너/토스트** — 평범한 DOM 이라 스타일시트로
//    처리한다. 셀렉터는 shared/selectors.ts 의 `appPromo` 그룹에 있다.
//
// 타이밍이 전부다. Safari 는 파싱 중에 meta 를 보고 배너를 띄우므로, index.ts 의
// rAF 스로틀을 태우면 배너가 한 번 번쩍이고 사라진다. 그래서 여기만 전용 옵저버로
// **동기적으로** 지운다. 비용은 head 의 childList 감시 하나뿐이다 (subtree 아님 —
// meta/link 는 head 의 직계 자식이다).

/** 스마트 앱 배너·앱 딥링크 힌트를 만드는 헤드 태그들 */
const HINT_SELECTORS = [
  'meta[name="apple-itunes-app"]',
  'link[rel="alternate"][href^="ios-app:"]',
  'link[rel="alternate"][href^="android-app:"]',
]

function strip(): number {
  let removed = 0
  for (const selector of HINT_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      node.remove()
      removed++
    }
  }
  return removed
}

let headObserver: MutationObserver | null = null
let rootObserver: MutationObserver | null = null

/**
 * 앱 배너 힌트를 지우고, 다시 삽입되는지 감시한다.
 * 유튜브 모바일 웹은 SPA 라 페이지 이동마다 meta 를 다시 넣을 수 있다.
 */
export function watchAppBannerHints(onRemoved: (count: number) => void): void {
  // 설정이 바뀔 때마다 다시 불릴 수 있다. 옵저버가 겹치지 않게 먼저 비운다.
  stopWatchingAppBannerHints()

  const run = () => {
    const n = strip()
    if (n > 0) onRemoved(n)
  }

  const attachHead = () => {
    if (headObserver || !document.head) return
    headObserver = new MutationObserver(run)
    headObserver.observe(document.head, { childList: true })
    // head 를 붙잡았으면 루트 감시는 더 필요 없다.
    rootObserver?.disconnect()
    rootObserver = null
  }

  run()
  attachHead()

  if (!headObserver) {
    // document_start 라 아직 head 가 없다. head 가 생길 때까지만 루트를 본다
    // (subtree 없이 직계 자식만 — 문서 전체 감시는 너무 비싸다).
    rootObserver = new MutationObserver(() => {
      run()
      attachHead()
    })
    rootObserver.observe(document.documentElement, { childList: true })
  }
}

/** 옵저버를 떼고 상태를 비운다. 설정에서 이 기능을 끌 때 쓴다. */
export function stopWatchingAppBannerHints(): void {
  headObserver?.disconnect()
  headObserver = null
  rootObserver?.disconnect()
  rootObserver = null
}
