// Keep the media session answering after iOS has stopped the page.
//
// iOS treats <audio> and <video> differently when the app goes away: audio
// carries on, video stops. No amount of lying to the page about its visibility
// changes that — the decision is the system's, not the page's, and it is made
// about the element's type.
//
// What survives is the *session*. The video is paused but still the thing Now
// Playing points at, and the play button in Control Centre or on the lock
// screen resumes it — in the background, where the page could not have started
// it itself. That is the difference between "it stopped" and "it stopped and
// there is no way back".
//
// Whether that button works depends on there being a handler for it. YouTube
// registers its own and they go through its player, which is asleep along with
// the rest of the page; hooking the element directly is a shorter path and one
// that does not need YouTube's code to run.
//
// This does not make background playback automatic. Picture-in-picture is what
// does that on this platform. This is the fallback for when PiP was not
// entered — one press instead of unlocking, finding the tab, and pressing play.

import { clearUserPause, markUserPause } from './intent.ts'

interface WebkitVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
  // disableRemotePlayback is already on HTMLVideoElement — YouTube sets it, and
  // it takes the video out of Now Playing along with AirPlay.
}

let bound: WebkitVideo | null = null
let remoteWatcher: MutationObserver | null = null

/*
 * Set once per video element, and then left alone.
 *
 * The page can take these back — there is one registration per action for the
 * whole document and the last caller owns it — and two answers to that were
 * tried and both were worse than the problem. A two-second timer re-registering
 * them is polling against a page that will always be faster, and at the DOM
 * sweep's rate it rebuilt the session faster than iOS would answer for it, which
 * left the lock-screen play button dead. Refusing the page its own
 * `setActionHandler` works, and reaches into the page to do it.
 *
 * So: once, when the element changes. If YouTube takes them, it takes them.
 */

/**
 * Put the video back in the system's Now Playing.
 *
 * disableRemotePlayback reads like an AirPlay switch and is more than that:
 * with it set, the element is out of Now Playing, and the play button on the
 * lock screen has nothing behind it. That button is the only thing that wakes a
 * suspended web process on iOS, so this is the difference between "stopped" and
 * "stopped for good".
 */
function allowRemotePlayback(video: WebkitVideo): void {
  if (video.hasAttribute('disableremoteplayback')) {
    video.removeAttribute('disableremoteplayback')
  }
  if (video.disableRemotePlayback) video.disableRemotePlayback = false
}

/**
 * And keep putting it back. YouTube sets it again — on navigation, on quality
 * changes, whenever its player reinitialises — so clearing it once holds until
 * the first thing that happens.
 */
function watchRemotePlayback(video: WebkitVideo): void {
  remoteWatcher?.disconnect()
  remoteWatcher = new MutationObserver(() => allowRemotePlayback(video))
  remoteWatcher.observe(video, { attributes: true, attributeFilter: ['disableremoteplayback'] })
}

function largestVideo(): WebkitVideo | null {
  const videos = [...document.querySelectorAll<WebkitVideo>('video')]
  if (videos.length === 0) return null
  return videos.reduce((best, v) => (v.clientWidth > best.clientWidth ? v : best))
}

/**
 * Point the system's transport controls at the video itself.
 *
 * Re-bound rather than bound once: YouTube replaces the element on navigation,
 * and a handler holding the previous one resumes a video that is no longer on
 * screen.
 */
export function bindMediaSession(): void {
  const session = navigator.mediaSession
  if (!session?.setActionHandler) return

  const video = largestVideo()
  if (!video || video === bound) return
  bound = video


  allowRemotePlayback(video)
  watchRemotePlayback(video)

  // Without metadata iOS has nothing to draw on the lock screen, and a media
  // session it cannot present is one it need not keep.
  try {
    const title = document.title.replace(/\s*-\s*YouTube\s*$/, '').trim() || 'YouTube'
    const artwork = [...document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"]')]
      .map((m) => m.content)
      .filter(Boolean)
      .map((src) => ({ src, sizes: '480x360', type: 'image/jpeg' }))
    session.metadata = new MediaMetadata({ title, artist: 'YouTube', artwork })
  } catch {
    // MediaMetadata is missing on some engines; the handlers below still help.
  }

  setHandlers(video)

  // Keep the state honest, so the button on the lock screen shows the right
  // symbol and iOS does not decide the session is stale.
  const sync = () => {
    // Playing again, however it happened — whatever they meant by pausing is spent.
    if (!video.paused) clearUserPause()
    session.playbackState = video.paused ? 'paused' : 'playing'
    // Re-applied here too: YouTube can set the property directly, and a
    // property assignment leaves no attribute for the observer above to see.
    allowRemotePlayback(video)
  }
  video.addEventListener('play', sync)
  video.addEventListener('pause', sync)
  sync()
}

/**
 * Point the four transport actions at this video. Safe to call repeatedly.
 */
function setHandlers(video: WebkitVideo): void {
  const session = navigator.mediaSession
  if (!session?.setActionHandler) return

  const safely = (action: MediaSessionAction, handler: () => void) => {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // Not every action is supported everywhere, and an unsupported one throws
      // rather than being ignored. The rest are still worth setting.
    }
  }

  safely('play', () => {
    clearUserPause()
    void video.play().catch(() => {})
    session.playbackState = 'playing'
  })
  safely('pause', () => {
    // The one place in this extension that is *told* a person pressed something.
    // Everywhere else has to infer it from where the page is, and the lock screen
    // is where inferring it gets the answer exactly backwards.
    markUserPause()
    video.pause()
    session.playbackState = 'paused'
  })

  safely('seekbackward', () => {
    video.currentTime = Math.max(0, video.currentTime - 10)
  })
  safely('seekforward', () => {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10)
  })

}

export function unbindMediaSession(): void {
  bound = null
  remoteWatcher?.disconnect()
  remoteWatcher = null
  if (navigator.mediaSession) navigator.mediaSession.metadata = null
  const session = navigator.mediaSession
  if (!session?.setActionHandler) return
  for (const action of ['play', 'pause', 'seekbackward', 'seekforward'] as MediaSessionAction[]) {
    try {
      session.setActionHandler(action, null)
    } catch {
      /* nothing to undo */
    }
  }
}
