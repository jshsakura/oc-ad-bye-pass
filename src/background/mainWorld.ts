// Safari only — register the MAIN world content script at runtime.
//
// Why here instead of the manifest:
//   Safari ignores the `world` field on static content_scripts, depending on
//   version. When it does, main.js runs in ISOLATED, and hooking JSON.parse
//   there leaves the page seeing the original — layer 1 dies completely with no
//   error at all. By contrast scripting.registerContentScripts with
//   world:'MAIN' is properly supported from Safari 16.4, and where it is not,
//   it **throws**. Failing loudly beats being silently wrong.
//
// persistAcrossSessions registers it with the browser permanently, so from then
// on it is injected at document_start whether or not the worker is awake.
//
// If registration fails, isolated/injectMain.ts picks it up with a <script src> fallback.

const SCRIPT_ID = 'oc-ad-bye-pass-main'
const MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']

export async function ensureMainWorldScript(): Promise<void> {
  // A build constant (see shared/target.ts). Everything below vanishes from the Chrome bundle.
  if (!__IS_SAFARI__) return

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    if (existing.length > 0) return

    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: MATCHES,
        js: ['main.js'],
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ])
  } catch (e) {
    // Not fatal — the fallback exists. But seeing this warning means layer 1 is
    // running through it, and the fallback can miss the first pre-roll.
    console.warn('[oc-ad-bye-pass] MAIN world 등록 실패 — 주입 폴백으로 동작합니다', e)
  }
}
