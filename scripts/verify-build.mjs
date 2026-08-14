// Guards the invariants of the shipped build. Run after `npm run build`.
//
// **None of these failures raises an error at runtime** — which is exactly why
// they need a test. Each one leaves an extension that looks like it works.
//
// The MAIN world script has two ways in, deliberately:
//
//   static declaration   Chrome honours `world` on content_scripts, and it is
//                        the fast path — in place before the parser reaches
//                        YouTube's first inline script. Measured: relying on
//                        runtime registration alone loses that race.
//   runtime registration WebKit browsers, Orion included, ignore the static
//                        field depending on version. Registering covers them,
//                        and where it is unsupported it throws rather than
//                        failing quietly.
//
// Both firing is fine; the guard in main/index.ts installs the hooks once. What
// is not fine is neither firing.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const failures = []

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label} — ${detail}`)
    failures.push(label)
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'dist', 'manifest.json'), 'utf8'))
const orion = existsSync(join(ROOT, 'dist-orion', 'manifest.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'dist-orion', 'manifest.json'), 'utf8'))
  : null

// The Chrome Web Store caps the manifest description at 132 characters, per
// locale, and rejects the upload rather than truncating. The description is
// localized, so check every messages.json — the store counts each one.
for (const loc of ['en', 'ko']) {
  const file = join(ROOT, 'dist', '_locales', loc, 'messages.json')
  if (!existsSync(file)) continue
  const len = (JSON.parse(readFileSync(file, 'utf8')).extDescription?.message ?? '').length
  check(
    `_locales/${loc} description ≤ 132자 (스토어 상한)`,
    len > 0 && len <= 132,
    `현재 ${len}자 — 132자를 넘으면 스토어가 업로드를 거부한다`,
  )
}

// The fast path. Losing this costs the first pre-roll on every YouTube page,
// and nothing reports it.
check(
  '매니페스트에 world:MAIN 콘텐츠 스크립트가 있다',
  (manifest.content_scripts ?? []).some((cs) => cs.world === 'MAIN'),
  '정적 선언이 사라지면 1계층이 유튜브 인라인 스크립트에 밀린다',
)

// The covering path, for browsers that ignore the static field. It has to be in
// the shipped bundle, not merely in the source.
for (const [file, needle] of [
  ['background.js', 'registerContentScripts'],
  ['isolated.js', 'main.js'],
]) {
  const source = readFileSync(join(ROOT, 'dist', file), 'utf8')
  check(
    `번들 ${file} 에 "${needle}" 가 살아 있다`,
    source.includes(needle),
    'Orion 처럼 정적 world 를 무시하는 브라우저에서 1계층이 조용히 죽는다',
  )
}

// The injection fallback loads main.js as a page script, which only works if the
// manifest exposes it. Dropping this key breaks the fallback and nothing else —
// so it fails exactly where there is no other line of defence left.
check(
  'main.js 가 web_accessible_resources 에 있다',
  (manifest.web_accessible_resources ?? []).some((r) => r.resources?.includes('main.js')),
  '등록이 실패한 브라우저에서 주입 폴백까지 죽는다',
)

check(
  'scripting 권한이 있다',
  (manifest.permissions ?? []).includes('scripting'),
  'registerContentScripts 를 못 부른다',
)

// The icons were hand-encoded PNGs until 2026-08-11, when Orion turned out to
// refuse every package built with them and accept the same package carrying the
// previous ones. Nothing measurable was wrong with the files. They are rendered
// by a browser now, and this is the tripwire for anyone tempted to write an
// encoder again.
for (const size of [16, 48, 128]) {
  const png = readFileSync(join(ROOT, 'dist', 'icons', `icon${size}.png`))
  const chunks = []
  for (let i = 8; i < png.length; ) {
    const length = png.readUInt32BE(i)
    chunks.push(png.toString('ascii', i + 4, i + 8))
    i += 12 + length
  }
  check(
    `icon${size}.png 이 브라우저가 구운 PNG 다`,
    png.readUInt32BE(16) === size && chunks.filter((c) => c === 'IDAT').length >= 1,
    'scripts/make-icons.mjs 가 손으로 인코딩하고 있다면 되돌려라 — Orion 이 거절한다',
  )
}

check(
  '매니페스트에 declarative_net_request 가 있다',
  !!manifest.declarative_net_request,
  '네트워크 차단이 통째로 빠졌다',
)

// The Orion package. Orion refused the Chrome one with no reason given, and the
// three keys below are what it is not known to accept — the whole point of that
// build is that they are absent. Shipping it with any of them back is shipping
// the thing that failed.
if (orion) {
  check(
    'Orion 패키지에 declarativeNetRequest 가 없다',
    !orion.declarative_net_request && !(orion.permissions ?? []).includes('declarativeNetRequest'),
    'Orion 은 이 API 를 구현하지 않았다 (scripts/targets.mjs 의 strip)',
  )
  check(
    'Orion 패키지에 크롬 전용 키가 없다',
    !orion.minimum_chrome_version && !orion.optional_host_permissions,
    'WebKit 이 모르는 키다',
  )
  check(
    'Orion 패키지에 3.6MB 룰셋이 따라오지 않았다',
    !existsSync(join(ROOT, 'dist-orion', 'rules')),
    '키가 없으면 아무도 안 읽는다 — 순수한 무게일 뿐이다',
  )
  check(
    'Orion 패키지도 1계층 경로를 갖췄다',
    (orion.content_scripts ?? []).some((cs) => cs.world === 'MAIN') &&
      (orion.permissions ?? []).includes('scripting') &&
      (orion.web_accessible_resources ?? []).some((r) => r.resources?.includes('main.js')),
    '유튜브 차단은 이 타깃에서도 그대로여야 한다',
  )
} else {
  console.log('  · dist-orion 없음 — Orion 검사 건너뜀 (npm run build:all)')
}

// Not checked here: the `_metadata/` cache Chromium writes into dist/ when the
// E2E suite loads the extension. This script runs on a fresh build, before that
// happens; the guard against zipping it belongs at packaging time and lives in
// .github/workflows/release.yml.

if (failures.length > 0) {
  console.error(`\n빌드 검증 실패 ${failures.length}건`)
  process.exit(1)
}
console.log('\n빌드 검증 통과')
