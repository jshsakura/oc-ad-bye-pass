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
  pipSupported: boolean | null
  fullscreenFallback: boolean
  visibilityState: string
  presentationMode: string
  inject: string | null
  captions: string | null
  audio: string | null
  translated: number
  log: string | null
  userAgent: string
}

/**
 * How layer 1 got onto the page — the question behind "why did an ad play".
 *
 * `차단됨` is the one that matters: the page refused the injected script, so
 * layer 1 is not there at all and every pre-roll plays. It is invisible any
 * other way, because the only other place it is reported is a console nobody
 * can open on a phone.
 */
/** What the caption picker did on this video. Set by src/main/captions.ts. */
const CAPTION_STATES: Record<string, string> = {
  watching: '대기 중 (재생 시작이나 자막 목록을 기다림)',
  'native-language': '영상이 이미 내 언어 (자막 안 켬)',
  matched: '현재 언어 자막 선택됨',
  translated: '자동 번역 켬',
  'matched:data': '현재 언어 자막 선택됨 (응답 데이터 경로)',
  'translated:data': '자동 번역 켬 (응답 데이터 경로)',
  'no-match': '맞는 자막·번역 없음',
  'no-match:data': '맞는 자막·번역 없음 (응답 데이터)',
  'set-failed:data': '선택 실패 (응답 데이터 경로)',
  'no-captions': '자막 없는 영상',
  'api-missing': '플레이어가 자막 API 를 안 내놓음 (이 브라우저에선 불가)',
  'set-failed': '선택 실패 (플레이어가 거부)',
}

/**
 * What the audio pin did on this video. Set by src/main/audio.ts.
 *
 * `api-missing` is the one that decides whether the feature exists at all on a
 * given build — the mobile player is a different player, and no amount of
 * reading from a desk answers whether it carries the audio methods.
 */
const AUDIO_STATES: Record<string, string> = {
  'watching(no-api)': '대기 중 (플레이어 오디오 API 를 기다림)',
  'watching(throws)': '대기 중 (오디오 목록 호출이 예외)',
  'watching(tracks=0)': '대기 중 (오디오 목록이 빔)',
  'single-track': '음성이 하나뿐인 영상 (더빙 없음)',
  'no-match': '내 언어 음성이 없는 영상 (그대로 둠)',
  'no-tracks': '오디오 목록을 못 읽음',
  'set-failed': '전환 실패 (플레이어가 거부)',
  'api-missing': '플레이어가 오디오 API 를 안 내놓음 (이 브라우저에선 불가)',
}

/** `already(ko)` / `switched(ko)` carry the language, so they are matched by prefix. */
function audioState(raw: string): string {
  const known = AUDIO_STATES[raw]
  if (known) return known
  const m = /^(already|switched)\(([a-z]{2,3}|\?)\)$/.exec(raw)
  if (m) return m[1] === 'switched' ? `${m[2]} 음성으로 전환함` : `이미 ${m[2]} 음성`
  const w = /^watching\(state=(-?\d+)\)$/.exec(raw)
  if (w) return `대기 중 (재생 시작 기다림, state=${w[1]})`
  return raw
}

const INJECT_STATES: Record<string, string> = {
  'not-needed': '필요 없음 — 등록된 스크립트가 먼저 붙었습니다',
  injected: '주입함 — 아직 로드도 실패도 아닙니다',
  loaded: '주입해서 로드됨 — 첫 파싱보다 늦었을 수 있습니다',
  blocked: '주입이 차단됨 — 이 페이지에 1계층이 없습니다',
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
  const got = await chrome.storage.local.get(['diagnostics', 'diagnosticsYoutube', 'diagnosticsLog'])
  const any = (got.diagnostics as PageFacts | undefined) ?? null
  const youtube = (got.diagnosticsYoutube as PageFacts | undefined) ?? null

  // YouTube's report wins unless something else has reported more recently — a
  // blank tab loading last used to wipe the answer to the question being asked.
  const page = youtube && (!any || any.at <= youtube.at || !isYoutube(any)) ? youtube : any
  const history = typeof got.diagnosticsLog === 'string' ? (got.diagnosticsLog as string) : null

  return {
    extension,
    page: page ? { ...page, log: history ?? page.log } : null,
    pageError: page ? null : '아직 어떤 페이지도 보고하지 않았습니다 (탭을 한 번 새로고침해 보세요)',
  }
}

function isYoutube(page: PageFacts): boolean {
  try {
    return new URL(page.url).hostname.endsWith('youtube.com')
  } catch {
    return false
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
      `1계층 주입: ${page.inject ? (INJECT_STATES[page.inject] ?? page.inject) : '기록 없음'}`,
      `비디오: ${page.videos}개`,
      `PiP: ${page.pip === 'none' ? '없음' : page.pip}`,
      // The API existing and this video being allowed to use it are different
      // things, and only the second one decides whether a tap can work.
      `PiP 지원(이 영상): ${page.pipSupported === null ? '알 수 없음' : page.pipSupported ? '예' : '아니오'}`,
      `전체화면 폴백: ${page.fullscreenFallback ? '있음' : '없음'}`,
      `표시 모드: ${page.presentationMode}`,
      `문서 상태: ${page.visibilityState}`,
      `자막 선택: ${page.captions ? (CAPTION_STATES[page.captions] ?? page.captions) : '동작 안 함'}`,
      `음성 고정: ${page.audio ? audioState(page.audio) : '동작 안 함'}`,
      `댓글 번역: ${page.translated ? `${page.translated}개 눌렀습니다` : '누른 것 없음'}`,
    )
  } else {
    lines.push(`페이지: 읽지 못함 — ${report.pageError ?? '알 수 없음'}`)
  }
  lines.push(`UA: ${page?.userAgent ?? navigator.userAgent}`)
  // Last, because it is the longest and the least often needed — until it is the
  // only thing that answers the question, which is every time the phone is the
  // only place the bug happens.
  if (page?.log) lines.push('', '--- 기록 ---', page.log)
  return lines.join('\n')
}
