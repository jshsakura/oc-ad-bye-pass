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

/**
 * Injected once per document.
 *
 * Away from the video site this is called from `recompute`, which runs again on
 * every settings change and every filter-cache write. Without this the marker
 * check is not enough: an injection already in flight has not set the attribute
 * yet, so a second call inserts a second copy of the script.
 */
let attempted = false

/** How long the injected element gets to answer before it is taken back out. */
const SETTLE_MS = 4000

export function injectMainWorldFallback(): void {
  if (attempted) return
  // Nothing to do if the normal route already reached the page's world.
  if (document.documentElement?.hasAttribute(INSTALLED_ATTR)) return mark('not-needed')
  attempted = true
  inject()
}

function inject(): void {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('main.js')

  /*
   * Async. It was `false` here, to keep insertion order, and that is the single
   * most expensive line this extension has ever shipped.
   *
   * A script-inserted element with async=false joins the document's
   * execute-in-order list, and everything script-inserted *after* it waits for
   * this one. YouTube builds its player that way. So a request of ours that
   * neither loads nor fails does not merely delay layer 1 — it stops the page's
   * own scripts from running, for as long as the request is open. The player
   * never initialises and the tab is dead in the water.
   *
   * That is not a theory. It happened on 2026-08-12, it was diagnosed, and
   * `550edc0` fixed it exactly here. Then `01cc36f` reset src/ to an older
   * release to recover playback and this fix went with it — "Everything else
   * from today is gone" — and nobody noticed, because the path never runs on
   * Chrome. It only runs where `world: "MAIN"` is ignored, which is the browser
   * this extension is on a phone through.
   *
   * Nothing here needs to run in step with the page's scripts. It needs to run
   * early, and it must never be able to hold them up.
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
   * Neither event is guaranteed — the phone reported exactly that, injected and
   * then silence — and an element we put in the page's <head> on the strength of
   * a request that never resolves is ours to clean up. The verdict is read off
   * layer 1's own marker rather than assumed: the script may well have run and
   * simply not fired `load`, and calling that `차단됨` would be the false
   * negative the panel exists to avoid.
   */
  setTimeout(() => {
    if (!script.isConnected) return
    mark(document.documentElement?.hasAttribute(INSTALLED_ATTR) ? 'loaded' : 'blocked')
    script.remove()
  }, SETTLE_MS)

  // Marked before insertion, not after: the load event can arrive during the
  // insert, and marking afterwards wrote `injected` over the `loaded` that had
  // already happened — which is what the phone reported.
  mark('injected')
  const parent = document.head ?? document.documentElement
  parent.insertBefore(script, parent.firstChild)
}
