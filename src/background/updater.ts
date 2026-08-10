// 원격 필터 리스트 갱신. 네트워크에 나가는 곳은 확장 전체에서 여기 하나뿐이다.

import { loadCache, saveCache, type FilterCache } from '../shared/cache.ts'
import { parseFilterList } from '../shared/filterlist.ts'
import type { FilterStatus } from '../shared/messages.ts'
import { loadSettings } from '../shared/settings.ts'

const FETCH_TIMEOUT_MS = 10_000
/** 강제 갱신이 아닐 때의 최소 간격 — 알람이 겹쳐 울려도 과하게 때리지 않는다 */
const MIN_INTERVAL_MS = 30 * 60 * 1000

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

async function hasPermissionFor(url: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] })
  } catch {
    return false
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

  let text: string
  try {
    const response = await fetch(settings.listUrl, {
      cache: 'no-cache',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    text = await response.text()
  } catch (e) {
    // 받아오지 못해도 기존 캐시로 계속 동작한다
    const error = `가져오기 실패: ${(e as Error).message}`
    if (sameUrl && cached) await saveCache({ ...cached, error })
    return statusOf(sameUrl ? cached : null, error)
  }

  // URL 이 바뀌었으면 예전 version 과 비교하지 않는다 (다른 리스트일 수 있으므로)
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
