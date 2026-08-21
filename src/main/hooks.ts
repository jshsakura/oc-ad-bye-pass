// MAIN world hooks. Must be installed synchronously, before YouTube's scripts.
//
// The set of hook points is kept minimal — every native we touch is another
// chance to break YouTube.
//
//   1) JSON.parse             : nearly every path by which YouTube parses a
//                               response body goes through here (fetch ->
//                               res.text() -> JSON.parse, XHR responseText ->
//                               JSON.parse, and inline JSON.parse('{...}')).
//   2) Response.prototype.json: the one path that parses internally without
//                               going through JSON.parse.
//   3) Global setters         : ytInitialPlayerResponse / ytInitialData arrive
//                               as object literals in an inline script, so no
//                               parse hook sees them. This hook is what stops
//                               the first pre-roll.
//
// fetch and XMLHttpRequest themselves are left alone. The three above already
// cover them, and reaching into the request layer risks colliding with
// YouTube's own retry and streaming logic.

import { NS, isBridgeMessage, type MainConfig } from '../shared/messages.ts'
import { setCaptionPreference } from './captions.ts'
import { deafenPlayer } from './deafenPlayer.ts'
import { BUNDLED_PRUNE } from '../shared/selectors.ts'
import { pruneAdFields } from './prune.ts'

// Until the settings arrive the default is "block". The MAIN world cannot read
// chrome.storage, so there is a few-hundred-millisecond gap before ISOLATED
// hands them over. Briefly over-blocking for someone who turned the extension
// off beats leaking ads to everyone who left it on.
const config: MainConfig = {
  enabled: true,
  videoAds: true,
  // Unlike blocking, a caption preference is not block-first: it changes what
  // plays on screen, so it stays off until the settings say otherwise.
  koreanCaptions: false,
  prunePaths: BUNDLED_PRUNE,
}

const isActive = () => config.enabled && config.videoAds

// --- Stats reporting (batched) -------------------------------------------------

let pendingCount = 0
let pendingSource = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  flushTimer = null
  if (!pendingCount) return
  window.postMessage({ ns: NS, type: 'pruned', count: pendingCount, source: pendingSource }, '*')
  pendingCount = 0
}

function report(count: number, source: string) {
  if (count <= 0) return
  pendingCount += count
  pendingSource = source
  if (flushTimer === null) flushTimer = setTimeout(flush, 1000)
}

function tryPrune(data: unknown, source: string) {
  if (!isActive()) return
  try {
    report(pruneAdFields(data, config.prunePaths), source)
  } catch {
    // A failed prune must never stop the page from working
  }
}

// --- toString disguise ---------------------------------------------------------
// Make a hooked function report the original native source when stringified.
// Checking that is a common way ad-block detection sniffs for tampering.

const originals = new WeakMap<object, object>()
const nativeToString = Function.prototype.toString

function disguise<T extends object>(hooked: T, original: object): T {
  originals.set(hooked, original)
  return hooked
}

function installToStringGuard() {
  const patched = function (this: unknown) {
    const original = typeof this === 'object' || typeof this === 'function' ? originals.get(this as object) : undefined
    return nativeToString.call(original ?? this)
  }
  Function.prototype.toString = disguise(patched, nativeToString)
}

// --- 1) JSON.parse -------------------------------------------------------------

function installJsonParseHook() {
  const native = JSON.parse
  const patched = function (this: unknown, text: string, reviver?: (key: string, value: unknown) => unknown) {
    const data = native.call(JSON, text, reviver as never)
    if (data !== null && typeof data === 'object') tryPrune(data, 'json-parse')
    return data
  }
  JSON.parse = disguise(patched, native) as typeof JSON.parse
}

// --- 2) Response.prototype.json ------------------------------------------------

const INNERTUBE_PATH = /\/youtubei\/v1\/(player|browse|next|search|reel_watch_sequence|get_watch)/

function installResponseJsonHook() {
  const native = Response.prototype.json
  const patched = async function (this: Response) {
    const data = await native.call(this)
    let relevant = true
    try {
      relevant = !this.url || INNERTUBE_PATH.test(this.url)
    } catch {
      relevant = true
    }
    if (relevant && data !== null && typeof data === 'object') tryPrune(data, 'response-json')
    return data
  }
  Response.prototype.json = disguise(patched, native) as typeof Response.prototype.json
}

// --- 3) Global setters ---------------------------------------------------------

function guardGlobal(name: string) {
  try {
    const existing = Object.getOwnPropertyDescriptor(window, name)
    if (existing && !existing.configurable) return

    let stored: unknown = existing?.value
    if (stored !== undefined) tryPrune(stored, `global:${name}`)

    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() {
        return stored
      },
      set(value: unknown) {
        tryPrune(value, `global:${name}`)
        stored = value
      },
    })
  } catch {
    // If YouTube already pinned it non-configurable, give up — the JSON.parse hook remains
  }
}

// --- Receiving settings --------------------------------------------------------
//
// Page scripts can post on the same channel. Worst case, YouTube forges a
// message and switches blocking off — but doing so means it already knows the
// extension is there, so it gains little; that risk is accepted. Traffic the
// other way (counters) needs no trust, so it poses no problem.

function listenForConfig() {
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return
      if (!isBridgeMessage(event.data) || event.data.type !== 'config') return
      const next = event.data.config
      config.enabled = next.enabled
      config.videoAds = next.videoAds
      config.koreanCaptions = next.koreanCaptions === true
      setCaptionPreference(config.enabled && config.koreanCaptions)
      if (Array.isArray(next.prunePaths) && next.prunePaths.length) config.prunePaths = next.prunePaths
    },
    false,
  )
}

export function installHooks() {
  installToStringGuard()
  installJsonParseHook()
  installResponseJsonHook()
  deafenPlayer()
  guardGlobal('ytInitialPlayerResponse')
  guardGlobal('ytInitialData')
  listenForConfig()
}
