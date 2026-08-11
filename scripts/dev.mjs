// Runs the vite watcher (popup/options) and the esbuild watcher
// (content/background) side by side. Both emit into dist/, so you load dist/
// once in chrome://extensions and leave it there.

import { spawn } from 'node:child_process'

const children = [
  spawn('npx', ['vite', 'build', '--watch'], { stdio: 'inherit', shell: false }),
  spawn('node', ['scripts/build-content.mjs', '--watch'], { stdio: 'inherit', shell: false }),
]

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => { if (code) { stop(); process.exit(code ?? 1) } })
