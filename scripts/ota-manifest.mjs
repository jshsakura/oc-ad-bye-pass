// iOS OTA 설치용 manifest.plist 를 만든다.
//
// 사파리에서 `itms-services://?action=download-manifest&url=<이 파일의 https URL>`
// 을 열면 iOS 가 이걸 읽어 IPA 를 내려받아 설치한다.
//
// 까다로운 점 셋. 하나라도 틀리면 iOS 는 "앱을 설치할 수 없습니다" 한 줄만 보여준다.
//   1. 매니페스트와 IPA 둘 다 **HTTPS** 여야 한다 (그래서 adbyepass.opencourse.kr 이 있다)
//   2. 매니페스트의 Content-Type 이 XML 이어야 한다 (nginx.conf 에서 .plist → text/xml)
//   3. bundle-identifier 와 bundle-version 이 IPA 안의 Info.plist 와 정확히 같아야 한다
//
// 사용:
//   node scripts/ota-manifest.mjs --ipa-url https://…/app.ipa --bundle-id com.x.y \
//     --title "앱 이름" [--version 1.0] [--out ota/manifest.plist]

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

/** plist 문자열 값 이스케이프. URL 에 & 가 들어가는 일이 실제로 있다. */
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
