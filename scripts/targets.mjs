// Build target definitions. vite, esbuild and the manifest generator all read
// this file.
//
//   chrome  The product. One package for Chrome, Edge and Orion — on 2026-08-19
//           the full package installed on a real iPhone (Orion shows a one-time
//           compatibility warning for declarativeNetRequest and runs everything
//           else), which retired the shipped split.
//   firefox Firefox and its forks — Zen, LibreWolf, Floorp. Gecko does not run
//           extension service workers, so the background becomes an event page;
//           everything else is the same code. AMO signs it, which is what makes
//           it installable at all: a release-channel Gecko browser refuses an
//           unsigned extension, so there is no sideload path the way there is
//           on Chrome.
//   orion   Dormant fallback, not shipped since v0.13.0. The same code with
//           declarativeNetRequest and two Chrome-only manifest keys stripped —
//           kept buildable (`npm run build:orion`) in case an Orion version
//           turns up that hard-refuses the full manifest, as one appeared to
//           in 2026-08-11 ("Extensions Error", no reason given; the cache was
//           the likelier culprit in hindsight).
//
// A Safari target existed until 2026-08-11 and was dropped whole; the git
// history has it if it is ever wanted back.

export const TARGETS = {
  chrome: {
    outDir: 'dist',
    // esbuild downlevel target, kept in step with minimum_chrome_version in the manifest.
    esbuildTarget: 'chrome120',
  },
  firefox: {
    outDir: 'dist-firefox',
    // 128 is what the code needs — the release that brought world:'MAIN' for
    // manifest content scripts and optional_host_permissions, below which
    // layer 1 silently does nothing. The manifest floor below is higher for a
    // different reason; see strict_min_version.
    esbuildTarget: 'firefox128',
    strip: {
      // Gecko ignores it, but the AMO linter flags keys that mean nothing here
      // and a warning on a submission is a thing a reviewer has to read past.
      keys: ['minimum_chrome_version'],
    },
    // Merged over the manifest at the top level, after the stripping. Shallow
    // on purpose: `background` has to *replace* what is there, not merge into
    // it, or the Chrome service_worker key would survive alongside the scripts.
    patch: {
      // Firefox has no extension service worker — MV3 there is an event page.
      // background.js is already an IIFE with no module imports and touches no
      // worker-only global, so the same bundle runs unchanged.
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'oc-ad-bye-pass@jshsakura.com',
          // Higher than the 128 the code needs, and the AMO linter is what says
          // so: data_collection_permissions below is itself a 140 key, and
          // declaring a floor beneath the keys you use is how an extension
          // installs on a browser that then ignores half its manifest.
          strict_min_version: '140.0',
          // Required on every new AMO submission since 2025-11-03, and being
          // able to answer "none" honestly is worth keeping true: the three
          // requests this extension makes are a filter list from GitHub, a
          // version check from GitHub, and four characters of a hash to
          // SponsorBlock. No request carries anything about who is asking.
          data_collection_permissions: { required: ['none'] },
        },
        // Android got the same key two releases later, and it is tracked
        // separately or the desktop floor is read as covering both.
        gecko_android: { strict_min_version: '142.0' },
      },
    },
  },
  orion: {
    outDir: 'dist-orion',
    // Orion is WebKit. 16.4 is the release that brought MV3 service workers and
    // world:'MAIN' in scripting.registerContentScripts, so that is the floor.
    esbuildTarget: 'safari16.4',
    // Everything below is removed from the manifest for this target.
    strip: {
      keys: [
        // Unsupported, and declaring it is the leading suspect for the refusal.
        'declarative_net_request',
        // Chrome-only. A key WebKit does not know is a key it can reject.
        'minimum_chrome_version',
        // Safari never recognised it either; it only adds install warnings.
        'optional_host_permissions',
      ],
      permissions: ['declarativeNetRequest'],
      // Nothing reads the ruleset without the key — it would be 3.6MB of dead
      // weight in a package installed over a phone connection.
      dirs: ['rules'],
    },
  },
}

export const DEFAULT_TARGET = 'chrome'

/** Read the TARGET environment variable and return the matching target config. */
export function resolveTarget() {
  const name = process.env.TARGET ?? DEFAULT_TARGET
  const config = TARGETS[name]
  if (!config) {
    const known = Object.keys(TARGETS).join(', ')
    throw new Error(`알 수 없는 TARGET "${name}" — 가능한 값: ${known}`)
  }
  return { name, ...config }
}
