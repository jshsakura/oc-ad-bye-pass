// Build target definitions. vite, esbuild and the manifest generator all read
// this file.
//
//   chrome  The product. One package for Chrome, Edge and Orion — on 2026-08-19
//           the full package installed on a real iPhone (Orion shows a one-time
//           compatibility warning for declarativeNetRequest and runs everything
//           else), which retired the shipped split.
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
