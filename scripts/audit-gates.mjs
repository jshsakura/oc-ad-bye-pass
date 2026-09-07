// Do the guards still guard?
//
//   node scripts/audit-gates.mjs            # every case
//   node scripts/audit-gates.mjs --list     # names only, runs nothing
//   node scripts/audit-gates.mjs -g 'PiP'   # only cases whose name matches
//
// A passing test suite says nothing about whether it would fail. v0.25.0
// shipped a check written as `!labels.some(l => /PiP/i.test(l))` against a
// popup rendering "Picture-in-picture button" — it passed whether the row was
// there or not, and a code review caught it rather than the suite. This is the
// thing that would have caught it: each guard is handed the defect it exists
// for and has to go red.
//
// **It edits tracked files.** Every case is restored with `git checkout --`
// through a finally, and the run fails if the tree does not come back clean,
// but do not run it over uncommitted work. It refuses to start on a dirty tree
// for that reason.
//
// When a case reports "앵커 불일치", the code moved and the mutation no longer
// describes a real defect. Re-point it at the current code — that is the
// maintenance this file asks for in exchange for proving the suite bites.

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.dirname(import.meta.dirname)
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', ...opts })

/** Run a gate. Returns { code, out } — a non-zero exit is the expected outcome here, not an error. */
function gate(cmd) {
  try {
    return { code: 0, out: sh(cmd, { timeout: 600_000 }) }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** Replace an anchor that must appear exactly once, so a moved anchor fails loudly. */
function patch(file, from, to) {
  const p = path.join(ROOT, file)
  const s = readFileSync(p, 'utf8')
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error(`앵커 불일치 (${n}회): ${file} :: ${from.slice(0, 60)}`)
  writeFileSync(p, s.replace(from, to))
}

const PIP_DECISION = '  if (webkit) return true\n  if (gecko) return false\n  return phone'

/**
 * `expect` is a string the gate's own output must contain. Without it a case
 * passes on any failure, including one from an unrelated break — which is how
 * a guard gets credit for a red light it did not cause.
 */
const CASES = [
  {
    name: '단위 — needsPipButton 이 Gecko 폰에 버튼을 그리면',
    gate: 'npm test',
    files: ['src/ui/device.ts'],
    expect: 'Gecko 는 폰이어도',
    mutate: () => patch('src/ui/device.ts', PIP_DECISION, '  return webkit || phone'),
  },
  {
    name: '단위 — 로케일에서 키 하나가 빠지면',
    gate: 'npm test',
    files: ['src/shared/locales/ko.ts'],
    expect: '빠진 키',
    mutate: () => {
      const p = path.join(ROOT, 'src/shared/locales/ko.ts')
      const s = readFileSync(p, 'utf8')
      const line = s.split('\n').find((l) => l.startsWith("  'opt.sponsor.cat.intro'"))
      if (!line) throw new Error('앵커 불일치: ko.ts 에 opt.sponsor.cat.intro 없음')
      writeFileSync(p, s.replace(`${line}\n`, ''))
    },
  },
  {
    name: '단위 — 번들 필터에 깨진 셀렉터가 들어가면',
    gate: 'npm test',
    files: ['filters/video.json'],
    mutate: () => {
      const p = path.join(ROOT, 'filters/video.json')
      const d = JSON.parse(readFileSync(p, 'utf8'))
      d.rules.hide.generalAds.push('div:has(>')
      writeFileSync(p, JSON.stringify(d, null, 2))
    },
  },
  {
    name: 'verify — Firefox 패키지가 서비스워커로 돌아가면',
    // build:all, not build:firefox: verify reads dist/manifest.json before it
    // reaches the Firefox checks, so on a clean tree the narrower build made
    // these two cases go red on a missing file instead of on the defect.
    gate: 'npm run build:all && npm run verify',
    files: ['scripts/targets.mjs'],
    expect: '이벤트 페이지로 돈다',
    mutate: () =>
      patch(
        'scripts/targets.mjs',
        "      background: { scripts: ['background.js'] },",
        "      background: { service_worker: 'background.js' },",
      ),
  },
  {
    name: 'verify — 데이터 수집 선언이 빠지면',
    // build:all, not build:firefox: verify reads dist/manifest.json before it
    // reaches the Firefox checks, so on a clean tree the narrower build made
    // these two cases go red on a missing file instead of on the defect.
    gate: 'npm run build:all && npm run verify',
    files: ['scripts/targets.mjs'],
    expect: '데이터 수집을 선언한다',
    mutate: () =>
      patch('scripts/targets.mjs', "          data_collection_permissions: { required: ['none'] },", ''),
  },
  {
    name: 'AMO 린터 — 매니페스트 버전이 형식에 안 맞으면',
    gate: 'npm run build:firefox && npx --yes addons-linter@10 dist-firefox',
    files: ['public/manifest.json'],
    mutate: () => {
      const p = path.join(ROOT, 'public/manifest.json')
      const d = JSON.parse(readFileSync(p, 'utf8'))
      d.version = 'not-a-version'
      writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`)
    },
  },
  {
    name: 'Firefox 실측 — 데스크톱 Gecko 에 PiP 스위치가 그려지면',
    gate: 'npm run build:firefox && node scripts/smoke-firefox.mjs --no-live',
    files: ['src/ui/device.ts'],
    expect: 'PiP 스위치가 없다',
    mutate: () => patch('src/ui/device.ts', PIP_DECISION, '  return true'),
  },
  {
    name: 'Firefox 실측 — DNR 룰셋이 빠지면',
    gate: 'npm run build:firefox && node scripts/smoke-firefox.mjs --no-live',
    files: ['scripts/targets.mjs'],
    expect: 'ads',
    mutate: () =>
      patch(
        'scripts/targets.mjs',
        "      keys: ['minimum_chrome_version'],",
        "      keys: ['minimum_chrome_version', 'declarative_net_request'],",
      ),
  },
  {
    name: 'e2e — 접힌 줄이 개수를 말하지 않으면',
    gate: 'npm run build && npx playwright test e2e/04-scope-and-settings.spec.ts -g "접힌 줄"',
    files: ['src/popup/App.tsx'],
    expect: '접힌 줄',
    mutate: () =>
      patch('src/popup/App.tsx', '<span className="sponsor-count">', '<span className="sponsor-count-x">'),
  },
  {
    name: 'e2e — 이지 모드가 켜져도 PiP 버튼을 붙이면',
    gate: 'npm run build && npx playwright test e2e/11-picture-in-picture.spec.ts -g "이지 모드"',
    files: ['src/isolated/pip.ts'],
    expect: '이지 모드',
    mutate: () =>
      patch('src/isolated/pip.ts', '    doc.getElementById(EASY_MODE_STYLE_ID) !== null ||', '    false ||'),
  },
]

const args = process.argv.slice(2)
const only = args.includes('-g') ? args[args.indexOf('-g') + 1] : null
const cases = only ? CASES.filter((c) => c.name.includes(only)) : CASES

if (args.includes('--list')) {
  for (const c of cases) console.log(`  ${c.name}`)
  process.exit(0)
}

const dirtyAtStart = sh('git status --porcelain').trim()
if (dirtyAtStart) {
  console.error('작업 트리가 깨끗하지 않다 — 이 감사는 추적 파일을 고쳤다 되돌린다:\n' + dirtyAtStart)
  process.exit(2)
}

const results = []
for (const c of cases) {
  process.stdout.write(`▶ ${c.name} … `)
  let verdict = 'ERROR'
  let detail = ''
  try {
    c.mutate()
    const r = gate(c.gate)
    if (r.code === 0) {
      verdict = '통과해버림'
      detail = '게이트가 결함을 못 잡았다'
    } else if (c.expect && !r.out.includes(c.expect)) {
      verdict = '빨강(다른 이유)'
      detail = `기대한 문구 "${c.expect}" 가 출력에 없다`
    } else {
      verdict = '빨강'
    }
  } catch (e) {
    detail = e.message
  } finally {
    execFileSync('git', ['checkout', '--', ...c.files], { cwd: ROOT })
  }
  console.log(verdict + (detail ? ` — ${detail}` : ''))
  results.push({ name: c.name, verdict, detail })
}

const dirty = sh('git status --porcelain').trim()
console.log(`\n작업 트리: ${dirty ? `⚠ 되돌리지 못한 변경\n${dirty}` : '깨끗'}`)

const bad = results.filter((r) => r.verdict !== '빨강')
console.log(`\n${results.length}건 중 정상 감지 ${results.length - bad.length}건`)
for (const b of bad) console.log(`  ✗ ${b.name} → ${b.verdict}${b.detail ? ` ${b.detail}` : ''}`)
process.exit(bad.length || dirty ? 1 : 0)
