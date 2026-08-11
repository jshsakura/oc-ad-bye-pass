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

// This guard is what makes the Safari fallback safe. Even when both the MAIN
// world registration and the <script> injection succeed, the hooks install
// once (installing twice would double-count pruning and double-wrap natives).
if (!window[FLAG]) {
  window[FLAG] = true
  installHooks()
  // Tell the ISOLATED world that layer 1 is live. At document_start there may
  // be no <head> yet, but documentElement already exists.
  document.documentElement?.setAttribute(INSTALLED_ATTR, '1')
}
