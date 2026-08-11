// 원격 필터 리스트 갱신. 네트워크에 나가는 곳은 확장 전체에서 여기 하나뿐이다.

import { loadCache, saveCache, type FilterCache } from '../shared/cache.ts'
import { parseFilterList } from '../shared/filterlist.ts'
import type { FilterStatus } from '../shared/messages.ts'
import { loadSettings } from '../shared/settings.ts'

const FETCH_TIMEOUT_MS = 10_000

/**
 * 강제 갱신이 아닐 때의 최소 간격.
 *
 * 유튜브 탭을 열 때마다 여기를 거치므로(콘텐츠 스크립트가 찌른다) 바닥이 필요하다.
 * 탭을 백 번 열어도 실제 요청은 10분에 한 번이다.
 *
 * 6시간 → 30분 → 10분으로 줄여왔다. 줄일 수 있었던 건 ETag 덕분이다 — 바뀐 게
 * 없으면 서버가 304 만 주고 끝나서 한 번 확인하는 비용이 4KB 가 아니라 헤더 몇 줄이다.
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

  // 같은 URL 을 다시 볼 때만 ETag 를 되돌려준다. URL 이 바뀌었으면 다른 리스트다.
  const etag = sameUrl ? cached.etag : null

  let text: string
  let nextEtag: string | null = null
  try {
    const response = await fetch(settings.listUrl, {
      // no-store 로 브라우저 HTTP 캐시를 통째로 빼고 조건부 요청을 **우리가** 관리한다.
      // no-cache 로 두면 304 를 브라우저가 가로채 본문을 채워주는데, 그러면 실제로
      // 갱신이 있었는지 우리 쪽에서 구분할 수 없다.
      cache: 'no-store',
      redirect: 'follow',
      headers: etag ? { 'If-None-Match': etag } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    // 바뀐 게 없다 — 본문이 없으므로 파싱도 검증도 하지 않는다.
    // fetchedAt 만 올려서 다음 확인까지의 시계를 다시 감는다.
    if (response.status === 304 && cached) {
      const touched: FilterCache = { ...cached, fetchedAt: Date.now(), error: null }
      await saveCache(touched)
      return statusOf(touched, null)
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    nextEtag = response.headers.get('etag')
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
