// Removing the "open in the YouTube app" nags.
//
// These are app-install prompts rather than ads, but they belong on the same
// list: on mobile web they permanently occupy the top of the screen and push
// the user toward an app where the extension cannot run.
//
// There are two kinds, handled differently.
//
// 1. **Safari's smart app banner** — drawn by iOS Safari itself, not the page.
//    It comes from `<meta name="apple-itunes-app">`, so CSS can never touch it;
//    the only option is removing the tag before the parser sees it. That is
//    this file's job.
//
// 2. **Banners and toasts YouTube draws itself** — ordinary DOM, handled by the
//    stylesheet. Those selectors live in the `appPromo` group in
//    shared/selectors.ts.
//
// Timing is everything. Safari raises the banner from the meta tag during
// parsing, so routing this through index.ts's rAF throttle makes the banner
// flash once before vanishing. Hence a dedicated observer that removes it
// **synchronously**. The cost is a single childList observer on head — not
// subtree, since meta and link are head's direct children.

/** Head tags that produce smart app banners and app deep-link hints. */
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
 * Remove app-banner hints and keep watching in case they are re-inserted.
 * YouTube mobile web is a SPA, so it may add the meta tag again on every navigation.
 */
export function watchAppBannerHints(onRemoved: (count: number) => void): void {
  // May be called again whenever settings change — clear first so observers don't stack up.
  stopWatchingAppBannerHints()

  const run = () => {
    const n = strip()
    if (n > 0) onRemoved(n)
  }

  const attachHead = () => {
    if (headObserver || !document.head) return
    headObserver = new MutationObserver(run)
    headObserver.observe(document.head, { childList: true })
    // Once head is in hand there is no reason to keep watching the root.
    rootObserver?.disconnect()
    rootObserver = null
  }

  run()
  attachHead()

  if (!headObserver) {
    // At document_start there is no head yet. Watch the root only until one
    // appears (direct children, no subtree — watching the whole document is far
    // too expensive).
    rootObserver = new MutationObserver(() => {
      run()
      attachHead()
    })
    rootObserver.observe(document.documentElement, { childList: true })
  }
}

/** Detach the observers and clear state. Used when the feature is switched off in settings. */
export function stopWatchingAppBannerHints(): void {
  headObserver?.disconnect()
  headObserver = null
  rootObserver?.disconnect()
  rootObserver = null
}
