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

const file = path.resolve(import.meta.dirname, '..', 'filters', 'list.json')
const text = readFileSync(file, 'utf8')
const result = parseFilterList(text)

if (!result.ok) {
  console.error(`거절됨: ${result.error}`)
  process.exit(1)
}

const { list, dropped } = result
const hidden = Object.values(list.rules.hide).reduce((n, v) => n + v.length, 0)
const scoped = Object.values(list.rules.domains ?? {}).reduce((n, v) => n + v.length, 0)
console.log(`통과: 셀렉터 ${hidden + scoped}개 (도메인별 ${scoped}) · prune ${list.rules.prune.length}`)

if (dropped.length) {
  console.log(`버려진 규칙 ${dropped.length}개:`)
  for (const line of dropped.slice(0, 20)) console.log(`  ${line}`)
  if (dropped.length > 20) console.log(`  … 그 외 ${dropped.length - 20}개`)
}
