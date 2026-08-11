// Bundles the content scripts (MAIN/ISOLATED) and the service worker with esbuild.
//
// Why esbuild rather than vite:
//   - The MAIN world hooks must run **synchronously**, ahead of YouTube's own
//     scripts. Wrapping them in an ESM loader delays execution by a tick, which
//     is enough to miss ytInitialPlayerResponse.
//   - rollup's iife format allows one entry per build. esbuild emits several
//     entries, each as its own self-contained IIFE.
// esbuild is already a vite dependency, so this adds nothing to install.

import * as esbuild from 'esbuild'
import { resolveTarget } from './targets.mjs'

const watch = process.argv.includes('--watch')
const target = resolveTarget()

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    main: 'src/main/index.ts',
    isolated: 'src/isolated/index.ts',
    background: 'src/background/index.ts',
  },
  outdir: target.outDir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: target.esbuildTarget,
  // Everything browser-specific is read from one place, src/shared/target.ts.
  // The boolean is computed here and passed in for the reason described in that
  // file: it has to be a literal for esbuild to inline it across modules and
  // drop the dead branch.
  define: {
    __TARGET__: JSON.stringify(target.name),
    __IS_SAFARI__: String(target.name === 'safari'),
  },
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log(`[build-content] watching… (${target.name} → ${target.outDir})`)
} else {
  await esbuild.build(options)
}
