// Writes public/manifest.json into the output directory.
//
// vite copies public/ wholesale, so for the one target we ship this is a
// pass-through — it exists as a hook point, and because vite's copy has to be
// overwritten *after* it happens (see the closeBundle plugin in vite.config.ts).
//
// Targets may also `patch` keys in — that is what turns the Chrome service
// worker into a Gecko event page for the firefox target.
//
// For the orion target it strips what WebKit cannot use — the list is in
// scripts/targets.mjs, with a reason against each entry. The static
// world:'MAIN' declaration deliberately stays: WebKit ignores the field rather
// than rejecting it, and the runtime registration in background/mainWorld.ts
// covers the case where it is ignored. Both paths run in both builds.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = dirname(import.meta.dirname)

/** Write the target manifest into outDir. Returns the path written. */
export function writeManifest(target) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'))

  const strip = target.strip
  if (strip) {
    for (const key of strip.keys ?? []) delete manifest[key]
    if (strip.permissions?.length) {
      manifest.permissions = (manifest.permissions ?? []).filter((p) => !strip.permissions.includes(p))
    }
    // vite copies public/ wholesale, so anything dropped from the manifest has
    // to be dropped from the output directory too or it ships regardless.
    for (const dir of strip.dirs ?? []) {
      rmSync(join(ROOT, target.outDir, dir), { recursive: true, force: true })
    }
  }

  // Added after the stripping, and shallow — see the note on `patch` in
  // scripts/targets.mjs for why replacing a whole key is the point.
  Object.assign(manifest, target.patch ?? {})

  const path = join(ROOT, target.outDir, 'manifest.json')
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return path
}

// Also runnable on its own, for regenerating just the manifest without vite.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\/scripts\//, 'scripts/'))) {
  const { resolveTarget } = await import('./targets.mjs')
  const target = resolveTarget()
  writeManifest(target)
  console.log(`[manifest] ${target.name} → ${target.outDir}/manifest.json`)
}
