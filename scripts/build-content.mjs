// content script(MAIN/ISOLATED) 와 service worker 를 esbuild 로 번들한다.
//
// 왜 vite 가 아니라 esbuild 인가:
//   - MAIN world 훅은 유튜브 스크립트보다 먼저 "동기적으로" 실행돼야 한다.
//     ESM/로더로 감싸면 실행이 한 틱 밀려서 ytInitialPlayerResponse 를 놓친다.
//   - rollup 의 iife 포맷은 빌드당 엔트리 1개만 허용한다. esbuild 는 여러 엔트리를
//     각각 독립 IIFE 로 뽑아준다.
// esbuild 는 vite 의 의존성이라 추가 설치가 없다.

import * as esbuild from 'esbuild'
import { resolveTarget } from './targets.mjs'

const watch = process.argv.includes('--watch')
const target = resolveTarget()

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    main: 'src/main/index.ts',
    isolated: 'src/isolated/index.ts',
    background: 'src/background/index.ts',
  },
  outdir: target.outDir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: target.esbuildTarget,
  // 브라우저별로 갈리는 코드는 src/shared/target.ts 한 곳에서만 읽는다.
  // 불리언까지 여기서 계산해 넘기는 이유는 target.ts 주석 참조 — 리터럴이어야
  // esbuild 가 모듈을 넘어 인라인하고 죽은 분기를 지운다.
  define: {
    __TARGET__: JSON.stringify(target.name),
    __IS_SAFARI__: String(target.name === 'safari'),
  },
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log(`[build-content] watching… (${target.name} → ${target.outDir})`)
} else {
  await esbuild.build(options)
}
