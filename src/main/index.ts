// Layer 1 entry point — MAIN world, document_start.
// The hooks must be in place before a single line of YouTube's script runs.

import { INSTALLED_ATTR } from '../shared/messages.ts'
import { installHooks } from './hooks.ts'

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
  installHooks()
  // Tell the ISOLATED world that layer 1 is live. At document_start there may
  // be no <head> yet, but documentElement already exists.
  document.documentElement?.setAttribute(INSTALLED_ATTR, '1')
}
