// AltStore / SideStore 소스 JSON 을 만든다.
//
// **이게 "아이폰에서 웹으로 설치"의 진짜 답이다.**
//
// AltStore 는 소스 URL 을 등록하면 그 안의 앱 목록을 보여주고, 받아서 **사용자의
// 무료 Apple ID 로 직접 재서명해** 설치한다. 우리가 서명할 필요도, $99 를 낼 필요도
// 없다. 대가는 7일마다 갱신인데 SideStore 는 최초 1회 PC 설정 뒤 무선으로 알아서 한다.
//
// itms-services(OTA) 와의 차이:
//   OTA          유료 계정 + UDID 등록 필요. 대신 사파리에서 바로 설치, 1년 유효
//   AltStore     무료 Apple ID 로 충분. 대신 AltStore 앱을 거치고 7일마다 갱신
//
// 스키마는 AltStore 2.x 의 versions 배열을 쓰되, 구버전이 읽는 최상위 필드도 같이
// 넣는다 (둘 다 있으면 각자 아는 것을 읽는다).

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
        // 구버전 AltStore 가 읽는 자리
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
