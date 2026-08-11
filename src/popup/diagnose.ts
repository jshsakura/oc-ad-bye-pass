// What this browser actually gave us.
//
// Written because the alternative was a phone. Orion on iOS refuses a package
// with one line — "Something went wrong" — and answers no other question
// either: whether the MAIN world registration took, whether picture-in-picture
// exists there, whether the network layer is present at all. Every one of those
// was a round trip: guess, build, install, ask.
//
// So the extension reports on itself, and the report is one button away and
// copyable. A screenshot of this beats three exchanges of "try this one".
//
// Two halves, deliberately separate: what the extension context can see about
// itself, and what the page saw. The page half is written by the content script
// into storage rather than pulled with `scripting.executeScript`, because that
// call needs `activeTab` — granted only when the user invokes the extension, and
// of unknown standing on Orion. Diagnostics should not fail for the same reason
// they are being consulted.

export interface ExtensionFacts {
  version: string
  /** Absent on WebKit targets; its absence is the whole reason two builds exist. */
  networkBlocking: boolean
  /** The covering path for browsers that ignore the static `world` field. */
  registeredMainWorld: boolean
  registrationError: string | null
}

/** Written by src/isolated/diagnostics.ts, from the page itself. */
export interface PageFacts {
  at: number
  url: string
  /** Layer 1 sets this on documentElement once its hooks are in. */
  layer1: boolean
  videos: number
  pip: 'webkit' | 'standard' | 'none'
  fullscreenFallback: boolean
  visibilityState: string
  userAgent: string
}

export interface Report {
  extension: ExtensionFacts
  page: PageFacts | null
  /** Why the page could not be read, when it could not. */
  pageError: string | null
}

const SCRIPT_ID = 'oc-ad-bye-pass-main'

async function extensionFacts(): Promise<ExtensionFacts> {
  let registered = false
  let registrationError: string | null = null
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    registered = scripts.length > 0
  } catch (e) {
    registrationError = e instanceof Error ? e.message : String(e)
  }

  return {
    version: chrome.runtime.getManifest().version,
    networkBlocking: typeof chrome.declarativeNetRequest !== 'undefined',
    registeredMainWorld: registered,
    registrationError,
  }
}

export async function collect(): Promise<Report> {
  const extension = await extensionFacts()
  const got = await chrome.storage.local.get('diagnostics')
  const page = (got.diagnostics as PageFacts | undefined) ?? null
  return {
    extension,
    page,
    pageError: page ? null : '아직 어떤 페이지도 보고하지 않았습니다 (탭을 한 번 새로고침해 보세요)',
  }
}

/** The report as text, for pasting into a message. */
export function format(report: Report): string {
  const { extension: x, page } = report
  const lines = [
    `oc-ad-bye-pass v${x.version}`,
    `네트워크 차단(DNR): ${x.networkBlocking ? '있음' : '없음'}`,
    `MAIN world 등록: ${x.registeredMainWorld ? '됨' : '안 됨'}${
      x.registrationError ? ` (${x.registrationError})` : ''
    }`,
  ]
  if (page) {
    lines.push(
      `페이지: ${page.url}`,
      `보고 시각: ${new Date(page.at).toLocaleTimeString()}`,
      `1계층 설치됨: ${page.layer1 ? '예' : '아니오'}`,
      `비디오: ${page.videos}개`,
      `PiP: ${page.pip === 'none' ? '없음' : page.pip}`,
      `전체화면 폴백: ${page.fullscreenFallback ? '있음' : '없음'}`,
      `문서 상태: ${page.visibilityState}`,
    )
  } else {
    lines.push(`페이지: 읽지 못함 — ${report.pageError ?? '알 수 없음'}`)
  }
  lines.push(`UA: ${page?.userAgent ?? navigator.userAgent}`)
  return lines.join('\n')
}
