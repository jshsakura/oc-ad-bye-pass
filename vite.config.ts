import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveTarget } from './scripts/targets.mjs'
import { writeManifest } from './scripts/manifest.mjs'

const target = resolveTarget()

// Overwrites the copied manifest with the target-specific one *after* vite has
// copied public/manifest.json. Being in closeBundle means it reruns on every
// watch rebuild too, so a Safari manifest never silently reverts to the Chrome
// original mid-development.
const manifestPlugin = {
  name: 'oc-manifest',
  closeBundle() {
    writeManifest(target)
  },
}

// Handles only the popup and options pages (React).
// The content scripts and service worker are built separately as IIFE bundles
// by scripts/build-content.mjs — the layer 1 hooks must run **synchronously**
// ahead of YouTube's scripts, so they cannot be wrapped in an ESM loader.
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
