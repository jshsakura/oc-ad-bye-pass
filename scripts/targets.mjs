// Build target definitions. vite, esbuild and the manifest generator all read
// this file.
//
// **There is one target.** Chrome, Edge and Orion all install the same package —
// Orion takes a Chrome extension zip directly, on iOS as well, which is what
// removed the reason for a second build. A Safari target existed until
// 2026-08-11 and was dropped whole; see the git history if it needs to come
// back.
//
// The indirection is kept because it costs nothing and it is where a second
// target would go: add an entry here and pass TARGET=<name>.

export const TARGETS = {
  chrome: {
    outDir: 'dist',
    // esbuild downlevel target, kept in step with minimum_chrome_version in the manifest.
    esbuildTarget: 'chrome120',
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
