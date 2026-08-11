// Is there a newer build than this one.
//
// A sideloaded extension cannot update itself: there is no API to install a
// package, and `runtime.requestUpdateCheck` only answers for extensions that
// came from a store. Orion re-checks the stores for the ones it installed from
// there, which is not us either.
//
// So this does the half that is possible — notice, and hand over the download.
// The install itself stays two taps in the Extensions list, which is the part
// no extension is allowed to do on anyone's behalf.
//
// The version is read from package.json on main rather than the releases API,
// for one reason: raw.githubusercontent.com is already in host_permissions
// because the filter list lives there. Asking for api.github.com as well would
// add a permission to every install to save one HTTP call.

const VERSION_URL =
  'https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/package.json'

/** Two-second budget. This runs behind a button and nobody waits longer. */
const TIMEOUT_MS = 6000

export interface UpdateCheck {
  current: string
  latest: string | null
  newer: boolean
  error: string | null
}

/** Compare dotted numeric versions. Returns true when b is newer than a. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const left = x[i] ?? 0
    const right = y[i] ?? 0
    if (right > left) return true
    if (right < left) return false
  }
  return false
}

/** Which package this install came from, so the download offered is the right one. */
export function packageForThisBuild(): 'orion' | 'desktop' {
  // The Orion build ships without declarativeNetRequest — that is the whole
  // difference between the two, so it is also how a build knows which it is.
  return typeof chrome.declarativeNetRequest === 'undefined' ? 'orion' : 'desktop'
}

export function downloadUrlFor(kind: 'orion' | 'desktop'): string {
  return `https://github.com/jshsakura/oc-ad-bye-pass/releases/latest/download/oc-ad-bye-pass-${kind}.zip`
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = chrome.runtime.getManifest().version

  try {
    const response = await fetch(VERSION_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      return { current, latest: null, newer: false, error: `서버가 ${response.status} 를 돌려줬습니다` }
    }
    const body = (await response.json()) as { version?: unknown }
    const latest = typeof body.version === 'string' ? body.version : null
    if (!latest) {
      return { current, latest: null, newer: false, error: '버전을 읽지 못했습니다' }
    }
    return { current, latest, newer: isNewer(current, latest), error: null }
  } catch (e) {
    return {
      current,
      latest: null,
      newer: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
