// Build target. The only place where browsers diverge.
//
// The value is substituted as a literal at build time (the `define` in
// scripts/build-content.mjs), so `if (!__IS_SAFARI__) return` compiles down to
// a bare `return` in the Chrome build and everything after it becomes
// unreachable and drops out of the bundle.
//
// **Branch on the `__IS_SAFARI__` global directly, not on a constant exported
// from this file.** An earlier `export const IS_SAFARI = __IS_SAFARI__` that
// other modules imported defeated the inlining: esbuild would not fold it
// across the module boundary, and Safari-only code (registerContentScripts,
// main.js injection) stayed in the Chrome bundle. Dead code, harmless at
// runtime, but there is no reason to ship it.
//
// All this file does is tell tsc about that global. It is an ambient
// declaration, so it applies across src/ without being imported.
//
// Why not sniff the browser at runtime: even within WebKit, Chrome on iOS
// cannot run extensions at all — and more to the point, "which store is this
// build for" is our decision, not something a user agent can answer.

export type BuildTarget = 'chrome' | 'safari'

declare global {
  /** 'chrome' | 'safari' — replaced with a string literal at build time. */
  const __TARGET__: BuildTarget
  /** __TARGET__ === 'safari', precomputed by the build script. */
  const __IS_SAFARI__: boolean
}
