// Safari 전용 — MAIN world 콘텐츠 스크립트를 런타임에 등록한다.
//
// 왜 매니페스트가 아니라 여기인가:
//   Safari 는 정적 content_scripts 의 `world` 필드를 버전에 따라 무시한다. 무시되면
//   main.js 가 ISOLATED 로 실행되고, 그러면 JSON.parse 를 후킹해도 페이지에서는
//   원본이 보인다 — 아무 오류 없이 1계층이 통째로 죽는다. 반면
//   scripting.registerContentScripts 의 world:'MAIN' 은 Safari 16.4 부터 정식
//   지원이고, 지원하지 않으면 **예외가 난다.** 조용히 틀리는 것보다 시끄럽게
//   실패하는 쪽이 낫다.
//
// persistAcrossSessions 로 브라우저에 영구 등록되므로, 이후에는 서비스 워커가
// 깨어 있는지와 무관하게 document_start 에 주입된다.
//
// 등록이 실패하면 isolated/injectMain.ts 가 <script src> 폴백으로 주워담는다.

const SCRIPT_ID = 'oc-ad-bye-pass-main'
const MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']

export async function ensureMainWorldScript(): Promise<void> {
  // 빌드 상수다 (shared/target.ts 참조). Chrome 빌드에서는 이 아래가 전부 사라진다.
  if (!__IS_SAFARI__) return

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    if (existing.length > 0) return

    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: MATCHES,
        js: ['main.js'],
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ])
  } catch (e) {
    // 폴백이 있으므로 치명적이지 않다. 다만 이 경고가 보이면 1계층이 폴백 경로로
    // 돌고 있다는 뜻이고, 폴백은 첫 재생 광고를 놓칠 수 있다.
    console.warn('[oc-ad-bye-pass] MAIN world 등록 실패 — 주입 폴백으로 동작합니다', e)
  }
}
