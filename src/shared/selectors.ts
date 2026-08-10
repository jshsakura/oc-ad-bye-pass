// 번들 기본 규칙 — 설치 직후, 네트워크 없이도 이만큼은 동작한다.
//
// 원격 필터 리스트(filters/youtube.json)는 이 목록을 "덮어쓰는" 게 아니라
// 합집합으로 더한다. 그래서 유튜브가 태그를 바꾸면 새 셀렉터를 JSON 에만 추가하면
// 되고, 여기 남은 옛 셀렉터는 아무것도 매칭하지 않으므로 무해하다.
//
// 셀렉터는 ReVanced 의 AdsFilter/ShortsFilter 가 쓰는 litho buffer string 을
// 웹 렌더러 태그로 옮긴 것이다. 예) carousel_ad → ytd-carousel-ad-renderer,
// statement_banner → ytd-statement-banner-renderer, product_carousel → ytd-merch-shelf-renderer.
//
// 오탐 방지 원칙: 태그명 기준으로만 쓰고 클래스 휴리스틱은 쓰지 않는다.
// (ReVanced 도 home_video_with_context / related_video_with_context / comment_thread 를
//  예외로 두고 있다 — 일반 영상 카드를 건드리면 피드가 통째로 사라진다.)

import type { ToggleKey } from './settings.ts'

export const BUNDLED_HIDE: Partial<Record<ToggleKey, string[]>> = {
  generalAds: [
    '#masthead-ad',
    'ytd-ad-slot-renderer',
    'ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-video-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-carousel-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-primetime-promo-renderer',
    'ytd-brand-video-shelf-renderer',
    'ytd-brand-video-singleton-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-search-pyv-renderer',
    'ytd-video-masthead-ad-v3-renderer',
    'ytd-video-masthead-ad-advertiser-info-renderer',
    // 광고 카드를 감싼 껍데기까지 지워야 피드에 빈칸이 남지 않는다
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)',
    // 모바일 웹 / 뮤직
    'ytm-promoted-video-renderer',
    'ytm-companion-ad-renderer',
    'ytm-compact-promoted-video-renderer',
    'ytmusic-statement-banner-renderer',
  ],
  shortsAds: [
    'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)',
    'ytm-reel-item-renderer:has(ytd-ad-slot-renderer)',
    '#shorts-inner-container ytd-ad-slot-renderer',
    'ytd-reel-shelf-renderer:has(ytd-ad-slot-renderer)',
  ],
  merchandise: [
    'ytd-merch-shelf-renderer',
    'ytd-product-details-renderer',
    'ytd-engagement-panel-section-list-renderer[target-id="shopping_panel"]',
    'ytmusic-merch-shelf-renderer',
    // cta_shelf_card — 영상 위에 뜨는 "이 제품 보기" 류 제안
    '.ytp-suggested-action',
  ],
  getPremium: [
    'ytd-mealbar-promo-renderer',
    'yt-mealbar-promo-renderer',
    'ytmusic-mealbar-promo-renderer',
    'ytd-popup-container:has(yt-mealbar-promo-renderer)',
    'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
    'ytd-rich-section-renderer:has(ytd-primetime-promo-renderer)',
  ],
  fullscreenAds: [
    '.ytp-ad-overlay-slot',
    '.ytp-ad-overlay-container',
    '.ytp-ad-image-overlay',
    '.ytp-ad-player-overlay-layout',
    'ytd-in-player-ad-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-companion-slot-renderer',
  ],
  antiAdblockNag: [
    'ytd-enforcement-message-view-model',
    'ytd-popup-container:has(ytd-enforcement-message-view-model)',
    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
  ],
}

/** 화면에 나타나면 눌러주는 닫기 버튼들 (fullscreenAds 토글에 묶인다) */
export const BUNDLED_CLICK: string[] = [
  '.ytp-ad-overlay-close-button',
  '.ytp-ad-overlay-close-container',
  '.ytp-ad-feedback-dialog-close-button',
]

/** 광고가 뚫렸을 때 누를 스킵 버튼 (playerFallback 토글) */
export const SKIP_BUTTONS: string[] = [
  '.ytp-ad-skip-button-modern',
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-survey-answer-text',
]

/**
 * 플레이어 응답에서 잘라낼 경로.
 * ReVanced 의 video-ads 패치가 PlayerResponseModel 에서 없애는 것과 같은 필드들이고,
 * AdGuard 의 json-prune 스크립틀릿이 쓰는 목록과도 일치한다.
 *
 * frameworkUpdates 는 일부러 뺐다 — 광고와 무관한 UI 갱신(구독/재생목록 상태)이
 * 같이 실려 오기 때문에 자르면 유튜브가 깨진다.
 */
export const BUNDLED_PRUNE: string[] = [
  'adPlacements',
  'playerAds',
  'adSlots',
  'adBreakHeartbeatParams',
  'playerConfig.adConfig',
  'auxiliaryUi.messageRenderers.upsellDialogRenderer',
]
