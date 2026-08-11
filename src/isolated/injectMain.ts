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
//
// And when this route fails too, layer 1 does not exist on that page at all —
// every video plays its pre-roll while the popup still says the extension is
// on. That failure used to go to the console, which on a phone is nowhere. It
// is written to the DOM now, and the panel reads it.

import { INSTALLED_ATTR } from '../shared/messages.ts'
import { reportDiagnostics } from './diagnostics.ts'

/** Read back by src/isolated/diagnostics.ts, which has its own copy of the name. */
const INJECT_ATTR = 'data-oc-abp-inject'

type InjectState =
  /** The registered content script beat us to it — nothing to do, and the fast path. */
  | 'not-needed'
  /** Inserted, and no answer yet. Seeing this stick means neither event fired. */
  | 'injected'
  /** The page ran it. Layer 1 is alive, though possibly later than the first parse. */
  | 'loaded'
  /** Refused — a page CSP will do this. Layer 1 is not on this page. */
  | 'blocked'

function mark(state: InjectState): void {
  document.documentElement?.setAttribute(INJECT_ATTR, state)
  reportDiagnostics()
}

export function injectMainWorldFallback(): void {
  // Nothing to do if the normal route already installed the hooks.
  if (document.documentElement?.hasAttribute(INSTALLED_ATTR)) return mark('not-needed')

  // Not yet installed does not mean it failed — content script execution order
  // is not guaranteed, so MAIN may simply run after us. We inject anyway rather
  // than wait: a hook installed late is worthless, and main/index.ts's guard
  // stops the double run.
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('main.js')
  // script-inserted elements default to async=true; false keeps insertion order.
  script.async = false
  script.addEventListener('load', () => {
    mark('loaded')
    script.remove()
  })
  script.addEventListener('error', () => {
    mark('blocked')
    console.warn('[oc-ad-bye-pass] main.js 주입이 차단되었습니다 — 1계층이 동작하지 않습니다')
    script.remove()
  })

  const parent = document.head ?? document.documentElement
  parent.insertBefore(script, parent.firstChild)
  mark('injected')
}
