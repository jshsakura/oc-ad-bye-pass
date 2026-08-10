// 2계층 — 광고 컴포넌트 제거.
// ReVanced 의 LithoFilterPatch/AdsFilter 가 렌더 트리에서 광고 컴포넌트를 걸러내는 것과
// 같은 역할을, 웹에서는 스타일시트로 한다. document_start 에 넣으므로 광고가 그려졌다
// 사라지는 깜빡임이 없다.
//
// CSS 로 안 되는 것만 MutationObserver 가 맡는다: 닫기 버튼 클릭, 애드블록 경고창 처리.

const STYLE_ID = 'oc-ad-bye-pass'

let styleEl: HTMLStyleElement | null = null

export function applyStylesheet(css: string): void {
  const root = document.head ?? document.documentElement
  if (!root) return
  if (!styleEl || !styleEl.isConnected) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_ID
    root.appendChild(styleEl)
  }
  if (styleEl.textContent !== css) styleEl.textContent = css
}

const clicked = new WeakSet<Element>()

/** 광고 닫기 버튼을 눌러준다. 누른 개수를 돌려준다. */
export function clickCloseButtons(selectors: string[]): number {
  let count = 0
  for (const selector of selectors) {
    let nodes: NodeListOf<HTMLElement>
    try {
      nodes = document.querySelectorAll<HTMLElement>(selector)
    } catch {
      continue
    }
    for (const node of nodes) {
      if (clicked.has(node) || !node.isConnected) continue
      // 화면에 실제로 떠 있는 것만 — 유튜브는 안 쓰는 버튼을 DOM 에 남겨둔다
      if (node.offsetParent === null && node.getClientRects().length === 0) continue
      clicked.add(node)
      try {
        node.click()
        count++
      } catch {
        // 무시
      }
    }
  }
  return count
}

/**
 * "광고 차단기를 사용 중입니다" 안내창을 치우고 재생을 되살린다.
 * 컨테이너(ytd-popup-container)는 남겨야 한다 — 통째로 지우면 이후 모든 팝업이 죽는다.
 */
export function dismissAdblockNag(): number {
  const messages = document.querySelectorAll('ytd-enforcement-message-view-model')
  if (!messages.length) return 0

  let count = 0
  for (const message of messages) {
    const dialog = message.closest('tp-yt-paper-dialog, ytd-popup-container > *')
    ;(dialog ?? message).remove()
    count++
  }

  for (const backdrop of document.querySelectorAll('tp-yt-iron-overlay-backdrop')) backdrop.remove()
  // 모달이 걸어둔 스크롤 잠금 해제
  document.body?.style.removeProperty('overflow')
  document.documentElement.removeAttribute('scroll-lock')

  const video = document.querySelector<HTMLVideoElement>('video')
  if (video?.paused) void video.play().catch(() => {})

  return count
}
