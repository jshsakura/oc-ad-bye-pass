// Guards against the target split failing quietly. Run after `npm run build:all`.
//
// **Neither failure caught here raises an error** — which is exactly why it
// needs a test.
//
// 1. If world:MAIN survives into the Safari manifest, Safari ignores the field
//    and runs main.js in ISOLATED. The hooks never reach the page, the
//    extension looks like it is working, and layer 1 alone dies in silence.
// 2. If Safari-only code survives into the Chrome bundle, the define inlining
//    broke. Harmless at runtime, but without knowing the cause the same mistake
//    comes back (see the comments in src/shared/target.ts).

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

// Not one fragment of Safari-only code may survive into the Chrome bundle.
for (const [file, needle] of [
  ['background.js', 'registerContentScripts'],
  ['isolated.js', 'main.js'],
]) {
  const source = readFileSync(join(ROOT, 'dist', file), 'utf8')
  check(
    `Chrome 번들 ${file} 에 "${needle}" 가 없다`,
    !source.includes(needle),
    '__IS_SAFARI__ 분기가 인라인되지 않았다 (src/shared/target.ts 주석 참조)',
  )
}

if (failures.length > 0) {
  console.error(`\n타깃 분기 검증 실패 ${failures.length}건`)
  process.exit(1)
}
console.log('\n타깃 분기 검증 통과')
