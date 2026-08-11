// Does what AdGuard's json-prune does: strip ad fields out of the player
// response object. Same place ReVanced's video-ads patch removes
// adPlacements/playerAds/adSlots from PlayerResponseModel. This does not
// "hide" ads — it stops them being loaded at all.

/** Container keys an ad field may sit under. We descend no further — a full walk is expensive. */
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
 * Delete `paths` from `data` and from the response containers directly under
 * it, returning how many were removed.
 *
 * No deep recursion: YouTube responses run to megabytes, and walking all of it
 * on every parse makes scrolling stutter. Ad cards embedded in the feed are
 * layer 2's job (CSS).
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
