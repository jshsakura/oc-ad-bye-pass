// vite(팝업/옵션) watch 와 esbuild(content/background) watch 를 함께 띄운다.
// 둘 다 dist/ 로 떨어지므로 chrome://extensions 에서 dist/ 를 한 번만 로드하면 된다.

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
