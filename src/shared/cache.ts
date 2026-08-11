// 원격 필터 리스트 캐시. 백그라운드가 쓰고, 콘텐츠 스크립트/UI 가 읽는다.
// 콘텐츠 스크립트는 네트워크에 직접 접근하지 않는다 — 이 캐시만 본다.

import type { FilterList } from './filterlist.ts'
import { CACHE_KEY } from './settings.ts'

export interface FilterCache {
  /** 어느 URL 에서 받았는지 (URL 이 바뀌면 캐시를 버린다) */
  url: string
  fetchedAt: number
  list: FilterList
  /** 검증에서 걸러낸 항목 수 */
  dropped: number
  /** 마지막 갱신 실패 사유. 성공했으면 null */
  error: string | null
  /**
   * 서버가 준 ETag. 다음 요청에 If-None-Match 로 되돌려주면, 바뀐 게 없을 때
   * 서버가 본문 없이 304 만 준다 — 4KB 대신 헤더 몇 줄이다.
   * 없을 수도 있다 (ETag 를 안 주는 서버).
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
