// public/manifest.json(Chrome 정본)을 읽어 타깃별 manifest 를 출력 디렉터리에 쓴다.
//
// vite 가 public/ 을 통째로 복사하므로 chrome 타깃에서는 사실상 통과다.
// Safari 에서만 아래 넷을 바꾼다.
//
// 1. MAIN world 콘텐츠 스크립트를 **매니페스트에서 뺀다.**
//    Safari 는 scripting.registerContentScripts 의 world:'MAIN' 은 지원하지만
//    정적 content_scripts 의 world 필드는 버전에 따라 무시한다. 무시되면 main.js 가
//    ISOLATED 로 실행되는데, 이건 "안 도는 것"보다 나쁘다 — 훅이 페이지에 안 걸린
//    채로 조용히 성공한 척한다. 그래서 Safari 에서는 아예 선언하지 않고
//    background/mainWorld.ts 가 런타임에 등록한다 (실패하면 ISOLATED 가 폴백 주입).
// 2. scripting 권한 — 위 등록에 필요하다.
// 3. web_accessible_resources — 폴백 주입 경로가 main.js 를 <script src> 로 부른다.
// 4. Chrome 전용 키 제거 — Safari 가 경고를 뱉는다.
//
// vite 의 closeBundle 훅에서 불린다(vite.config.ts). vite 가 public/manifest.json 을
// 복사한 "뒤"에 덮어써야 하므로 순서가 중요하다.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveTarget } from './targets.mjs'

const ROOT = dirname(import.meta.dirname)
const YOUTUBE_MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']

function toSafari(manifest) {
  const m = structuredClone(manifest)

  delete m.minimum_chrome_version
  // Safari 는 optional_host_permissions 를 인식하지 못하고 설치 경고만 늘린다.
  delete m.optional_host_permissions

  m.content_scripts = (m.content_scripts ?? []).filter((cs) => cs.world !== 'MAIN')

  m.permissions = [...(m.permissions ?? [])]
  if (!m.permissions.includes('scripting')) m.permissions.push('scripting')

  m.web_accessible_resources = [{ resources: ['main.js'], matches: YOUTUBE_MATCHES }]

  return m
}

/** 타깃 manifest 를 outDir 에 쓴다. 쓴 경로를 돌려준다. */
export function writeManifest(target) {
  const base = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'))
  const out = target.name === 'safari' ? toSafari(base) : base
  const path = join(ROOT, target.outDir, 'manifest.json')
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`)
  return path
}

// 단독 실행도 지원한다 — vite 없이 매니페스트만 다시 뽑고 싶을 때.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\/scripts\//, 'scripts/'))) {
  const target = resolveTarget()
  writeManifest(target)
  console.log(`[manifest] ${target.name} → ${target.outDir}/manifest.json`)
}
