// Layer 1 entry point — MAIN world, document_start.
// The hooks must be in place before a single line of YouTube's script runs.

import { INSTALLED_ATTR, isBridgeMessage } from '../shared/messages.ts'
import { installHooks } from './hooks.ts'
import { installPopupGuard, setPopupBlocking } from './popups.ts'
import { siteKindFor } from '../shared/sites.ts'

const FLAG = '__ocAdByePassInstalled'

declare global {
  interface Window {
    __ocAdByePassInstalled?: boolean
  }
}

/**
 * Are we actually in the page's world?
 *
 * This file only does anything useful there. Hooking JSON.parse from the
 * extension's world wraps the extension's copy, which YouTube never calls — the
 * ads come through untouched while everything looks fine.
 *
 * `chrome.runtime.id` is the tell: content scripts in the isolated world have
 * it, page scripts do not. A page can have a `chrome` object of its own, so the
 * check goes all the way to the id rather than stopping at the namespace.
 *
 * This matters because a browser can silently ignore `world: "MAIN"` on a
 * static content script and run the file in ISOLATED instead — WebKit does, and
 * Orion is WebKit. It happened: layer 1 reported itself installed, the
 * injection fallback saw the marker and stood down, and pre-roll ads played on
 * a phone while every test on the desk was green.
 */
function inPageWorld(): boolean {
  try {
    return typeof chrome === 'undefined' || !chrome.runtime?.id
  } catch {
    // Touching chrome.runtime can throw in a page context. That is an answer.
    return true
  }
}

if (!inPageWorld()) {
  // Wrong world. Say nothing and mark nothing: the marker is what tells
  // isolated/injectMain.ts whether it still has work to do, and a marker set
  // from here is a lie that costs the whole layer.
  console.warn('[oc-ad-bye-pass] 1계층이 페이지 컨텍스트 밖에서 실행됐습니다 — 주입 폴백에 맡깁니다')
} else if (!window[FLAG]) {
  // This guard is what makes the injection fallback safe. Even when both the
  // registration and the <script> injection succeed, the hooks install once
  // (installing twice would double-count pruning and double-wrap natives).
  window[FLAG] = true

  // The pop-up guard runs everywhere; the response hooks do not.
  //
  // Wrapping JSON.parse on a bank's website buys nothing and risks everything,
  // and that asymmetry is why this file used to load on the video site alone.
  // Pop-unders are the whole web, though, so the file loads everywhere now and
  // the split moved in here — which keeps the promise the old arrangement made
  // by construction: away from the video site nothing native is touched except
  // the one function that opens windows.
  installPopupGuard()
  if (siteKindFor(location.hostname) === 'youtube') installHooks()

  // The hooks keep their own copy of the config, but they are not installed
  // away from the video site — and the guard has to hear about the switch
  // everywhere. One more listener is cheaper than threading the config through
  // a module that does not run here.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (!isBridgeMessage(event.data) || event.data.type !== 'config') return
    setPopupBlocking(event.data.config.enabled && event.data.config.popups)
  })

  // Tell the ISOLATED world we reached the page's world. At document_start
  // there may be no <head> yet, but documentElement already exists.
  document.documentElement?.setAttribute(INSTALLED_ATTR, '1')
}
