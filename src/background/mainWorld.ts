// Register the MAIN world content script at runtime, in addition to the static
// declaration in the manifest.
//
// Why both:
//   Chrome honours `world` on static content_scripts, and that path is the fast
//   one: the script is there before the parser reaches YouTube's first inline
//   script. Nothing beats it, so it stays.
//
//   WebKit-based browsers — Orion among them — ignore that field depending on
//   version. When they do, main.js runs in ISOLATED and hooking JSON.parse
//   there leaves the page seeing the original: layer 1 dies completely, with no
//   error at all. registerContentScripts with world:'MAIN' is fully supported
//   there, and where it is not supported it **throws**. Failing loudly beats
//   being silently wrong.
//
//   Registering something the manifest already declared is harmless — the guard
//   in main/index.ts installs the hooks once however many times the script runs.
//   Measured: dropping the static declaration and relying on this alone made
//   layer 1 lose the race against YouTube's inline script.
//
// persistAcrossSessions registers it with the browser permanently, so from then
// on it is injected at document_start whether or not the worker is awake.
//
// If registration fails, isolated/injectMain.ts picks it up with a <script src> fallback.

const SCRIPT_ID = 'oc-ad-bye-pass-main'

/**
 * The video site only, even though main.js now loads everywhere.
 *
 * Widening this looks like the better path — a registered MAIN script beats the
 * `<script src>` fallback the pop-up guard otherwise takes on WebKit — but it
 * risks the one thing that must not break. `registerContentScripts` throws when
 * the matches exceed the granted host permissions, and this extension asks for
 * every https origin optionally rather than up front. A widened registration that
 * throws does not fall back to a narrower one: it takes the video site's
 * registration down with it, and layer 1 drops to the injection fallback that
 * can miss the first pre-roll.
 *
 * So the guaranteed-grantable set stays, and away from the video site the
 * fallback in isolated/injectMain.ts does the work. It is late — after the
 * parser rather than before it — which is fatal for a response hook and merely
 * imperfect for a window that opens on interaction.
 */
const MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']

export async function ensureMainWorldScript(): Promise<void> {
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
