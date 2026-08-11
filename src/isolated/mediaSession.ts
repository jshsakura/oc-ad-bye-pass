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

interface WebkitVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
  // disableRemotePlayback is already on HTMLVideoElement — YouTube sets it, and
  // it takes the video out of Now Playing along with AirPlay.
}

let bound: WebkitVideo | null = null

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

  // YouTube marks the element disableRemotePlayback, which is not only about
  // AirPlay: it is what keeps the video out of the system's Now Playing
  // handling, and with it out of there the Control Centre button has nothing to
  // resume. Attribute and property both, as with the picture-in-picture opt-out.
  if (video.hasAttribute('disableremoteplayback')) {
    video.removeAttribute('disableremoteplayback')
  }
  if (video.disableRemotePlayback) video.disableRemotePlayback = false

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

  const safely = (action: MediaSessionAction, handler: () => void) => {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // Not every action is supported everywhere, and an unsupported one throws
      // rather than being ignored. The rest are still worth setting.
    }
  }

  safely('play', () => {
    void video.play().catch(() => {})
    session.playbackState = 'playing'
  })
  safely('pause', () => {
    video.pause()
    session.playbackState = 'paused'
  })

  // Keep the state honest, so the button on the lock screen shows the right
  // symbol and iOS does not decide the session is stale.
  const sync = () => {
    session.playbackState = video.paused ? 'paused' : 'playing'
  }
  video.addEventListener('play', sync)
  video.addEventListener('pause', sync)
  sync()
  safely('seekbackward', () => {
    video.currentTime = Math.max(0, video.currentTime - 10)
  })
  safely('seekforward', () => {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10)
  })
}

export function unbindMediaSession(): void {
  bound = null
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
