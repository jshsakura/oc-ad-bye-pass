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

  /*
   * Give the registered script the rest of the tick first.
   *
   * Content script execution order is not guaranteed, so "not installed yet" at
   * document_start is the ordinary case rather than a failure — and injecting on
   * the strength of it means two copies of layer 1 on every browser where the
   * normal route works perfectly well. One of them is then a script the page did
   * not ask for, hanging in its <head>, for no gain at all.
   *
   * A timeout of zero is enough: both content scripts run before it.
   */
  setTimeout(inject, 0)
}

function inject(): void {
  if (document.documentElement?.hasAttribute(INSTALLED_ATTR)) return mark('not-needed')

  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('main.js')

  /*
   * Async. It used to be `false`, to keep insertion order.
   *
   * That order is not ours alone. A script-inserted element with async=false
   * joins the document's "execute in order" list, and everything inserted into
   * it afterwards waits for this one — so a request that neither loads nor fails
   * stops every script YouTube inserts after it. Which is what the phone
   * reported: layer 1 marked `주입함` and never `로드` or `차단됨`, the player
   * never initialised, and the video sat at `readyState=0 버퍼=0` with the
   * network still open, for as long as anyone watched it.
   *
   * Nothing here needs to run in step with the page's own scripts. It needs to
   * run early, and it must not be able to hold the page's scripts up.
   */
  script.async = true
  script.addEventListener('load', () => {
    mark('loaded')
    script.remove()
  })
  script.addEventListener('error', () => {
    mark('blocked')
    console.warn('[oc-ad-bye-pass] main.js 주입이 차단되었습니다 — 1계층이 동작하지 않습니다')
    script.remove()
  })

  /*
   * And it does not get to stay forever.
   *
   * Neither event is guaranteed. The device saw exactly that — injected, then
   * silence — and an element left in the page's <head> on the strength of a
   * request that never resolves is a thing this extension put there and cannot
   * account for. If it has not answered by now it is not going to.
   */
  setTimeout(() => {
    if (!script.isConnected) return
    mark('blocked')
    script.remove()
  }, 4000)

  // Marked before insertion, not after: the load event can arrive during the
  // insert, and marking afterwards wrote `injected` over the `loaded` that had
  // already happened — which is what the phone reported.
  mark('injected')
  const parent = document.head ?? document.documentElement
  parent.insertBefore(script, parent.firstChild)
}
