// Build target definitions. vite, esbuild and the manifest generator all read
// this file.
//
// One source tree. Only three things differ per browser, and all three live here:
//   1. output directory     — dist / dist-safari
//   2. downlevel target     — Safari got :has() and MV3 service workers in 16.4
//   3. MAIN world injection — see the comments in manifest.mjs
//
// Adding a new target (firefox, say) should stay a one-line change here.

export const TARGETS = {
  chrome: {
    outDir: 'dist',
    // esbuild downlevel target, kept in step with minimum_chrome_version in the manifest.
    esbuildTarget: 'chrome120',
  },
  safari: {
    outDir: 'dist-safari',
    // Safari 16.4 is the release that brought MV3 service workers and
    // world:'MAIN' in scripting.registerContentScripts together, so that is the
    // floor — iOS 16.4 and up.
    esbuildTarget: 'safari16.4',
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
