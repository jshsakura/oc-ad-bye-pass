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

import { readFileSync } from 'node:fs'
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

check(
  '매니페스트에 declarative_net_request 가 있다',
  !!manifest.declarative_net_request,
  '네트워크 차단이 통째로 빠졌다',
)

// Not checked here: the `_metadata/` cache Chromium writes into dist/ when the
// E2E suite loads the extension. This script runs on a fresh build, before that
// happens; the guard against zipping it belongs at packaging time and lives in
// .github/workflows/release.yml.

if (failures.length > 0) {
  console.error(`\n빌드 검증 실패 ${failures.length}건`)
  process.exit(1)
}
console.log('\n빌드 검증 통과')
