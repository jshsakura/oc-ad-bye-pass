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
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  // Content scripts cannot read extension-only APIs, so they cannot tell which
  // package they are in at runtime. Bake it in: the PiP button is an Orion-only
  // feature and must never inject on the desktop build.
  define: { __IS_ORION__: JSON.stringify(target.name === 'orion') },
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log(`[build-content] watching… (${target.name} → ${target.outDir})`)
} else {
  await esbuild.build(options)
}
