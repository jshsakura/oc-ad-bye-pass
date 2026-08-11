// Builds the AltStore / SideStore source JSON.
//
// **This is the real answer to "install on iPhone from the web".**
//
// Register a source URL with AltStore and it lists the apps inside, downloads
// one, and **re-signs it with the user's own free Apple ID** to install. No
// signing on our side, no $99. The price is a renewal every 7 days, which
// SideStore handles wirelessly after a one-time setup from a PC.
//
// Versus itms-services (OTA):
//   OTA        needs a paid account and UDID registration; installs straight
//              from Safari and lasts a year
//   AltStore   a free Apple ID is enough; goes through the AltStore app and
//              renews every 7 days
//
// The schema uses AltStore 2.x's versions array, but also carries the top-level
// fields older releases read — with both present, each reads what it knows.

import { mkdirSync, statSync, writeFileSync } from 'node:fs'
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

export function buildSource({ baseUrl, ipaPath, ipaUrl, version, date, bundleId }) {
  const size = statSync(ipaPath).size
  const entry = {
    version,
    date,
    localizedDescription: '유튜브 광고 차단 Safari 확장',
    downloadURL: ipaUrl,
    size,
    minOSVersion: '16.4',
  }

  return {
    name: 'OC Ad Bye-Pass',
    identifier: 'kr.opencourse.adbyepass',
    sourceURL: `${baseUrl}/altstore.json`,
    apps: [
      {
        name: 'OC Ad Bye-Pass',
        bundleIdentifier: bundleId,
        developerName: 'jshsakura',
        subtitle: '유튜브 전용 광고 차단',
        localizedDescription: [
          '유튜브 전용 광고 차단 Safari 확장.',
          '',
          '설치 후 설정 → 앱 → Safari → 확장 프로그램에서 켜고,',
          'youtube.com 권한을 "항상 허용"으로 두면 동작한다.',
          '',
          '유튜브 계열 호스트 밖에서는 스크립트가 한 줄도 실행되지 않는다.',
        ].join('\n'),
        iconURL: `${baseUrl}/icon.png`,
        tintColor: 'a6e3a1',
        screenshotURLs: [],
        // AltStore 2.x
        versions: [entry],
        // Where older AltStore versions look
        version,
        versionDate: date,
        versionDescription: '유튜브 광고 차단 Safari 확장',
        downloadURL: ipaUrl,
        size,
      },
    ],
    news: [],
  }
}

const isMain = process.argv[1]?.endsWith('altstore-source.mjs')
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args['base-url'] ?? 'https://adbyepass.opencourse.kr'
  const json = buildSource({
    baseUrl,
    ipaPath: args.ipa,
    ipaUrl: args['ipa-url'] ?? `${baseUrl}/ota/oc-ad-bye-pass-unsigned.ipa`,
    version: args.version ?? '0.1.0',
    date: args.date ?? new Date().toISOString().slice(0, 10),
    bundleId: args['bundle-id'] ?? 'com.jshsakura.ocadbyepass',
  })
  const out = args.out ?? 'altstore.json'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`[altstore-source] → ${out} (${json.apps[0].size} bytes IPA)`)
}
