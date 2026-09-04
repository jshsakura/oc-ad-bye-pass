// Uploads a package to Microsoft Edge Add-ons and publishes it.
//
//   node scripts/publish-edge.mjs <package.zip>
//
// Edge takes the Chrome package unchanged, so there is no edge build target —
// this hands `dist`'s zip to a second store and nothing else.
//
// **Both calls are asynchronous, and both report failure later than they
// answer.** The upload returns 202 with an operation id in the Location header;
// the publish does the same. A run that posts the publish and stops has not
// learned anything — the version can still come back `NoModulesUpdated`, or
// `InProgressSubmission` because the previous submission is still in review, and
// the store quietly keeps serving the old build while CI is green. This is the
// same trap the Chrome step was caught by, so both operations are polled to a
// terminal state here and a non-Succeeded status exits non-zero.
//
// Credentials come from the environment (EDGE_PRODUCT_ID, EDGE_CLIENT_ID,
// EDGE_API_KEY) and are never logged. Missing credentials exit SKIPPED rather
// than 0: a caller that reads "not a failure" as "published" writes a green tick
// against a store that received nothing, which is the same lie as a silent
// failure and harder to notice.

import { readFileSync } from 'node:fs'

const BASE = 'https://api.addons.microsoftedge.microsoft.com/v1/products'
/** Nothing was attempted. Distinct from both success and failure. */
const SKIPPED = 75
/** The store's own guidance is that an upload settles in a couple of minutes. */
const POLL_INTERVAL_MS = 10_000
const POLL_LIMIT = 60

const { EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID: clientId, EDGE_API_KEY: apiKey } = process.env
const zipPath = process.argv[2]

if (!zipPath) {
  console.error('사용법: node scripts/publish-edge.mjs <package.zip>')
  process.exit(2)
}
if (!productId || !clientId || !apiKey) {
  console.log('엣지 시크릿이 없어 건너뜁니다 — EDGE_PRODUCT_ID · EDGE_CLIENT_ID · EDGE_API_KEY')
  process.exit(SKIPPED)
}

const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The operation id arrives in the Location header, not the body.
 *
 * A 202 with no Location is not something to keep going from: every later call
 * addresses the operation by that id, and polling `undefined` returns a 404 that
 * reads like a credentials problem.
 */
async function startOperation(label, path, init) {
  const response = await fetch(`${BASE}/${productId}${path}`, init)
  if (!response.ok) {
    throw new Error(`${label} 실패: HTTP ${response.status} ${await response.text()}`)
  }
  const id = response.headers.get('location')
  if (!id) throw new Error(`${label}: 202 는 왔는데 Location 헤더에 operation id 가 없다`)
  console.log(`${label} operation: ${id}`)
  return id
}

/** Poll one operation to a terminal state. Returns the final body. */
async function settle(label, path) {
  for (let i = 0; i < POLL_LIMIT; i++) {
    const response = await fetch(`${BASE}/${productId}${path}`, { headers: auth })
    if (!response.ok) {
      throw new Error(`${label} 상태 조회 실패: HTTP ${response.status} ${await response.text()}`)
    }
    const body = await response.json()
    console.log(`  ${label}: ${body.status}${body.message ? ` — ${body.message}` : ''}`)
    if (body.status === 'Succeeded') return body
    // `errors` carries the detail; the message alone says "an error occurred".
    if (body.status === 'Failed') {
      throw new Error(
        `${label} 실패 [${body.errorCode || '코드 없음'}]: ${body.message}` +
          (body.errors ? `\n${JSON.stringify(body.errors, null, 2)}` : ''),
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`${label} 이 ${(POLL_INTERVAL_MS * POLL_LIMIT) / 1000}초 안에 끝나지 않았다`)
}

const uploadId = await startOperation('업로드', '/submissions/draft/package', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/zip' },
  body: readFileSync(zipPath),
})
await settle('업로드', `/submissions/draft/package/operations/${uploadId}`)

// The body is the note the certification reviewer reads. Plain text, and it
// says where the source actually is — the package is bundled, and a reviewer
// who cannot find the source is a reviewer who rejects it.
const publishId = await startOperation('게시', '/submissions', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'text/plain' },
  body: `${process.env.GITHUB_REF_NAME ?? 'local'} — https://github.com/jshsakura/oc-ad-bye-pass`,
})
await settle('게시', `/submissions/operations/${publishId}`)

console.log('✅ 엣지 애드온즈 게시 완료')
