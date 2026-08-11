// Refreshing the remote filter list. This is the only place in the whole extension that touches the network.

import { loadCache, saveCache, type FilterCache } from '../shared/cache.ts'
import { MAX_LIST_BYTES, parseFilterList } from '../shared/filterlist.ts'
import type { FilterStatus } from '../shared/messages.ts'
import { loadSettings } from '../shared/settings.ts'

const FETCH_TIMEOUT_MS = 10_000

/**
 * Minimum interval between non-forced refreshes.
 *
 * Every YouTube tab that opens comes through here (the content script pokes
 * us), so a floor is needed. A hundred tab opens still make one real request
 * per interval.
 *
 * This has come down from 6 hours to 30 minutes to 10. ETag is what made that
 * affordable — when nothing changed the server answers 304 and stops, so a
 * check costs a few headers instead of 4KB.
 */
const MIN_INTERVAL_MS = 10 * 60 * 1000

function statusOf(cache: FilterCache | null, error: string | null): FilterStatus {
  return {
    ok: error === null,
    version: cache?.list.version ?? null,
    fetchedAt: cache?.fetchedAt ?? null,
    source: cache ? 'remote' : 'bundled',
    error,
    dropped: cache?.dropped ?? 0,
  }
}

/**
 * Read a response body, bailing out as soon as it grows past `limit`.
 *
 * `parseFilterList` already rejects oversized lists, but by then the bytes are
 * on the wire and in memory: a hostile or misconfigured server can make us pull
 * megabytes before we say no. Two guards, because either one alone has a hole:
 *
 *   1. `Content-Length` — cheap, but absent under chunked transfer encoding and
 *      trivially understated by a server that means us harm.
 *   2. Counting as we read — the one that actually holds. We cancel the stream
 *      mid-flight the moment the running total passes the cap.
 *
 * Throwing here lands in the caller's catch, which keeps the previously cached
 * list in place. Refusing an update is always safer than accepting a bad one.
 */
async function readCapped(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`list too large (${declared} > ${limit} bytes)`)
  }

  // Environments without a readable stream (some polyfills, test doubles) still
  // get the size check above plus the one in parseFilterList.
  if (!response.body) return await response.text()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error(`list too large (> ${limit} bytes)`)
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released by cancel()
    }
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/**
 * Whether we may fetch this list.
 *
 * The manifest is consulted first, and it is the answer for the addresses this
 * extension ships with. `permissions.contains` is not to be trusted for those:
 * on Orion it answers false for an origin the manifest declares outright, and
 * the update then never even attempted — the options page said "이 주소에 접근할
 * 권한이 없습니다" about raw.githubusercontent.com, which is the default list.
 *
 * For anything else — a URL somebody typed in — the API is still the only way
 * to know, but a refusal there means "ask for it", not "give up".
 */
function declaredInManifest(origin: string): boolean {
  const declared: string[] = chrome.runtime.getManifest().host_permissions ?? []
  return declared.some((pattern) => {
    const host = pattern.replace(/^\*:\/\//, 'https://').replace(/\/\*$/, '')
    try {
      return new URL(host).origin === origin
    } catch {
      return false
    }
  })
}

async function hasPermissionFor(url: string): Promise<boolean> {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return false
  }

  if (declaredInManifest(origin)) return true

  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] })
  } catch {
    // The call itself failed. Attempting the fetch and reporting what actually
    // happens beats refusing on the strength of an API that did not answer.
    return true
  }
}

export async function updateFilters(force = false): Promise<FilterStatus> {
  const settings = await loadSettings()
  const cached = await loadCache()

  if (!settings.listEnabled) {
    return { ok: true, version: null, fetchedAt: null, source: 'bundled', error: null, dropped: 0 }
  }

  const sameUrl = cached?.url === settings.listUrl
  if (!force && sameUrl && Date.now() - cached.fetchedAt < MIN_INTERVAL_MS) {
    return statusOf(cached, cached.error)
  }

  if (!(await hasPermissionFor(settings.listUrl))) {
    const error = '이 주소에 접근할 권한이 없습니다. 설정에서 권한을 허용해 주세요.'
    return statusOf(sameUrl ? cached : null, error)
  }

  // Only replay the ETag for the same URL — a different URL is a different list.
  const etag = sameUrl ? cached.etag : null

  let text: string
  let nextEtag: string | null = null
  try {
    const response = await fetch(settings.listUrl, {
      // no-store takes the browser HTTP cache out of the picture so **we** own
      // the conditional request. With no-cache the browser intercepts the 304
      // and fills in the body, leaving us unable to tell whether anything
      // actually changed.
      cache: 'no-store',
      redirect: 'follow',
      headers: etag ? { 'If-None-Match': etag } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    // Nothing changed. There is no body, so nothing to parse or validate —
    // just bump fetchedAt to restart the clock until the next check.
    if (response.status === 304 && cached) {
      const touched: FilterCache = { ...cached, fetchedAt: Date.now(), error: null }
      await saveCache(touched)
      return statusOf(touched, null)
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    nextEtag = response.headers.get('etag')
    text = await readCapped(response, MAX_LIST_BYTES)
  } catch (e) {
    // A failed fetch still leaves the existing cache doing its job
    const error = `가져오기 실패: ${(e as Error).message}`
    if (sameUrl && cached) await saveCache({ ...cached, error })
    return statusOf(sameUrl ? cached : null, error)
  }

  // Don't compare against the old version when the URL changed — it may be a different list
  const result = parseFilterList(text, {
    minVersion: sameUrl ? cached.list.version : undefined,
  })

  if (!result.ok) {
    const error = `검증 실패: ${result.error}`
    if (sameUrl && cached) await saveCache({ ...cached, error })
    return statusOf(sameUrl ? cached : null, error)
  }

  const next: FilterCache = {
    url: settings.listUrl,
    fetchedAt: Date.now(),
    list: result.list,
    dropped: result.dropped.length,
    error: null,
    etag: nextEtag,
  }
  await saveCache(next)
  if (result.dropped.length) {
    console.warn('[oc-ad-bye-pass] 규칙 일부를 걸러냈습니다:', result.dropped)
  }
  return statusOf(next, null)
}

export async function currentStatus(): Promise<FilterStatus> {
  const settings = await loadSettings()
  if (!settings.listEnabled) {
    return { ok: true, version: null, fetchedAt: null, source: 'bundled', error: null, dropped: 0 }
  }
  const cached = await loadCache()
  if (!cached || cached.url !== settings.listUrl) return statusOf(null, null)
  return statusOf(cached, cached.error)
}
