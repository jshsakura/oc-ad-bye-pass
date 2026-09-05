// The page's own account of itself, written where the popup can read it.
//
// The popup used to ask the tab directly with `scripting.executeScript`, which
// needs `activeTab` — granted only when the user invokes the extension, and of
// unknown standing on Orion. Whether the diagnostics work is not a thing that
// should depend on the same uncertainty they exist to resolve.
//
// So the content script writes instead. It is already on the page, and
// `chrome.storage` needs no host permission at all.
//
// One slot, last writer wins. On a phone there is one page in front of you; on a
// desktop the timestamp and URL say which one this was.

import { CAPTIONS_ATTR, CAPTIONS_DETAIL_ATTR, INSTALLED_ATTR } from '../shared/messages.ts'
import { needsPipButton, pipButtonFacts } from '../ui/device.ts'
import { readLog } from '../shared/log.ts'

const KEY = 'diagnostics'

/**
 * The last report from YouTube, kept apart from the last report from anywhere.
 *
 * One slot meant the last page to load won, and on a phone that is routinely an
 * about:blank tab: the panel would say "비디오 0개, PiP 없음" about a blank page
 * while the question being asked was about the video playing in the other tab.
 */
const YOUTUBE_KEY = 'diagnosticsYoutube'

/**
 * The tail, kept across documents.
 *
 * The log lives in an attribute on the document element, which is the only thing
 * that survives the page being suspended — and dies with the document. Coming
 * back from the background reloads this page routinely, so every line written on
 * the way out is gone before anyone can read it: four dumps in a row have been
 * the first second of a fresh page, with the departure they were taken for
 * nowhere in them.
 *
 * This is the extension's own storage, not the page's. A copy in localStorage was
 * tried and removed while playback was broken, because it wrote into the page on
 * every line; this writes nothing there and only on a report.
 */
const LOG_KEY = 'diagnosticsLog'
const LOG_KEEP = 8000

/** Written by src/isolated/injectMain.ts — how layer 1 got here, or why it did not. */
const INJECT_ATTR = 'data-oc-abp-inject'

export interface PageDiagnostics {
  at: number
  url: string
  layer1: boolean
  videos: number
  pip: 'webkit' | 'standard' | 'none'
  /** Whether a PiP button is drawn here at all — see needsPipButton. */
  pipButtonNeeded: boolean
  /**
   * What WebKit says about this very video, which is a different question from
   * whether the API exists. `false` means no call will ever open a window here —
   * the opt-out is still on, or the video has no picture to float — and that is
   * the answer no amount of tapping can find.
   */
  pipSupported: boolean | null
  fullscreenFallback: boolean
  visibilityState: string
  /** What the video is doing now: inline, fullscreen or picture-in-picture. */
  presentationMode: string
  /** Whether the injection fallback was needed, and whether the page allowed it. */
  inject: string | null
  /** The caption picker's outcome for this video, if the toggle ran here. */
  captions: string | null
  /** What it was looking at when it decided — the evidence for that outcome. */
  captionsDetail: string | null
  /** The tail of what happened, including while the app was away. */
  log: string | null
  userAgent: string
}

interface WebkitVideo extends HTMLVideoElement {
  webkitSetPresentationMode?: unknown
  webkitEnterFullscreen?: unknown
  webkitPresentationMode?: string
  webkitSupportsPresentationMode?: (mode: string) => boolean
}

export function reportDiagnostics(): void {
  // Top document only. This script runs in every frame (all_frames), and a page
  // carries dozens of ad/tracker iframes; each one reporting would race the
  // single storage slot and, worse, merge a "시작" line into the shared log tail
  // per frame — hundreds of them, burying the one page's actual story. It also
  // means dozens of get→sort-8KB→set round trips on load, which is real I/O the
  // page does not need while it is trying to start a video. The player and its
  // state live in the top document, so that is the only frame worth reporting.
  if (window.top !== window) return

  const video = document.querySelector<WebkitVideo>('video')
  const facts: PageDiagnostics = {
    at: Date.now(),
    url: location.href,
    layer1: document.documentElement.hasAttribute(INSTALLED_ATTR),
    videos: document.querySelectorAll('video').length,
    pip:
      typeof video?.webkitSetPresentationMode === 'function'
        ? 'webkit'
        : typeof video?.requestPictureInPicture === 'function'
          ? 'standard'
          : 'none',
    pipButtonNeeded: needsPipButton(pipButtonFacts()),
    pipSupported:
      typeof video?.webkitSupportsPresentationMode === 'function'
        ? video.webkitSupportsPresentationMode('picture-in-picture')
        : null,
    fullscreenFallback: typeof video?.webkitEnterFullscreen === 'function',
    visibilityState: document.visibilityState,
    presentationMode: video?.webkitPresentationMode ?? 'inline',
    inject: document.documentElement.getAttribute(INJECT_ATTR),
    captions: document.documentElement.getAttribute(CAPTIONS_ATTR),
    captionsDetail: document.documentElement.getAttribute(CAPTIONS_DETAIL_ATTR),
    log: readLog(),
    userAgent: navigator.userAgent,
  }
  void chrome.storage.local.set({ [KEY]: facts })
  void mergeLog(facts.log)
  if (location.hostname.endsWith('youtube.com')) {
    void chrome.storage.local.set({ [YOUTUBE_KEY]: facts })
  }

  if (!facts.layer1) watchForLayer1()
}


/**
 * Fold this document's tail into the running one, in time order.
 *
 * Merged by line rather than appended blindly — the same report is written
 * several times per page and the tail overlaps itself. Sorted by the stamp alone
 * and stably, because sorting whole lines alphabetises a burst inside one
 * millisecond, which is exactly the part worth reading.
 */
async function mergeLog(tail: string | null): Promise<void> {
  if (!tail) return
  try {
    const got = await chrome.storage.local.get(LOG_KEY)
    const stored = typeof got[LOG_KEY] === 'string' ? (got[LOG_KEY] as string) : ''
    const known = new Set(stored.split('\n'))
    const fresh = tail.split('\n').filter((line) => line && !known.has(line))
    if (fresh.length === 0) return
    const merged = [...stored.split('\n').filter(Boolean), ...fresh]
      .map((line, index) => ({ line, index }))
      .sort((a, b) => a.line.slice(0, 9).localeCompare(b.line.slice(0, 9)) || a.index - b.index)
      .map((entry) => entry.line)
      .join('\n')
    await chrome.storage.local.set({
      [LOG_KEY]: merged.length > LOG_KEEP ? merged.slice(merged.length - LOG_KEEP) : merged,
    })
  } catch {
    // The panel still has this document's own tail; a longer history is a bonus.
  }
}

let waitingForLayer1: MutationObserver | null = null

/**
 * Report again if layer 1 turns up late.
 *
 * Not installed yet is not the same as failed. The covering path for browsers
 * that ignore `world: "MAIN"` injects main.js as a <script>, and that load races
 * the storage read this report is written after — so on the one browser the
 * panel exists for, a working layer 1 can be reported as missing.
 *
 * A false "아니오" here is worse than no answer at all: it is the answer the next
 * hour is spent on. So the marker is watched for, once, and the report rewritten
 * when it appears.
 */
function watchForLayer1(): void {
  if (waitingForLayer1) return
  waitingForLayer1 = new MutationObserver(() => {
    if (!document.documentElement.hasAttribute(INSTALLED_ATTR)) return
    waitingForLayer1?.disconnect()
    waitingForLayer1 = null
    reportDiagnostics()
  })
  waitingForLayer1.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [INSTALLED_ATTR],
  })
}

let watchingCaptions = false

/**
 * Re-report when the caption picker moves — its states (watching → translated)
 * change well after the load-time report, and a dump frozen at 대기 중 while
 * the screen shows Korean sent one debugging session the wrong way.
 * Stays attached: unlike layer 1 this attribute changes per video.
 */
export function watchCaptionOutcome(): void {
  if (watchingCaptions || window.top !== window) return
  watchingCaptions = true
  new MutationObserver(() => reportDiagnostics()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [CAPTIONS_ATTR, CAPTIONS_DETAIL_ATTR],
  })
}
