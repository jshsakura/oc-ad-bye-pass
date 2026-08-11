// Layer 2 — removing ad components.
//
// The same role ReVanced's LithoFilterPatch/AdsFilter plays when it filters ad
// components out of the render tree, done on the web with a stylesheet.
// Injected at document_start, so ads never flash into view and disappear.
//
// The MutationObserver only handles what CSS cannot: pressing close buttons and
// clearing the ad-block warning dialog.

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

/** Press ad close buttons. Returns how many were pressed. */
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
      // Only ones actually on screen — YouTube leaves unused buttons in the DOM
      if (node.offsetParent === null && node.getClientRects().length === 0) continue
      clicked.add(node)
      try {
        node.click()
        count++
      } catch {
        // ignore
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
 * Decide how much to remove. **Never climb past an ancestor that holds other content.**
 *
 * This used to walk up unconditionally with
 * `closest('tp-yt-paper-dialog, …')`. That meant YouTube could plant one hidden
 * enforcement element inside, say, the share dialog and we would destroy that
 * dialog wholesale. Climbing only while the parent has a single child makes
 * that impossible.
 */
function nagRoot(message: Element): Element {
  let node = message
  for (;;) {
    const parent = node.parentElement
    if (!parent) break
    if (parent === document.body || parent === document.documentElement) break
    // The container itself has to stay — remove it and every later popup dies
    if (parent.tagName.toLowerCase() === 'ytd-popup-container') break
    // A sibling means this ancestor holds other content too
    if (parent.childElementCount !== 1) break
    node = parent
  }
  return node
}

export function dismissAdblockNag(): number {
  const messages = document.querySelectorAll('ytd-enforcement-message-view-model')
  if (!messages.length) return 0

  // Was a backdrop up? That is what tells us a modal was really blocking the
  // page, and it decides whether we clean up afterwards. The nag element's own
  // visibility cannot answer it — our stylesheet may already have hidden it.
  const backdrops = [...document.querySelectorAll('tp-yt-iron-overlay-backdrop')]
  const hadBackdrop = backdrops.some(isVisible)

  let count = 0
  for (const message of messages) {
    nagRoot(message).remove()
    count++
  }

  // The backdrop and scroll lock are shared resources. If another dialog is
  // open they belong to it, so leave them alone.
  const otherDialogOpen = [...document.querySelectorAll(DIALOG_SELECTOR)].some(isVisible)
  if (!otherDialogOpen) {
    for (const backdrop of backdrops) backdrop.remove()
    document.body?.style.removeProperty('overflow')
    document.documentElement.removeAttribute('scroll-lock')

    // Only resume playback the warning itself stopped. No backdrop means nothing
    // was blocking in the first place, so we never restart a video the user paused.
    if (hadBackdrop) {
      const video = document.querySelector<HTMLVideoElement>('video')
      if (video?.paused) void video.play().catch(() => {})
    }
  }

  return count
}
