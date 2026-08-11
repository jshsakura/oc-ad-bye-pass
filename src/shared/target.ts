// 빌드 타깃. 브라우저별로 갈리는 유일한 지점이다.
//
// 값은 빌드 시점에 리터럴로 치환된다 (scripts/build-content.mjs 의 define).
// 그래서 `if (!__IS_SAFARI__) return` 은 Chrome 빌드에서 `return` 이 되고,
// 뒤따르는 코드가 도달 불가가 되어 번들에서 통째로 사라진다.
//
// **분기에는 이 파일이 export 하는 상수 대신 `__IS_SAFARI__` 전역을 직접 쓴다.**
// 처음에 `export const IS_SAFARI = __IS_SAFARI__` 를 만들어 import 해 썼더니
// esbuild 가 모듈 경계를 넘어 인라인하지 못해서, Chrome 번들에 Safari 전용 코드
// (registerContentScripts, main.js 주입)가 그대로 남았다. 죽은 코드라 동작에는
// 문제가 없었지만 번들에 남을 이유가 없다.
//
// 이 파일이 하는 일은 그 전역의 타입을 tsc 에게 알려주는 것뿐이다. import 하지
// 않아도 src/ 전체에 적용되는 ambient 선언이다.
//
// 브라우저를 런타임에 스니핑하지 않는 이유: 같은 WebKit 이라도 iOS 크롬은 확장을
// 못 돌리고, 무엇보다 "어느 스토어용 빌드인가"는 사용자 에이전트가 아니라 우리가
// 정하는 값이기 때문이다.

export type BuildTarget = 'chrome' | 'safari'

declare global {
  /** 'chrome' | 'safari' — 빌드 시점에 문자열 리터럴로 치환된다 */
  const __TARGET__: BuildTarget
  /** __TARGET__ === 'safari' 를 빌드 스크립트가 미리 계산해 넣은 값 */
  const __IS_SAFARI__: boolean
}
