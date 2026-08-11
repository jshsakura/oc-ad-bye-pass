// Builds the manifest.plist used for iOS OTA installation.
//
// Opening `itms-services://?action=download-manifest&url=<https URL of this
// file>` in Safari makes iOS read it, download the IPA and install it.
//
// Three things are fussy. Get any one wrong and iOS shows a single line,
// "Unable to install".
//   1. Both the manifest and the IPA must be served over **HTTPS** (which is
//      what adbyepass.opencourse.kr is for)
//   2. The manifest must be served as XML (nginx.conf maps .plist -> text/xml)
//   3. bundle-identifier and bundle-version must match the IPA's Info.plist exactly
//
// Usage:
//   node scripts/ota-manifest.mjs --ipa-url https://…/app.ipa --bundle-id com.x.y \
//     --title "App name" [--version 1.0] [--out ota/manifest.plist]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key?.startsWith('--')) throw new Error(`인자 형식이 이상하다: ${key}`)
    out[key.slice(2)] = argv[i + 1]
  }
  return out
}

/** Escape a plist string value. URLs really do contain '&'. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildManifest({ ipaUrl, bundleId, title, version = '1.0' }) {
  if (!ipaUrl?.startsWith('https://')) {
    throw new Error(`IPA URL 은 https 여야 한다: ${ipaUrl}`)
  }
  for (const [name, value] of Object.entries({ bundleId, title })) {
    if (!value) throw new Error(`${name} 이(가) 비었다`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${esc(ipaUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${esc(bundleId)}</string>
        <key>bundle-version</key><string>${esc(version)}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${esc(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`
}

const isMain = process.argv[1]?.endsWith('ota-manifest.mjs')
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const xml = buildManifest({
    ipaUrl: args['ipa-url'],
    bundleId: args['bundle-id'],
    title: args.title,
    version: args.version ?? '1.0',
  })
  const out = args.out ?? 'ota/manifest.plist'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, xml)
  console.log(`[ota-manifest] → ${out}`)
}
