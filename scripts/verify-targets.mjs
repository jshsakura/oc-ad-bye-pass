// Guards against the target split failing quietly. Run after `npm run build:all`.
//
// **None of these failures raises an error at runtime** — which is exactly why
// they need a test. Each one leaves an extension that looks like it works.
//
// The MAIN world script now has two ways in, deliberately:
//
//   static declaration   Chrome honours `world` on content_scripts, and it is
//                        the fast path — in place before the parser reaches
//                        YouTube's first inline script. Measured: relying on
//                        runtime registration alone loses that race.
//   runtime registration WebKit browsers, Orion included, ignore the static
//                        field depending on version. Registering covers them.
//
// Both firing is fine; the guard in main/index.ts installs the hooks once. What
// is not fine is neither firing, or the network layer shipping to a browser
// that cannot use it.

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

const safariManifest = JSON.parse(readFileSync(join(ROOT, 'dist-safari', 'manifest.json'), 'utf8'))
const mainWorldEntries = (safariManifest.content_scripts ?? []).filter((cs) => cs.world === 'MAIN')

check(
  'Safari 매니페스트에 world:MAIN 콘텐츠 스크립트가 없다',
  mainWorldEntries.length === 0,
  `${mainWorldEntries.length}개 남아 있다 (scripts/manifest.mjs 의 toSafari 확인)`,
)

check(
  'Safari 매니페스트가 main.js 를 web_accessible_resources 로 노출한다',
  (safariManifest.web_accessible_resources ?? []).some((r) => r.resources?.includes('main.js')),
  '폴백 주입이 main.js 를 못 부른다',
)

check(
  'Safari 매니페스트에 scripting 권한이 있다',
  (safariManifest.permissions ?? []).includes('scripting'),
  'registerContentScripts 를 못 부른다',
)

const chromeManifest = JSON.parse(readFileSync(join(ROOT, 'dist', 'manifest.json'), 'utf8'))

// The fast path. Losing this costs the first pre-roll on every YouTube page,
// and nothing reports it.
check(
  'Chrome 매니페스트에 world:MAIN 콘텐츠 스크립트가 있다',
  (chromeManifest.content_scripts ?? []).some((cs) => cs.world === 'MAIN'),
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
    `Chrome 번들 ${file} 에 "${needle}" 가 살아 있다`,
    source.includes(needle),
    'Orion 처럼 정적 world 를 무시하는 브라우저에서 1계층이 조용히 죽는다',
  )
}

// declarativeNetRequest does not exist on Safari or Orion. Shipping the key
// earns warnings, and the 3.6MB ruleset would ride along unread.
check(
  'Chrome 매니페스트에 declarative_net_request 가 있다',
  !!chromeManifest.declarative_net_request,
  '네트워크 차단이 통째로 빠졌다',
)

check(
  'Safari 매니페스트에는 declarative_net_request 가 없다',
  !safariManifest.declarative_net_request &&
    !(safariManifest.permissions ?? []).includes('declarativeNetRequest'),
  'Safari/Orion 은 지원하지 않는다 (scripts/manifest.mjs 의 toSafari 확인)',
)

if (failures.length > 0) {
  console.error(`\n타깃 분기 검증 실패 ${failures.length}건`)
  process.exit(1)
}
console.log('\n타깃 분기 검증 통과')
