// Writes public/manifest.json into the output directory.
//
// vite copies public/ wholesale, so for the one target we ship this is a
// pass-through — it exists as a hook point, and because vite's copy has to be
// overwritten *after* it happens (see the closeBundle plugin in vite.config.ts).
//
// It used to rewrite the manifest for a Safari build: no world:'MAIN' on static
// content scripts, no declarativeNetRequest, main.js in web_accessible_resources.
// That target was dropped on 2026-08-11. The two runtime paths it required —
// registering the MAIN world script and injecting it as a fallback — stayed, and
// are now unconditional: WebKit browsers ignore the static `world` field
// depending on version, and Orion is a WebKit browser.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = dirname(import.meta.dirname)

/** Write the target manifest into outDir. Returns the path written. */
export function writeManifest(target) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'))
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
