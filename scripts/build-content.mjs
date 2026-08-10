// content script(MAIN/ISOLATED) 와 service worker 를 esbuild 로 번들한다.
//
// 왜 vite 가 아니라 esbuild 인가:
//   - MAIN world 훅은 유튜브 스크립트보다 먼저 "동기적으로" 실행돼야 한다.
//     ESM/로더로 감싸면 실행이 한 틱 밀려서 ytInitialPlayerResponse 를 놓친다.
//   - rollup 의 iife 포맷은 빌드당 엔트리 1개만 허용한다. esbuild 는 여러 엔트리를
//     각각 독립 IIFE 로 뽑아준다.
// esbuild 는 vite 의 의존성이라 추가 설치가 없다.

import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    main: 'src/main/index.ts',
    isolated: 'src/isolated/index.ts',
    background: 'src/background/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build-content] watching…')
} else {
  await esbuild.build(options)
}
