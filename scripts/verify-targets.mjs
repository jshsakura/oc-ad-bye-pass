// 타깃 분기가 조용히 무너지는 것을 막는다. `npm run build:all` 뒤에 돌린다.
//
// 여기서 잡는 두 실패는 **둘 다 오류를 내지 않는다** — 그래서 테스트가 필요하다.
//
// 1. Safari 매니페스트에 world:MAIN 이 남으면, Safari 는 그 필드를 무시하고
//    main.js 를 ISOLATED 로 실행한다. 훅이 페이지에 안 걸린 채 확장은 멀쩡히
//    동작하는 것처럼 보이고, 1계층만 조용히 죽는다.
// 2. Chrome 번들에 Safari 전용 코드가 남으면 define 인라인이 깨진 것이다.
//    동작에는 문제가 없지만 원인을 모르면 다음에 또 같은 실수를 한다
//    (src/shared/target.ts 주석 참조).

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

// Chrome 번들에는 Safari 전용 코드가 한 조각도 남으면 안 된다.
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
