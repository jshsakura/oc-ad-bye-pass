// Picture-in-picture on YouTube's mobile web player — ISOLATED world.
//
// The browser supports it; the page opts out. YouTube marks its <video> with
// `disablePictureInPicture` and ships no control of its own on mobile web, so
// there is no way in even though everything underneath works. Both halves are
// answered here: clear the opt-out, and put a button where a thumb can reach it.
//
// This lives in ISOLATED rather than MAIN because it needs nothing from the page
// context — the DOM is shared, so the video element and its methods are reachable
// from here, and being out of the page's reach is strictly better.
//
// Two ways in, because the native app has two: a button, and going away.
// Leaving the tab hands the video to a small window on its own, which is the
// behaviour people mean when they say "like the app".
//
// The visibilitychange listener here does not fight the one in
// src/main/backgroundPlay.ts, which swallows the event so the page never pauses.
// That runs in the page's world; this runs in the extension's. Events are
// dispatched to each world separately, so stopping it there does not stop it
// here — and document.hidden read from this side is the real value, not the
// spoofed one.
//
// Two APIs, because iOS is the target. `requestPictureInPicture` is the standard
// one and is what Chrome implements; WebKit has its own
// `webkitSetPresentationMode`, and on iPhone that is the only one there is.

const BUTTON_ID = 'oc-abp-pip'

interface WebkitVideo extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  /** 'inline' | 'fullscreen' | 'picture-in-picture' — what actually happened. */
  webkitPresentationMode?: string
  /** iOS only. Its native player carries a PiP control of its own. */
  webkitEnterFullscreen?: () => void
}

/** How long to wait before deciding webkitSetPresentationMode did nothing. */
const PRESENTATION_SETTLE_MS = 900

let observer: MutationObserver | null = null

/** The video actually being watched — the largest one that has loaded metadata. */
function playerVideo(): WebkitVideo | null {
  const videos = [...document.querySelectorAll<WebkitVideo>('video')]
  if (videos.length === 0) return null
  return videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best))
}

/** Say it on the screen. A phone has no console, and this has to be debuggable there. */
function toast(text: string): void {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:164px', 'transform:translateX(-50%)',
    'z-index:2147483647', 'max-width:88vw', 'padding:10px 14px',
    'border-radius:10px', 'background:rgba(24,24,37,.94)', 'color:#fff',
    'font:600 13px/1.5 -apple-system,system-ui,sans-serif', 'text-align:center',
    'pointer-events:none',
  ].join(';')
  document.documentElement.appendChild(el)
  setTimeout(() => el.remove(), 4200)
}

async function enterPip(video: WebkitVideo, quiet = false): Promise<void> {
  const say = (text: string) => {
    if (!quiet) toast(text)
  }

  // Which routes exist, said out loud. On the device this is the only way to
  // tell "no entry point" from "the entry point refused", and those need
  // opposite fixes.
  const routes = [
    typeof video.webkitSetPresentationMode === 'function' ? 'webkit' : null,
    typeof video.requestPictureInPicture === 'function' ? 'standard' : null,
    typeof video.webkitEnterFullscreen === 'function' ? 'fullscreen' : null,
  ].filter(Boolean)
  say(`PiP 진입점: ${routes.length ? routes.join(' · ') : '없음'}`)

  // WebKit first: on iOS the standard call exists on no version we target.
  //
  // It can also fail without failing. WebKit's own reports have
  // webkitSetPresentationMode throwing nothing, firing
  // webkitpresentationmodechanged, and leaving no window on screen. Returning on
  // the strength of "it did not throw" would leave the button dead in exactly
  // that case, so this waits and reads back what mode the video ended up in.
  if (typeof video.webkitSetPresentationMode === 'function') {
    try {
      video.webkitSetPresentationMode('picture-in-picture')
      await new Promise((resolve) => setTimeout(resolve, PRESENTATION_SETTLE_MS))
      if (video.webkitPresentationMode === 'picture-in-picture') return
      say(`webkit 이 무응답 (모드: ${video.webkitPresentationMode ?? '알 수 없음'})`)
    } catch (e) {
      say(`webkit 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (typeof video.requestPictureInPicture === 'function') {
    try {
      await video.requestPictureInPicture()
      return
    } catch (e) {
      say(`표준 API 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Neither worked. On iOS the system's own fullscreen player carries a PiP
  // control, so handing the video to it is one tap from where the user was
  // trying to get. Doing nothing at all is the only worse option.
  if (typeof video.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen()
      say('전체화면으로 넘어갔습니다 — 거기 PiP 버튼이 있습니다')
      return
    } catch (e) {
      say(`전체화면도 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  say('이 브라우저에서 PiP 진입점을 찾지 못했습니다')
}

/** Clear the page's opt-out. It is an attribute and a property; both count. */
function allowPip(video: WebkitVideo): void {
  if (video.hasAttribute('disablePictureInPicture')) {
    video.removeAttribute('disablePictureInPicture')
  }
  if (video.disablePictureInPicture) video.disablePictureInPicture = false
}

function ensureButton(video: WebkitVideo): void {
  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
  if (button?.isConnected) {
    // Keep it pointing at whatever video is current — YouTube swaps the element
    // out on navigation without touching ours.
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      void enterPip(video)
    }
    return
  }

  button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.title = '화면 속 화면으로 보기'
  button.setAttribute('aria-label', '화면 속 화면으로 보기')

  // Fixed to the viewport and parented to <html>, not to the player.
  //
  // Inside the player it was visible and unpressable: YouTube stacks its own
  // controls over that corner, and whichever of its layers owns the tap owns it
  // whatever z-index we ask for — a child cannot climb out of its parent's
  // stacking context. Out here there is nothing above it.
  //
  // Bottom right, clear of the player's controls and of the mobile navigation
  // bar. 44px because that is the smallest thing a thumb reliably hits.
  button.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:104px',
    'z-index:2147483647',
    'width:44px',
    'height:44px',
    'display:grid',
    'place-items:center',
    'padding:0',
    'margin:0',
    'border:none',
    'border-radius:12px',
    'background:rgba(24,24,37,.86)',
    'box-shadow:0 6px 20px -6px rgba(0,0,0,.6)',
    'cursor:pointer',
    'touch-action:manipulation',
    '-webkit-tap-highlight-color:transparent',
  ].join(';')
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="#fab387" stroke="none"/></svg>'

  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    void enterPip(video)
  }

  // Parented to <html> rather than <body>: YouTube rewrites body's children on
  // navigation, and a button that vanishes on every tap through the app is
  // worse than one that was never there.
  document.documentElement.appendChild(button)
}

function sweep(): void {
  const video = playerVideo()
  if (!video) return
  allowPip(video)
  // Drawn whenever there is a video. Gating on a capability check meant no
  // button at all on the device this was written for — webkitSupportsPresentation
  // Mode answers "not yet" before the video has metadata — and a button that
  // reports why it failed beats one that never appears.
  ensureButton(video)
}

const AUTO_ATTR = 'data-oc-abp-autopip'

/**
 * Hand the video over when the tab goes away.
 *
 * Quiet, deliberately: nobody is looking at the screen at that moment, and a
 * toast that fires as you leave would be waiting for you when you come back.
 * The attribute is left behind so the behaviour is observable — from a test, and
 * from the diagnostics panel.
 */
export function shouldAutoPip(state: {
  hidden: boolean
  video: { paused: boolean; ended: boolean } | null
}): boolean {
  // Nothing to hand over if the tab is still in front, if there is no video, or
  // if it was not playing — putting a paused video in a floating window is a
  // window nobody asked for, sitting over whatever they left to do.
  if (!state.hidden) return false
  if (!state.video) return false
  return !state.video.paused && !state.video.ended
}

async function onHidden(): Promise<void> {
  const video = playerVideo()
  if (!shouldAutoPip({ hidden: document.hidden, video })) return
  if (!video) return
  document.documentElement.setAttribute(AUTO_ATTR, 'tried')
  await enterPip(video, true)
}

/** Start offering PiP. Safe to call repeatedly. */
export function enablePictureInPicture(): void {
  sweep()
  document.removeEventListener('visibilitychange', onHidden)
  document.addEventListener('visibilitychange', onHidden)
  if (observer) return
  // YouTube replaces the player wholesale on navigation, taking the button with
  // it, so this watches rather than running once.
  observer = new MutationObserver(() => sweep())
  // Attributes as well as nodes: YouTube can put disablePictureInPicture back on
  // the same element it was taken off, and watching only for new nodes misses
  // that entirely — the opt-out returns and nothing notices.
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disablepictureinpicture', 'src'],
  })
}

/** Stop, and leave no trace. */
export function disablePictureInPicture(): void {
  observer?.disconnect()
  observer = null
  document.removeEventListener('visibilitychange', onHidden)
  document.documentElement.removeAttribute(AUTO_ATTR)
  document.getElementById(BUTTON_ID)?.remove()
}
