// Reads public/manifest.json (the Chrome original) and writes a per-target
// manifest into the output directory.
//
// vite copies public/ wholesale, so for the chrome target this is effectively a
// pass-through. Only Safari changes, in four ways.
//
// 1. **Drop the MAIN world content script from the manifest.**
//    Safari supports world:'MAIN' in scripting.registerContentScripts, but
//    ignores the `world` field on static content_scripts depending on version.
//    When it does, main.js runs in ISOLATED — worse than not running at all,
//    because the hooks never reach the page while everything quietly appears to
//    have succeeded. So Safari declares nothing here and
//    background/mainWorld.ts registers it at runtime (with ISOLATED injecting
//    as a fallback if that fails).
// 2. The scripting permission, needed for that registration.
// 3. web_accessible_resources — the fallback path loads main.js via <script src>.
// 4. Remove Chrome-only keys, which Safari warns about.
//
// Called from vite's closeBundle hook (vite.config.ts). Order matters: this has
// to overwrite public/manifest.json *after* vite has copied it.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveTarget } from './targets.mjs'

const ROOT = dirname(import.meta.dirname)
const YOUTUBE_MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']

function toSafari(manifest) {
  const m = structuredClone(manifest)

  delete m.minimum_chrome_version
  // Safari does not recognise optional_host_permissions and only adds install warnings.
  delete m.optional_host_permissions

  m.content_scripts = (m.content_scripts ?? []).filter((cs) => cs.world !== 'MAIN')

  m.permissions = [...(m.permissions ?? [])]
  if (!m.permissions.includes('scripting')) m.permissions.push('scripting')

  m.web_accessible_resources = [{ resources: ['main.js'], matches: YOUTUBE_MATCHES }]

  return m
}

/** Write the target manifest into outDir. Returns the path written. */
export function writeManifest(target) {
  const base = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'))
  const out = target.name === 'safari' ? toSafari(base) : base
  const path = join(ROOT, target.outDir, 'manifest.json')
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`)
  return path
}

// Also runnable on its own, for regenerating just the manifest without vite.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\/scripts\//, 'scripts/'))) {
  const target = resolveTarget()
  writeManifest(target)
  console.log(`[manifest] ${target.name} → ${target.outDir}/manifest.json`)
}
