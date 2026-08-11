// Reproduces YouTube's *structure* without ever touching the real youtube.com.
//
// The trick: Playwright's route intercepts https://www.youtube.com/** and
// returns our own HTML. The document's origin is genuinely
// https://www.youtube.com, so the extension's content_scripts match applies
// exactly as it would in the wild — which means "it only runs on YouTube" gets
// verified along the way.
//
// All three paths by which ads actually arrive are reproduced:
//   A. inline script's var ytInitialPlayerResponse = {...}   (global setter hook)
//   B. JSON.parse('{...}')                                   (JSON.parse hook)
//   C. fetch('/youtubei/v1/player') -> res.json()            (Response.json hook)

import type { BrowserContext } from '@playwright/test'

export const YOUTUBE_URL = 'https://www.youtube.com/watch?v=testvideo'

/** Ad clip length in seconds. Layer 3 is expected to seek all the way here. */
export const AD_DURATION_SECONDS = 2

/**
 * Builds genuinely playable media (a silent WAV).
 *
 * Stubs cannot do this job. The extension's content script runs in the ISOLATED
 * world, so replacing HTMLMediaElement.prototype from the page (MAIN world) is
 * invisible to it. Real DOM state such as currentTime, muted and paused *is*
 * shared between the worlds, so attaching real media lets us read "did it
 * genuinely seek the ad to the end?" directly.
 */
function silentWavDataUri(seconds: number): string {
  const sampleRate = 8000
  const samples = sampleRate * seconds
  const buffer = Buffer.alloc(44 + samples)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate, 28) // byteRate (equals sampleRate for 8-bit mono)
  buffer.writeUInt16LE(1, 32) // blockAlign
  buffer.writeUInt16LE(8, 34) // bitsPerSample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples, 40)
  buffer.fill(128, 44) // silence in 8-bit unsigned PCM

  return `data:audio/wav;base64,${buffer.toString('base64')}`
}

const AD_MEDIA_SRC = silentWavDataUri(AD_DURATION_SECONDS)

/** A player response mixing ad fields with legitimate ones. */
function playerResponse(tag: string) {
  return {
    responseContext: { visitorData: 'fake' },
    adPlacements: [{ adPlacementRenderer: { renderer: { instreamVideoAdRenderer: {} } } }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    adBreakHeartbeatParams: 'Q0FF',
    playerConfig: { adConfig: { showCompanion: true }, audioConfig: { loudnessDb: 1 } },
    videoDetails: { videoId: tag, title: '테스트 영상' },
    streamingData: { formats: [{ itag: 18 }] },
  }
}

export const PLAYER_API_RESPONSE = playerResponse('from-fetch')

interface FixtureOptions {
  /** false gives the "unskippable ad" scenario, with no skip button. */
  skippable?: boolean
  /** The user already muted it — the extension must not undo that. */
  userMuted?: boolean
}

function html({ skippable = true, userMuted = false }: FixtureOptions): string {
  const inlinePlayerResponse = JSON.stringify(playerResponse('from-inline'))
  const parseTarget = JSON.stringify({
    adPlacements: [{}],
    playerAds: [{}],
    adSlots: [{}],
    videoDetails: { videoId: 'from-json-parse' },
  })

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>Fake YouTube</title>

<script>
// ── Click observation. DOM events are shared between the MAIN and ISOLATED
//    worlds, so a click made by the extension shows up here too.
//    (Capture phase catches events from elements that do not exist yet.)
window.__observed = { skipClicked: false, feedbackClosed: false };

document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.closest) return;
  if (el.closest('.ytp-ad-skip-button-modern')) window.__observed.skipClicked = true;
  if (el.closest('.ytp-ad-feedback-dialog-close-button')) window.__observed.feedbackClosed = true;
}, true);
</script>

<script>
// ── Path A: inline global assignment, exactly as real YouTube does it.
var ytInitialPlayerResponse = ${inlinePlayerResponse};
var ytInitialData = { contents: {}, adSlots: [{ adSlotRenderer: {} }] };

// ── Path B: JSON.parse
window.__parsed = JSON.parse('${parseTarget.replace(/'/g, "\\'")}');
</script>

<style>
  body { font: 14px/1.6 system-ui, sans-serif; margin: 0; padding: 16px; }
  #masthead-ad, ytd-ad-slot-renderer, ytd-merch-shelf-renderer, ytd-mealbar-promo-renderer,
  ytd-display-ad-renderer, ytd-rich-item-renderer, ytd-rich-grid-media, ytd-statement-banner-renderer,
  ytd-enforcement-message-view-model, tp-yt-paper-dialog, ytd-popup-container,
  .ytp-ad-overlay-slot, #movie_player, .ytp-suggested-action, .ytp-ad-feedback-dialog-close-button {
    display: block; min-height: 28px; padding: 4px; border: 1px solid #ddd; margin: 4px 0;
  }
  /* A real backdrop covers the screen. At zero size it signals nothing is
     blocking — which is what the extension checks before resuming playback. */
  tp-yt-iron-overlay-backdrop {
    display: block; position: fixed; inset: 0; background: rgba(0,0,0,.5);
  }
</style>
</head>
<body>

<div id="masthead-ad">AD &mdash; masthead banner</div>

<div id="feed">
  <ytd-rich-item-renderer id="ad-card">
    <div id="content"><ytd-ad-slot-renderer>AD &mdash; in-feed ad slot</ytd-ad-slot-renderer></div>
  </ytd-rich-item-renderer>

  <ytd-rich-item-renderer id="normal-card">
    <div id="content"><ytd-rich-grid-media>VIDEO &mdash; normal card (must survive)</ytd-rich-grid-media></div>
  </ytd-rich-item-renderer>
</div>

<ytd-display-ad-renderer id="display-ad">AD &mdash; display ad</ytd-display-ad-renderer>
<ytd-merch-shelf-renderer id="merch">AD &mdash; merch shelf</ytd-merch-shelf-renderer>
<ytd-mealbar-promo-renderer id="premium">AD &mdash; Premium upsell</ytd-mealbar-promo-renderer>

<div id="movie_player" class="ad-showing">
  <video id="ad-video" preload="auto"${userMuted ? ' muted' : ''} src="${AD_MEDIA_SRC}"></video>
  <div class="ytp-ad-overlay-slot"><div class="ytp-ad-overlay-container">AD &mdash; player overlay</div></div>
  ${skippable ? '<button class="ytp-ad-skip-button-modern">Skip Ad</button>' : ''}
</div>

<button class="ytp-ad-feedback-dialog-close-button">Close ad feedback</button>

<div id="late-mount"></div>

<script>
// ── Path C: fetch -> Response.json()
window.__fetchState = 'pending';
fetch('/youtubei/v1/player', { method: 'POST', body: '{}' })
  .then(function (r) { return r.json(); })
  .then(function (j) { window.__fetched = j; window.__fetchState = 'done'; })
  .catch(function (e) { window.__fetchState = 'error: ' + e.message; });

// ── The ad-block warning appears after the stubs are in place (real YouTube raises it late too)
window.showAdblockNag = function () {
  var container = document.createElement('ytd-popup-container');
  container.id = 'nag-container';
  container.innerHTML =
    '<tp-yt-paper-dialog id="nag">' +
    '<ytd-enforcement-message-view-model>Ad blockers are not allowed on YouTube</ytd-enforcement-message-view-model>' +
    '</tp-yt-paper-dialog>';
  document.getElementById('late-mount').appendChild(container);
  var backdrop = document.createElement('tp-yt-iron-overlay-backdrop');
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
};
</script>

</body>
</html>`
}

/** Intercept all of youtube.com, serving the fake page and a fake InnerTube API. */
export async function installYouTubeFixture(
  context: BrowserContext,
  options: FixtureOptions = {},
): Promise<void> {
  await context.route('https://www.youtube.com/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.startsWith('/youtubei/v1/player')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(PLAYER_API_RESPONSE),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html(options),
    })
  })
}

/** A site that is not YouTube — the extension must stay out of it. */
export const OTHER_SITE_URL = 'https://example.com/'

export async function installOtherSiteFixture(context: BrowserContext): Promise<void> {
  await context.route('https://example.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>남의 사이트</title></head>
<body>
<div id="masthead-ad">NOT YouTube &mdash; this element must stay visible</div>
<ytd-ad-slot-renderer>NOT YouTube &mdash; this one too</ytd-ad-slot-renderer>
<script>
  window.__parsed = JSON.parse('{"adPlacements":[{}],"videoDetails":{"videoId":"other"}}');
</script>
</body></html>`,
    })
  })
}
