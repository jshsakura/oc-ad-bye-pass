// AdGuard 의 json-prune 과 같은 일을 한다: 플레이어 응답 객체에서 광고 필드를 지운다.
// ReVanced 의 video-ads 패치가 PlayerResponseModel 에서 adPlacements/playerAds/adSlots 를
// 없애는 것과 같은 지점이다. 광고를 "숨기는" 게 아니라 애초에 로드되지 않게 만든다.

/** 광고 필드가 붙어 있을 수 있는 컨테이너 키 — 여기까지만 내려간다 (전체 순회는 비싸다) */
const NESTED_ROOT_KEYS = ['playerResponse', 'player_response', 'response']

function deleteAtPath(node: unknown, segments: string[]): number {
  let cur = node
  for (let i = 0; i < segments.length - 1; i++) {
    if (typeof cur !== 'object' || cur === null) return 0
    cur = (cur as Record<string, unknown>)[segments[i]]
  }
  if (typeof cur !== 'object' || cur === null) return 0
  const last = segments[segments.length - 1]
  if (!Object.prototype.hasOwnProperty.call(cur, last)) return 0
  delete (cur as Record<string, unknown>)[last]
  return 1
}

/**
 * data 와 그 바로 아래 응답 컨테이너에서 paths 를 지운다. 지운 개수를 돌려준다.
 * 깊은 재귀는 하지 않는다 — 유튜브 응답은 수 MB 라 전체 순회하면 스크롤이 끊긴다.
 * 피드에 박히는 광고 카드는 2계층(CSS)이 맡는다.
 */
export function pruneAdFields(data: unknown, paths: string[]): number {
  if (typeof data !== 'object' || data === null) return 0

  if (Array.isArray(data)) {
    let n = 0
    for (const item of data) n += pruneAdFields(item, paths)
    return n
  }

  let removed = 0
  const obj = data as Record<string, unknown>
  const splitPaths = paths.map((p) => p.split('.'))

  for (const segments of splitPaths) removed += deleteAtPath(obj, segments)

  for (const key of NESTED_ROOT_KEYS) {
    const nested = obj[key]
    if (typeof nested !== 'object' || nested === null) continue
    for (const segments of splitPaths) removed += deleteAtPath(nested, segments)
  }

  return removed
}
