// 빌드 타깃 정의. vite / esbuild / manifest 생성기가 전부 이 파일을 읽는다.
//
// 소스는 하나다. 브라우저별로 갈리는 것은 셋뿐이고 전부 여기 모여 있다.
//   1. 출력 디렉터리        — dist / dist-safari
//   2. 다운레벨 타깃         — Safari 는 :has() 와 MV3 서비스 워커가 16.4 부터다
//   3. MAIN world 주입 방식  — manifest.mjs 주석 참조
//
// 새 타깃(firefox 등)을 더할 때도 여기에 한 줄 더하는 것으로 끝나야 한다.

export const TARGETS = {
  chrome: {
    outDir: 'dist',
    // esbuild 다운레벨 타깃. manifest 의 minimum_chrome_version 과 맞춘다.
    esbuildTarget: 'chrome120',
  },
  safari: {
    outDir: 'dist-safari',
    // Safari 16.4 = MV3 서비스 워커 + scripting.registerContentScripts 의 world:'MAIN'
    // 이 둘이 동시에 들어온 버전. iOS 16.4 이상이 대상이 된다.
    esbuildTarget: 'safari16.4',
  },
}

export const DEFAULT_TARGET = 'chrome'

/** TARGET 환경변수를 읽어 타깃 설정을 돌려준다. */
export function resolveTarget() {
  const name = process.env.TARGET ?? DEFAULT_TARGET
  const config = TARGETS[name]
  if (!config) {
    const known = Object.keys(TARGETS).join(', ')
    throw new Error(`알 수 없는 TARGET "${name}" — 가능한 값: ${known}`)
  }
  return { name, ...config }
}
