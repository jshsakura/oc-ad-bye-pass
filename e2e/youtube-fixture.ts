// 실제 youtube.com 을 때리지 않고 유튜브의 "구조"를 재현한다.
//
// 핵심 트릭: Playwright 의 route 로 https://www.youtube.com/** 를 가로채 우리 HTML 을
// 돌려준다. 문서의 origin 은 진짜 https://www.youtube.com 이므로 확장의 content_scripts
// 매치가 그대로 걸린다 — 즉 "유튜브에서만 동작한다"는 조건까지 같이 검증된다.
//
// 광고가 실제로 실리는 세 경로를 모두 재현한다.
//   A. 인라인 스크립트의 var ytInitialPlayerResponse = {...}   (전역 setter 훅)
//   B. JSON.parse('{...}')                                     (JSON.parse 훅)
//   C. fetch('/youtubei/v1/player') → res.json()               (Response.json 훅)

import type { BrowserContext } from '@playwright/test'

export const YOUTUBE_URL = 'https://www.youtube.com/watch?v=testvideo'

/** 광고 영상 길이(초). 3계층이 여기까지 감아버리는지 본다. */
export const AD_DURATION_SECONDS = 2

/**
 * 진짜 재생 가능한 미디어를 만든다 (무음 WAV).
 *
 * 스텁으로 때울 수 없어서 실물을 쓴다: 확장의 콘텐츠 스크립트는 ISOLATED world 라
 * 페이지(MAIN world)에서 HTMLMediaElement.prototype 을 갈아끼워도 보이지 않는다.
 * 반대로 currentTime·muted·paused 같은 실제 DOM 상태는 두 월드가 공유하므로,
 * 진짜 미디어를 물려두면 "정말로 광고를 끝까지 감았는가"를 있는 그대로 볼 수 있다.
 */
function silentWavDataUri(seconds: number): string {
  const sampleRate = 8000
  const samples = sampleRate * seconds
  const buffer = Buffer.alloc(44 + samples)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // fmt 청크 크기
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // 모노
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate, 28) // byteRate (8bit 모노라 sampleRate 와 같다)
  buffer.writeUInt16LE(1, 32) // blockAlign
  buffer.writeUInt16LE(8, 34) // bitsPerSample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples, 40)
  buffer.fill(128, 44) // 8bit unsigned PCM 의 무음

  return `data:audio/wav;base64,${buffer.toString('base64')}`
}

const AD_MEDIA_SRC = silentWavDataUri(AD_DURATION_SECONDS)

/** 광고 필드 + 정상 필드가 섞인 플레이어 응답 */
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
  /** false 면 스킵 버튼이 없는 "건너뛸 수 없는 광고" 시나리오 */
  skippable?: boolean
  /** 사용자가 이미 음소거해 둔 상태 — 확장이 이걸 멋대로 풀면 안 된다 */
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
// ── 클릭 관찰. DOM 이벤트는 MAIN/ISOLATED 월드가 공유하므로 확장이 누른 것도 여기서 보인다.
//    (capture 를 쓰면 아직 존재하지 않는 요소의 이벤트까지 잡을 수 있다)
window.__observed = { skipClicked: false, feedbackClosed: false };

document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.closest) return;
  if (el.closest('.ytp-ad-skip-button-modern')) window.__observed.skipClicked = true;
  if (el.closest('.ytp-ad-feedback-dialog-close-button')) window.__observed.feedbackClosed = true;
}, true);
</script>

<script>
// ── 경로 A: 인라인 전역 대입. 진짜 유튜브가 하는 그대로다.
var ytInitialPlayerResponse = ${inlinePlayerResponse};
var ytInitialData = { contents: {}, adSlots: [{ adSlotRenderer: {} }] };

// ── 경로 B: JSON.parse
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
// ── 경로 C: fetch → Response.json()
window.__fetchState = 'pending';
fetch('/youtubei/v1/player', { method: 'POST', body: '{}' })
  .then(function (r) { return r.json(); })
  .then(function (j) { window.__fetched = j; window.__fetchState = 'done'; })
  .catch(function (e) { window.__fetchState = 'error: ' + e.message; });

// ── 애드블록 경고창은 스텁이 다 깔린 뒤에 띄운다 (진짜 유튜브도 나중에 띄운다)
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

/** youtube.com 을 통째로 가로채 가짜 페이지와 가짜 InnerTube API 를 물린다. */
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

/** 유튜브가 아닌 사이트 — 확장이 개입하지 않아야 한다 */
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
