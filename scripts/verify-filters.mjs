// Does the generated list survive the extension's own validator?
//
//   node scripts/verify-filters.mjs
//
// The mirror is committed and fetched without a release, so a rule that the
// validator refuses does not fail loudly — it reaches everybody and then quietly
// is not there. This runs the same parse the service worker runs, and reports
// what would have been dropped.
//
// Selector parsing needs a document, which node has none of, so `canParse` is
// left out here exactly as it is in the worker. That half is re-checked in the
// page, in resolveRules.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseFilterList } from '../src/shared/filterlist.ts'

/** Every list the extension subscribes to by default. Both have to survive. */
const FILES = ['list.json', 'annoyances.json']

let failed = false

for (const name of FILES) {
  const file = path.resolve(import.meta.dirname, '..', 'filters', name)
  const text = readFileSync(file, 'utf8')
  const result = parseFilterList(text)

  if (!result.ok) {
    console.error(`${name} 거절됨: ${result.error}`)
    failed = true
    continue
  }

  const { list, dropped } = result
  const hidden = Object.values(list.rules.hide).reduce((n, v) => n + v.length, 0)
  // Host rules are grouped by toggle, so this is two levels deep now.
  const scoped = Object.values(list.rules.domains ?? {}).reduce(
    (n, hosts) => n + Object.values(hosts).reduce((m, v) => m + v.length, 0),
    0,
  )
  const kb = Math.round(text.length / 1024)
  console.log(
    `${name} 통과: 셀렉터 ${hidden + scoped}개 (도메인별 ${scoped}) · prune ${list.rules.prune.length} · ${kb}KB`,
  )

  if (dropped.length) {
    console.log(`  버려진 규칙 ${dropped.length}개:`)
    for (const line of dropped.slice(0, 10)) console.log(`    ${line}`)
    if (dropped.length > 10) console.log(`    … 그 외 ${dropped.length - 10}개`)
  }
}

if (failed) process.exit(1)
