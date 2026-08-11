// Cache for the remote filter list. The background writes it; content scripts
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

export async function loadCache(): Promise<FilterCache | null> {
  const got = await chrome.storage.local.get(CACHE_KEY)
  const cache = got[CACHE_KEY] as FilterCache | undefined
  if (!cache || typeof cache !== 'object' || !cache.list) return null
  return cache
}

export async function saveCache(cache: FilterCache): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache })
}

export function watchCache(cb: (cache: FilterCache | null) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area === 'local' && changes[CACHE_KEY]) {
      cb((changes[CACHE_KEY].newValue as FilterCache | undefined) ?? null)
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
