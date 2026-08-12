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

import { INSTALLED_ATTR } from '../shared/messages.ts'
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

/** Written by src/isolated/pip.ts when the user leaves with a video playing. */
const AUTO_PIP_ATTR = 'data-oc-abp-autopip'

/** Written by src/isolated/injectMain.ts — how layer 1 got here, or why it did not. */
const INJECT_ATTR = 'data-oc-abp-inject'

export interface PageDiagnostics {
  at: number
  url: string
  layer1: boolean
  videos: number
  pip: 'webkit' | 'standard' | 'none'
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
  /** What the automatic hand-over managed last time, or null if it never ran. */
  autoPip: string | null
  /** Whether the injection fallback was needed, and whether the page allowed it. */
  inject: string | null
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

/**
 * The video the reader is asking about.
 *
 * `querySelector('video')` returns whichever element comes first in the document,
 * and on YouTube that can be an empty one held in reserve — so the panel answered
 * `PiP 지원: 아니오` and `표시 모드: inline` about a video nobody was watching.
 * The same ordering by liveness that src/isolated/pip.ts picks by, kept separate
 * because this module is loaded by the injection path before that one exists.
 */
function reportedVideo(): WebkitVideo | null {
  const videos = [...document.querySelectorAll<WebkitVideo>('video')]
  if (videos.length === 0) return null
  const score = (v: WebkitVideo) =>
    (!v.paused && !v.ended ? 4 : 0) + (v.currentTime > 0 ? 2 : 0) + (v.readyState >= 1 ? 1 : 0)
  return videos.reduce((best, v) => (score(v) > score(best) ? v : best))
}

export function reportDiagnostics(): void {
  const video = reportedVideo()
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
    pipSupported:
      typeof video?.webkitSupportsPresentationMode === 'function'
        ? video.webkitSupportsPresentationMode('picture-in-picture')
        : null,
    fullscreenFallback: typeof video?.webkitEnterFullscreen === 'function',
    visibilityState: document.visibilityState,
    presentationMode: video?.webkitPresentationMode ?? 'inline',
    autoPip: document.documentElement.getAttribute(AUTO_PIP_ATTR),
    inject: document.documentElement.getAttribute(INJECT_ATTR),
    log: readLog(),
    userAgent: navigator.userAgent,
  }
  void chrome.storage.local.set({ [KEY]: facts })
  if (location.hostname.endsWith('youtube.com')) {
    void chrome.storage.local.set({ [YOUTUBE_KEY]: facts })
  }

  if (!facts.layer1) watchForLayer1()
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
