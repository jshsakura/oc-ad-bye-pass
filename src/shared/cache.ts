// Cache for the remote filter lists. The background writes it; content scripts
// and the UI read it. Content scripts never touch the network — only this cache.

import type { FilterList } from './filterlist.ts'
import { CACHE_KEY } from './settings.ts'

export interface FilterCache {
  /** Where it came from. A changed URL means a different list, so the cache is dropped. */
  url: string
  fetchedAt: number
  list: FilterList
  /** How many entries validation threw away. */
  dropped: number
  /** Why the last refresh failed, or null if it succeeded. */
  error: string | null
  /**
   * The ETag the server gave us. Sending it back as If-None-Match means an
   * unchanged list costs a bare 304 instead of 4KB of body — a few headers.
   * May be absent; not every server sends one.
   */
  etag?: string | null
}

/** One entry per subscribed URL. The URL is the key **and** stays inside the value. */
export type FilterCaches = Record<string, FilterCache>

function isCache(value: unknown): value is FilterCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FilterCache).url === 'string' &&
    !!(value as FilterCache).list
  )
}

/**
 * Read the cache, accepting the shape an older build wrote.
 *
 * Before subscriptions there was one list and the key held one `FilterCache`
 * directly. Upgrading must not throw that away: the first thing the new build
 * does on a phone is read this, and a dropped cache means every page runs on
 * bundled rules until a network round trip finishes.
 */
export function readCaches(stored: unknown): FilterCaches {
  if (typeof stored !== 'object' || stored === null) return {}
  if (isCache(stored)) return { [stored.url]: stored }
  const out: FilterCaches = {}
  for (const [url, value] of Object.entries(stored as Record<string, unknown>)) {
    if (isCache(value)) out[url] = value
  }
  return out
}

export async function loadCaches(): Promise<FilterCaches> {
  const got = await chrome.storage.local.get(CACHE_KEY)
  return readCaches(got[CACHE_KEY])
}

export async function saveCaches(caches: FilterCaches): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: caches })
}

export function watchCaches(cb: (caches: FilterCaches) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area === 'local' && changes[CACHE_KEY]) {
      cb(readCaches(changes[CACHE_KEY].newValue))
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

/**
 * The lists to apply, in subscription order.
 *
 * Order is the merge order, and the merge is a union, so it only decides which
 * copy of a duplicate selector survives — but keeping it stable keeps the
 * generated stylesheet stable, which keeps diffs readable when something goes
 * wrong on somebody's screen.
 */
export function listsFrom(caches: FilterCaches, urls: readonly string[]): FilterList[] {
  const out: FilterList[] = []
  for (const url of urls) {
    const cache = caches[url]
    if (cache) out.push(cache.list)
  }
  return out
}
