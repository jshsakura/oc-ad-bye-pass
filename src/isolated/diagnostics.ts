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

const KEY = 'diagnostics'

export interface PageDiagnostics {
  at: number
  url: string
  layer1: boolean
  videos: number
  pip: 'webkit' | 'standard' | 'none'
  fullscreenFallback: boolean
  visibilityState: string
  userAgent: string
}

interface WebkitVideo extends HTMLVideoElement {
  webkitSetPresentationMode?: unknown
  webkitEnterFullscreen?: unknown
}

export function reportDiagnostics(): void {
  const video = document.querySelector<WebkitVideo>('video')
  const facts: PageDiagnostics = {
    at: Date.now(),
    url: location.href,
    layer1: document.documentElement.hasAttribute('data-oc-ad-bye-pass'),
    videos: document.querySelectorAll('video').length,
    pip:
      typeof video?.webkitSetPresentationMode === 'function'
        ? 'webkit'
        : typeof video?.requestPictureInPicture === 'function'
          ? 'standard'
          : 'none',
    fullscreenFallback: typeof video?.webkitEnterFullscreen === 'function',
    visibilityState: document.visibilityState,
    userAgent: navigator.userAgent,
  }
  void chrome.storage.local.set({ [KEY]: facts })
}
