// Bundled default rules — what works the moment you install, with no network.
//
// The remote filter list (filters/youtube.json) does not "override" this list,
// it unions with it. So when YouTube renames a tag you only add the new
// selector to the JSON; the stale one left here matches nothing and is harmless.
//
// The selectors are ReVanced's AdsFilter/ShortsFilter litho buffer strings
// translated to web renderer tags. e.g. carousel_ad -> ytd-carousel-ad-renderer,
// statement_banner -> ytd-statement-banner-renderer,
// product_carousel -> ytd-merch-shelf-renderer.
//
// Rule against false positives: match on tag names only, never class-name
// heuristics. (ReVanced makes the same call, excepting home_video_with_context,
// related_video_with_context and comment_thread — touch an ordinary video card
// and the whole feed disappears.)

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
    // Remove the wrapper too, or the feed is left with a gap where the ad was
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)',
    // Mobile web and Music
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
    // cta_shelf_card — the "see this product" prompts laid over the video
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
  // The only group applied outside YouTube. Everything here has to be safe on
  // *any* site, so it is deliberately small and anchored on ad-network markers
  // rather than on words like "banner" that ordinary pages also use.
  //
  // Most display ads are fetched from an ad network, so the network layer (DNR)
  // already stops them and the slot collapses on its own. These selectors are
  // for the leftovers: markup the page itself ships.
  genericAds: [
    'ins.adsbygoogle',
    '.adsbygoogle',
    '[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
    '[id^="taboola-"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="adservice.google"]',
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[id^="google_ads"]',
    '[data-ad-client]',
    '[data-ad-slot]',
    '[aria-label="Advertisement"]',
    '[aria-label="광고"]',
  ],
  antiAdblockNag: [
    'ytd-enforcement-message-view-model',
    'ytd-popup-container:has(ytd-enforcement-message-view-model)',
    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
  ],
  // "Open in the YouTube app" nags. Mobile web (m.youtube.com) only.
  //
  // iOS Safari draws its smart app banner from <meta name="apple-itunes-app">,
  // so no selector here can touch it — isolated/appbanner.ts removes the tag
  // itself. This group covers the banners, toasts and deep links YouTube draws
  // into the DOM on its own.
  //
  // NOTE: these renderer tags are unverified on a real device. YouTube mobile
  // web varies by experiment group, so if something slips through, grab the tag
  // in devtools and add it to the appPromo group in filters/youtube.json — it
  // lands without a reinstall.
  appPromo: [
    'ytm-app-promo-renderer',
    'ytm-app-promo-toast-renderer',
    'ytm-mobile-topbar-app-promo-renderer',
    'ytm-app-install-banner-renderer',
    'ytd-app-promo-renderer',
    // App deep links — tapping one leaves for somewhere the extension cannot run
    'a[href^="youtube://"]',
    'a[href^="vnd.youtube:"]',
  ],
}

/** Close buttons we press when they appear (tied to the fullscreenAds toggle). */
export const BUNDLED_CLICK: string[] = [
  '.ytp-ad-overlay-close-button',
  '.ytp-ad-overlay-close-container',
  '.ytp-ad-feedback-dialog-close-button',
]

/** Skip buttons for ads that got through (playerFallback toggle). */
export const SKIP_BUTTONS: string[] = [
  '.ytp-ad-skip-button-modern',
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-survey-answer-text',
]

/**
 * Paths to strip from the player response.
 *
 * The same fields ReVanced's video-ads patch removes from PlayerResponseModel,
 * and the same list AdGuard's json-prune scriptlet uses.
 *
 * frameworkUpdates is deliberately absent: UI updates unrelated to ads
 * (subscription and playlist state) ride along in it, so cutting it breaks YouTube.
 */
export const BUNDLED_PRUNE: string[] = [
  'adPlacements',
  'playerAds',
  'adSlots',
  'adBreakHeartbeatParams',
  'playerConfig.adConfig',
  'auxiliaryUi.messageRenderers.upsellDialogRenderer',
]
