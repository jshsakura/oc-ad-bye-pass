import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 팝업 / 옵션 페이지(React)만 담당한다.
// content script 와 service worker 는 scripts/build-content.mjs 가 esbuild 로
// 별도 IIFE 번들을 만든다 — 1계층 훅은 유튜브 스크립트보다 먼저 "동기적으로"
// 실행돼야 하므로 ESM 로더로 감싸면 안 된다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
      },
    },
  },
})
