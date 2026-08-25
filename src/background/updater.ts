// Refreshing the remote filter lists. This is the only place in the whole extension that touches the network.

import { loadCaches, saveCaches, type FilterCache, type FilterCaches } from '../shared/cache.ts'
import { MAX_LIST_BYTES, parseFilterList } from '../shared/filterlist.ts'
import type { FilterStatus, ListStatus } from '../shared/messages.ts'
import { loadSettings, type Settings, type Subscription } from '../shared/settings.ts'

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

function rowOf(sub: Subscription, cache: FilterCache | undefined, error: string | null): ListStatus {
  return {
    url: sub.url,
    name: cache?.list.name ?? null,
    version: cache?.list.version ?? null,
    fetchedAt: cache?.fetchedAt ?? null,
    error,
    dropped: cache?.dropped ?? 0,
    enabled: sub.enabled,
  }
}

/**
 * Roll the rows up into the one-line answer.
 *
 * A disabled subscription is not a failure and not a source — it is simply not
 * participating, so it contributes nothing here while still appearing as a row.
 */
function rollUp(rows: ListStatus[]): FilterStatus {
  const live = rows.filter((row) => row.enabled)
  const fetched = live.filter((row) => row.fetchedAt !== null)
  return {
    ok: live.every((row) => row.error === null),
    version: fetched.length ? Math.max(...fetched.map((row) => row.version ?? 0)) : null,
    fetchedAt: fetched.length ? Math.max(...fetched.map((row) => row.fetchedAt ?? 0)) : null,
    source: fetched.length ? 'remote' : 'bundled',
    error: live.find((row) => row.error !== null)?.error ?? null,
    dropped: live.reduce((n, row) => n + row.dropped, 0),
    lists: rows,
  }
}

/** Every list switched off, or the master switch off: bundled rules and nothing else. */
function bundledOnly(settings: Settings): FilterStatus {
  return rollUp(settings.lists.map((sub) => rowOf({ ...sub, enabled: false }, undefined, null)))
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

/**
 * Refresh one subscription. Returns the cache entry to keep for it.
 *
 * Never throws and never returns nothing: on any failure the previously cached
 * list stays in place with the error recorded beside it. A list that cannot be
 * refreshed is still a list that works.
 */
async function refreshOne(
  sub: Subscription,
  cached: FilterCache | undefined,
  force: boolean,
): Promise<{ cache: FilterCache | undefined; error: string | null }> {
  if (!force && cached && Date.now() - cached.fetchedAt < MIN_INTERVAL_MS) {
    return { cache: cached, error: cached.error }
  }

  if (!(await hasPermissionFor(sub.url))) {
    return { cache: cached, error: '이 주소에 접근할 권한이 없습니다. 설정에서 권한을 허용해 주세요.' }
  }

  let text: string
  let nextEtag: string | null = null
  try {
    const response = await fetch(sub.url, {
      // no-store takes the browser HTTP cache out of the picture so **we** own
      // the conditional request. With no-cache the browser intercepts the 304
      // and fills in the body, leaving us unable to tell whether anything
      // actually changed.
      cache: 'no-store',
      redirect: 'follow',
      headers: cached?.etag ? { 'If-None-Match': cached.etag } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    // Nothing changed. There is no body, so nothing to parse or validate —
    // just bump fetchedAt to restart the clock until the next check.
    if (response.status === 304 && cached) {
      return { cache: { ...cached, fetchedAt: Date.now(), error: null }, error: null }
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    nextEtag = response.headers.get('etag')
    text = await readCapped(response, MAX_LIST_BYTES)
  } catch (e) {
    const error = `가져오기 실패: ${(e as Error).message}`
    return { cache: cached ? { ...cached, error } : undefined, error }
  }

  const result = parseFilterList(text, { minVersion: cached?.list.version })
  if (!result.ok) {
    const error = `검증 실패: ${result.error}`
    return { cache: cached ? { ...cached, error } : undefined, error }
  }

  if (result.dropped.length) {
    console.warn(`[oc-ad-bye-pass] ${sub.url} 규칙 일부를 걸러냈습니다:`, result.dropped)
  }

  return {
    cache: {
      url: sub.url,
      fetchedAt: Date.now(),
      list: result.list,
      dropped: result.dropped.length,
      error: null,
      etag: nextEtag,
    },
    error: null,
  }
}

/**
 * Refresh every enabled subscription.
 *
 * **Sequentially, not in parallel.** There are at most `MAX_LISTS` of them and
 * each usually ends at a 304, so the wall-clock difference is nothing; what
 * parallel would cost is a service worker holding several capped stream reads
 * at once, on a phone, for a job nobody is waiting on.
 *
 * One list failing never touches another: each keeps its own cache entry and
 * its own error, and the stylesheet is rebuilt from whatever is present.
 */
export async function updateFilters(force = false): Promise<FilterStatus> {
  const settings = await loadSettings()
  if (!settings.listEnabled) return bundledOnly(settings)

  const caches = await loadCaches()
  const next: FilterCaches = {}
  const rows: ListStatus[] = []
  let changed = false

  for (const sub of settings.lists) {
    if (!sub.enabled) {
      // Keep the cache. Switching a list off is not the same as dropping it,
      // and re-fetching a corpus because somebody toggled twice is wasteful.
      if (caches[sub.url]) next[sub.url] = caches[sub.url]
      rows.push(rowOf(sub, caches[sub.url], null))
      continue
    }
    const { cache, error } = await refreshOne(sub, caches[sub.url], force)
    if (cache) next[sub.url] = cache
    if (cache !== caches[sub.url]) changed = true
    rows.push(rowOf(sub, cache, error))
  }

  // A subscription that was removed leaves its cache behind; this is where it
  // goes. Comparing keys rather than always writing keeps the storage listener
  // — and therefore every content script's recompute — quiet when nothing moved.
  if (Object.keys(next).length !== Object.keys(caches).length) changed = true
  if (changed) await saveCaches(next)

  return rollUp(rows)
}

export async function currentStatus(): Promise<FilterStatus> {
  const settings = await loadSettings()
  if (!settings.listEnabled) return bundledOnly(settings)
  const caches = await loadCaches()
  return rollUp(
    settings.lists.map((sub) => rowOf(sub, caches[sub.url], caches[sub.url]?.error ?? null)),
  )
}
