// Safari fallback — inject the MAIN world script into the page directly.
//
// The normal route is registerContentScripts in background/mainWorld.ts. This
// is the last resort that keeps layer 1 from dying outright when that fails
// (older Safari, permission refused, and so on).
//
// **This route is slower than the normal one.** It is an extension resource so
// the load is local, but a script-inserted element cannot block the parser. If
// YouTube's inline script runs first we miss ytInitialPlayerResponse — meaning
// the first pre-roll can leak through. Layers 2 and 3 still work, so it beats
// blocking nothing.
//
// This is the last line of defence, and it runs on every browser: registration
// can fail anywhere, and the failure is invisible without it.

import { INSTALLED_ATTR } from '../shared/messages.ts'

export function injectMainWorldFallback(): void {
  // Nothing to do if the normal route already installed the hooks.
  if (document.documentElement?.hasAttribute(INSTALLED_ATTR)) return

  // Not yet installed does not mean it failed — content script execution order
  // is not guaranteed, so MAIN may simply run after us. We inject anyway rather
  // than wait: a hook installed late is worthless, and main/index.ts's guard
  // stops the double run.
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('main.js')
  // script-inserted elements default to async=true; false keeps insertion order.
  script.async = false
  script.addEventListener('load', () => script.remove())
  script.addEventListener('error', () => {
    console.warn('[oc-ad-bye-pass] main.js 주입이 차단되었습니다 — 1계층이 동작하지 않습니다')
    script.remove()
  })

  const parent = document.head ?? document.documentElement
  parent.insertBefore(script, parent.firstChild)
}
