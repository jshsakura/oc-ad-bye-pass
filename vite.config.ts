import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveTarget } from './scripts/targets.mjs'
import { writeManifest } from './scripts/manifest.mjs'

const target = resolveTarget()

// vite 가 public/manifest.json 을 복사한 "뒤에" 타깃별 manifest 로 덮어쓴다.
// closeBundle 이라 watch 재빌드에서도 매번 다시 쓰인다 — dev 중에 Safari 매니페스트가
// Chrome 정본으로 되돌아가는 사고를 막는다.
const manifestPlugin = {
  name: 'oc-manifest',
  closeBundle() {
    writeManifest(target)
  },
}

// 팝업 / 옵션 페이지(React)만 담당한다.
// content script 와 service worker 는 scripts/build-content.mjs 가 esbuild 로
// 별도 IIFE 번들을 만든다 — 1계층 훅은 유튜브 스크립트보다 먼저 "동기적으로"
// 실행돼야 하므로 ESM 로더로 감싸면 안 된다.
export default defineConfig({
  plugins: [react(), manifestPlugin],
  define: {
    __TARGET__: JSON.stringify(target.name),
    __IS_SAFARI__: String(target.name === 'safari'),
  },
  build: {
    outDir: target.outDir,
    emptyOutDir: true,
    target: target.esbuildTarget,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
      },
    },
  },
})
