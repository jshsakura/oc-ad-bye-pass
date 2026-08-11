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

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

const DIALOG_SELECTOR = 'tp-yt-paper-dialog, ytd-popup-container > *'

/**
 * "광고 차단기를 사용 중입니다" 안내창을 치우고 재생을 되살린다.
 * 컨테이너(ytd-popup-container)는 남겨야 한다 — 통째로 지우면 이후 모든 팝업이 죽는다.
 *
 * ── 여기는 두 번 조심해야 한다
 *
 * 1. **보이는 것만 건드린다.** 예전에는 DOM 어딘가에 enforcement 요소가 있기만 하면
 *    발화했다. 유튜브가 `display:none` 인 요소 하나를 팝업 컨테이너에 상시로 심어두면,
 *    우리가 3초마다 사용자의 **무관한 대화상자·배경·스크롤 잠금을 전부 부순다.**
 *    사용자 눈에는 "확장 깔았더니 유튜브가 이상해졌다"로 보이고 원인은 우리다.
 *    광고를 못 막는 것보다 나쁘다.
 *
 * 2. **뒷정리는 남은 모달이 없을 때만.** 배경과 스크롤 잠금은 공용 자원이라,
 *    다른 대화상자가 떠 있는데 걷어내면 그쪽이 깨진다.
 */
/**
 * 지울 범위를 정한다. **다른 내용을 담고 있는 조상은 절대 넘지 않는다.**
 *
 * 예전에는 `closest('tp-yt-paper-dialog, …')` 로 무조건 위로 올라갔다. 그러면
 * 유튜브가 공유 대화상자 안에 숨은 enforcement 요소 하나만 심어둬도 우리가 그
 * 대화상자를 통째로 날린다. 자식이 하나뿐일 때만 올라가면 그런 일이 없다.
 */
function nagRoot(message: Element): Element {
  let node = message
  for (;;) {
    const parent = node.parentElement
    if (!parent) break
    if (parent === document.body || parent === document.documentElement) break
    // 컨테이너 자체는 남겨야 한다 — 지우면 이후 모든 팝업이 죽는다
    if (parent.tagName.toLowerCase() === 'ytd-popup-container') break
    // 형제가 있다 = 이 조상은 다른 내용도 담고 있다
    if (parent.childElementCount !== 1) break
    node = parent
  }
  return node
}

export function dismissAdblockNag(): number {
  const messages = document.querySelectorAll('ytd-enforcement-message-view-model')
  if (!messages.length) return 0

  // 배경이 떠 있었나 = 모달이 실제로 화면을 막고 있었나.
  // 뒷정리를 할지 말지의 기준으로 쓴다 (우리 스타일시트가 nag 를 이미 숨겼을 수
  // 있어서, nag 요소 자체의 가시성으로는 판단할 수 없다).
  const backdrops = [...document.querySelectorAll('tp-yt-iron-overlay-backdrop')]
  const hadBackdrop = backdrops.some(isVisible)

  let count = 0
  for (const message of messages) {
    nagRoot(message).remove()
    count++
  }

  // 배경·스크롤 잠금은 공용 자원이다. 다른 대화상자가 떠 있으면 그쪽 것이므로
  // 건드리지 않는다.
  const otherDialogOpen = [...document.querySelectorAll(DIALOG_SELECTOR)].some(isVisible)
  if (!otherDialogOpen) {
    for (const backdrop of backdrops) backdrop.remove()
    document.body?.style.removeProperty('overflow')
    document.documentElement.removeAttribute('scroll-lock')

    // 경고창이 세운 재생만 되살린다. 배경도 없었다면 애초에 막고 있지 않았다는
    // 뜻이므로, 사용자가 일부러 멈춰둔 영상을 되살리지 않는다.
    if (hadBackdrop) {
      const video = document.querySelector<HTMLVideoElement>('video')
      if (video?.paused) void video.play().catch(() => {})
    }
  }

  return count
}
