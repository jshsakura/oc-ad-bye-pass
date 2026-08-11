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
// Off by default, like background playback: it adds a control to someone else's
// interface, which is not something to do uninvited.
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
    'position:fixed', 'left:50%', 'bottom:88px', 'transform:translateX(-50%)',
    'z-index:2147483647', 'max-width:88vw', 'padding:10px 14px',
    'border-radius:10px', 'background:rgba(24,24,37,.94)', 'color:#fff',
    'font:600 13px/1.5 -apple-system,system-ui,sans-serif', 'text-align:center',
    'pointer-events:none',
  ].join(';')
  document.documentElement.appendChild(el)
  setTimeout(() => el.remove(), 4200)
}

async function enterPip(video: WebkitVideo): Promise<void> {
  // Which routes exist, said out loud. On the device this is the only way to
  // tell "no entry point" from "the entry point refused", and those need
  // opposite fixes.
  const routes = [
    typeof video.webkitSetPresentationMode === 'function' ? 'webkit' : null,
    typeof video.requestPictureInPicture === 'function' ? 'standard' : null,
    typeof video.webkitEnterFullscreen === 'function' ? 'fullscreen' : null,
  ].filter(Boolean)
  toast(`PiP 진입점: ${routes.length ? routes.join(' · ') : '없음'}`)

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
      toast(`webkit 이 무응답 (모드: ${video.webkitPresentationMode ?? '알 수 없음'})`)
    } catch (e) {
      toast(`webkit 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (typeof video.requestPictureInPicture === 'function') {
    try {
      await video.requestPictureInPicture()
      return
    } catch (e) {
      toast(`표준 API 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Neither worked. On iOS the system's own fullscreen player carries a PiP
  // control, so handing the video to it is one tap from where the user was
  // trying to get. Doing nothing at all is the only worse option.
  if (typeof video.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen()
      toast('전체화면으로 넘어갔습니다 — 거기 PiP 버튼이 있습니다')
      return
    } catch (e) {
      toast(`전체화면도 거절: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  toast('이 브라우저에서 PiP 진입점을 찾지 못했습니다')
}

/** Clear the page's opt-out. It is an attribute and a property; both count. */
function allowPip(video: WebkitVideo): void {
  if (video.hasAttribute('disablePictureInPicture')) {
    video.removeAttribute('disablePictureInPicture')
  }
  if (video.disablePictureInPicture) video.disablePictureInPicture = false
}

function ensureButton(video: WebkitVideo): void {
  const player = video.closest<HTMLElement>('#movie_player, .html5-video-player') ?? video.parentElement
  if (!player) return

  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null
  if (button?.isConnected && button.parentElement === player) return

  button?.remove()
  button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.title = '화면 속 화면으로 보기'
  button.setAttribute('aria-label', '화면 속 화면으로 보기')
  // Inline styles rather than the extension stylesheet: that sheet hides things,
  // and a rule there could be undone by the very filters this project ships.
  button.style.cssText = [
    'position:absolute',
    'top:8px',
    'right:8px',
    'z-index:2147483000',
    'width:40px',
    'height:40px',
    'display:grid',
    'place-items:center',
    'padding:0',
    'border:none',
    'border-radius:8px',
    'background:rgba(24,24,37,.72)',
    'cursor:pointer',
  ].join(';')
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="#fab387" stroke="none"/></svg>'

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation() // The player treats a click on itself as play/pause.
    void enterPip(video)
  })

  // The player is positioned by YouTube; if it is not, the button would anchor
  // to the page instead of the video.
  if (getComputedStyle(player).position === 'static') player.style.position = 'relative'
  player.appendChild(button)
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

/** Start offering PiP. Safe to call repeatedly. */
export function enablePictureInPicture(): void {
  sweep()
  if (observer) return
  // YouTube replaces the player wholesale on navigation, taking the button with
  // it, so this watches rather than running once.
  observer = new MutationObserver(() => sweep())
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

/** Stop, and leave no trace. */
export function disablePictureInPicture(): void {
  observer?.disconnect()
  observer = null
  document.getElementById(BUTTON_ID)?.remove()
}
