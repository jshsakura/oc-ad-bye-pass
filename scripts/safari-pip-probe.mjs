// Does the call this extension makes actually open a picture-in-picture window?
//
// It is the one question the whole feature rests on and the one nothing here
// could answer. Chromium takes a different API. Playwright's WebKit — Linux and
// macOS both — carries `webkitSupportsPresentationMode` and answers `false` for
// every video, headless or not: the API is there, the machinery behind it is
// not.
//
// Real Safari has the machinery, and a macOS runner has real Safari. So this
// drives it over WebDriver directly (no client library, it is four HTTP calls),
// clicks a button for real — user activation is the whole game — and reads back
// what the video did.
//
//   sudo safaridriver --enable
//   safaridriver -p 4444 &
//   node scripts/safari-pip-probe.mjs
//
// Exit code 0 means the mode changed to picture-in-picture. Anything else prints
// what was seen instead, which is the finding either way.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DRIVER = process.env.SAFARIDRIVER ?? 'http://127.0.0.1:4444'
const PORT = 8099
const MP4 = readFileSync(path.resolve(import.meta.dirname, '..', 'e2e', 'assets', 'tiny.mp4'))

// A player shaped like YouTube's: inline, muted, opted out of picture-in-picture.
// Served rather than inlined because Safari will not run a top-level data: URL.
const PAGE = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#111">
<video id="v" playsinline muted loop autoplay disablePictureInPicture
  src="/tiny.mp4" style="width:320px;height:180px"></video>
<video id="ctrl" playsinline muted loop autoplay disablePictureInPicture
  src="/tiny.mp4" style="width:320px;height:180px"></video>
<button id="tap" style="width:200px;height:60px;font-size:20px">tap</button>
<button id="tapctrl" style="width:200px;height:60px;font-size:20px">tap control</button>
<script>
  const video = document.getElementById('v')
  window.__result = { clicked: false }
  document.getElementById('tap').addEventListener('click', () => {
    // The order src/isolated/pip.ts uses, inside the tap.
    video.removeAttribute('disablePictureInPicture')
    video.disablePictureInPicture = false
    if (video.paused) video.play()
    const supported = typeof video.webkitSupportsPresentationMode === 'function'
      ? video.webkitSupportsPresentationMode('picture-in-picture')
      : null
    let threw = null
    try {
      video.webkitSetPresentationMode('picture-in-picture')
    } catch (e) {
      threw = String(e)
    }
    window.__result = { clicked: true, supported, threw }
  })

  // 대조군 — opt-out 을 그대로 둔 채로 부른다. 우리가 걷어내는 일이 실제로
  // 필요한 것인지, 아니면 사파리가 이 API 에서는 그 표시를 아예 안 보는지.
  const control = document.getElementById('ctrl')
  window.__control = { clicked: false }
  document.getElementById('tapctrl').addEventListener('click', () => {
    let threw = null
    try {
      control.webkitSetPresentationMode('picture-in-picture')
    } catch (e) {
      threw = String(e)
    }
    window.__control = { clicked: true, threw, optOut: control.disablePictureInPicture }
  })
</script>
</body>`

const server = createServer((req, res) => {
  if (req.url === '/tiny.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': MP4.length })
    res.end(MP4)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

async function call(method, endpoint, body) {
  const res = await fetch(`${DRIVER}${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status} ${JSON.stringify(json)}`)
  return json.value
}

const session = await call('POST', '/session', {
  capabilities: { alwaysMatch: { browserName: 'safari' } },
})
const id = session.sessionId
const at = (endpoint) => `/session/${id}${endpoint}`

try {
  await call('POST', at('/url'), { url: `http://127.0.0.1:${PORT}/` })

  // Metadata first: WebKit answers "not supported" for a video it has not read yet.
  const ready = await call('POST', at('/execute/sync'), {
    script: 'return document.getElementById("v").readyState',
    args: [],
  })
  console.log('readyState:', ready)

  const before = await call('POST', at('/execute/sync'), {
    script:
      'const v = document.getElementById("v");' +
      'return { api: typeof v.webkitSetPresentationMode, supported: typeof v.webkitSupportsPresentationMode === "function" ? v.webkitSupportsPresentationMode("picture-in-picture") : null, mode: v.webkitPresentationMode, optOut: v.disablePictureInPicture }',
    args: [],
  })
  console.log('탭 전:', JSON.stringify(before))

  // A real click. Everything about this feature turns on user activation, and
  // WebDriver's click is the only kind here that carries it.
  const button = await call('POST', at('/element'), { using: 'css selector', value: '#tap' })
  await call('POST', at(`/element/${Object.values(button)[0]}/click`), {})

  await new Promise((resolve) => setTimeout(resolve, 1500))

  const after = await call('POST', at('/execute/sync'), {
    script:
      'const v = document.getElementById("v");' +
      'return { result: window.__result, mode: v.webkitPresentationMode }',
    args: [],
  })
  console.log('탭 후:', JSON.stringify(after))

  // 대조군을 눌러보기 전에 우리 창을 닫는다 — 한 번에 하나만 뜬다.
  await call('POST', at('/execute/sync'), {
    script: 'document.getElementById("v").webkitSetPresentationMode("inline"); return null',
    args: [],
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  const controlButton = await call('POST', at('/element'), {
    using: 'css selector',
    value: '#tapctrl',
  })
  await call('POST', at(`/element/${Object.values(controlButton)[0]}/click`), {})
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const control = await call('POST', at('/execute/sync'), {
    script:
      'const c = document.getElementById("ctrl");' +
      'return { result: window.__control, mode: c.webkitPresentationMode }',
    args: [],
  })
  console.log('대조군(opt-out 유지):', JSON.stringify(control))

  if (after.mode === 'picture-in-picture') {
    console.log('\n✅ 사파리에서 webkitSetPresentationMode 가 실제로 작은 창을 열었다')
  } else {
    console.log(`\n❌ 표시 모드가 ${after.mode} 에 머물렀다`)
    process.exitCode = 1
  }
} finally {
  await call('DELETE', at('')).catch(() => {})
  server.close()
}
