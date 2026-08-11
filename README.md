# OC Ad Bye-Pass

유튜브에서만 동작하는 광고 차단 확장 (Manifest V3). **Chrome 과 Safari(iOS 포함)를
같은 소스로 빌드한다.**

**유튜브 계열 호스트 밖에서는 스크립트가 단 한 줄도 실행되지 않는다.** 범용 광고
차단기를 깔았을 때처럼 이 사이트 저 사이트가 깨지는 일이 없다.

```
                    유튜브 응답이 오는 길
  ─────────────────────────────────────────────────────────
  1계층  응답 프루닝    광고가 로드되지 않게 만든다      ← 여기서 대부분 끝
  2계층  컴포넌트 필터  광고 렌더러를 그리지 않는다
  3계층  플레이어 폴백  그래도 뜬 광고를 건너뛴다
```

## 설치

### Chrome

Chrome 웹스토어에는 올리지 않는다 (유튜브 전용 차단기는 심사 리스크가 크고, Chrome 은
스토어 밖 `.crx` 설치를 막아뒀다). 압축해제 로드로 쓴다.

1. [Releases](../../releases) 에서 zip 을 받아 압축을 푼다
2. `chrome://extensions` 를 연다
3. 우측 상단 **개발자 모드**를 켠다
4. **압축해제된 확장 프로그램을 로드** → 압축 푼 폴더 선택

### Safari (macOS · iOS)

Safari 확장은 **앱으로 감싸야** 배포된다. 아래 "Safari / iOS" 절 참조.

업데이트는 두 갈래다.

| 바뀐 것 | 할 일 |
|---|---|
| 차단 규칙 (셀렉터·프루닝 경로) | **없음.** 확장이 6시간마다 알아서 받아간다 |
| 확장 코드 | 새 zip 을 덮어쓰고 `chrome://extensions` 에서 새로고침 |

## 어떻게 막는가

Android 의 [ReVanced](https://github.com/ReVanced/revanced-patches) 와
[AdGuard](https://github.com/AdguardTeam/AdguardFilters) 가 쓰는 방식을 웹으로 옮겼다.

### 1계층 — 응답 프루닝 (`src/main/`)

ReVanced 의 `video-ads` 패치는 `PlayerResponseModel` 에서 광고 필드를 없애서 광고를
"숨기는" 게 아니라 **애초에 만들어지지 않게** 한다. AdGuard 의 `json-prune` 스크립틀릿도
같은 자리를 노린다. 여기서도 똑같이 한다.

MAIN world 콘텐츠 스크립트가 `document_start` 에 다음 필드를 응답에서 지운다.

```
adPlacements  playerAds  adSlots  adBreakHeartbeatParams
playerConfig.adConfig    auxiliaryUi.messageRenderers.upsellDialogRenderer
```

후킹 지점은 셋뿐이다. 건드리는 네이티브가 많을수록 유튜브가 깨질 확률이 올라간다.

- `JSON.parse` — 유튜브가 응답을 파싱하는 거의 모든 경로가 여기를 지난다
- `Response.prototype.json` — 이것만 `JSON.parse` 를 거치지 않고 내부에서 파싱한다
- `ytInitialPlayerResponse` / `ytInitialData` setter — 인라인 스크립트의 객체 리터럴이라
  파싱 훅에 안 걸린다. **첫 재생 광고를 막는 데 이 훅이 결정적이다**

`fetch` 와 `XMLHttpRequest` 자체는 감싸지 않는다. 위 셋으로 이미 덮이고, 요청 계층까지
건드리면 유튜브의 재시도·스트리밍 로직과 부딪힌다.

`frameworkUpdates` 는 일부러 프루닝하지 않는다 — 광고와 무관한 UI 갱신(구독·재생목록
상태)이 같이 실려 와서 자르면 유튜브가 깨진다.

### 2계층 — 컴포넌트 필터 (`src/isolated/cosmetic.ts`)

ReVanced 의 `LithoFilterPatch` + `AdsFilter` 는 렌더 트리에서 광고 컴포넌트를 문자열
매칭으로 걸러낸다. 웹에서는 `document_start` 에 스타일시트를 한 장 넣는 것으로 같은
효과를 낸다 (광고가 그려졌다 사라지는 깜빡임이 없다).

ReVanced 의 litho buffer string 을 웹 렌더러 태그로 옮긴 대응표:

| ReVanced | 웹 |
|---|---|
| `carousel_ad`, `video_display_full_layout` | `ytd-carousel-ad-renderer`, `ytd-display-ad-renderer` |
| `ads_video_with_context`, `_ad_with` | `ytd-promoted-video-renderer`, `ytd-in-feed-ad-layout-renderer` |
| `banner_text_icon`, `statement_banner` | `ytd-banner-promo-renderer`, `ytd-statement-banner-renderer` |
| `primetime_promo` | `ytd-primetime-promo-renderer` |
| `brand_video_shelf` | `ytd-brand-video-shelf-renderer` |
| `product_item`, `product_carousel` | `ytd-merch-shelf-renderer`, `ytd-product-details-renderer` |
| `cta_shelf_card` | `.ytp-suggested-action` |
| `ShortsFilter` | `ytd-reel-video-renderer:has(ytd-ad-slot-renderer)` |

광고 카드를 감싼 껍데기는 CSS `:has()` 로 같이 지운다 — 피드에 빈칸이 남지 않는다.
MutationObserver 는 CSS 로 못 하는 것만 맡는다: 오버레이 닫기 버튼 클릭, 애드블록
경고창 정리.

오탐 방지 원칙은 ReVanced 와 같다. 셀렉터는 **태그명 기준으로만** 쓰고 클래스 휴리스틱은
쓰지 않는다. 일반 영상 카드를 건드리면 피드가 통째로 사라진다.

### 3계층 — 플레이어 폴백 (`src/isolated/player.ts`)

1계층이 뚫렸을 때만 발화한다. `#movie_player` 에 `.ad-showing` 이 붙으면 스킵 버튼을
누르고, 건너뛸 수 없는 광고면 음소거 후 끝으로 감는다. 음소거는 **우리가 껐을 때만**
되돌린다 (사용자가 끈 음소거를 켜버리면 안 된다).

## 앱으로 열기 유도 제거 (`appPromo`)

광고는 아니지만 같은 이유로 막는다 — 모바일 웹에서 화면 위쪽을 계속 차지하고,
**확장이 동작하지 않는 앱으로 사용자를 밀어낸다.** 종류가 둘이고 대응이 다르다.

| 무엇 | 누가 그리나 | 어떻게 막나 |
|---|---|---|
| 상단 스마트 앱 배너 | **iOS Safari 가 직접** | `<meta name="apple-itunes-app">` 를 지운다 |
| "앱에서 보기" 배너·토스트, 앱 딥링크 | 유튜브 (평범한 DOM) | 스타일시트 (`appPromo` 그룹) |

첫 줄이 함정이다. 스마트 앱 배너는 페이지가 아니라 **브라우저가** 그리므로 CSS 로는
절대 안 없어진다. meta 태그를 파서보다 먼저 지우는 수밖에 없고, 그래서
`src/isolated/appbanner.ts` 만 rAF 스로틀을 타지 않고 **동기적으로** 지운다
(스로틀을 태우면 배너가 한 번 번쩍이고 사라진다). 비용은 `head` 의 childList 감시
하나뿐이다 — `meta`/`link` 는 `head` 의 직계 자식이라 subtree 가 필요 없다.

설정을 기다리지 않고 먼저 지운다. storage 왕복 수백 ms 를 기다리면 이미 늦다.
스타일시트와 같은 원칙이다 — 꺼둔 사람이 잠깐 덜 보는 쪽이 켠 사람이 보는 것보다 낫다.

`appPromo` 그룹의 렌더러 태그는 **실기기 확인 전이다.** 유튜브 모바일 웹은 실험군에
따라 태그가 갈린다. 안 막히는 게 있으면 아래 "필터 리스트" 절의 순서대로 추가하면
재설치 없이 반영된다.

## Safari / iOS

같은 소스에서 두 벌을 뽑는다. 갈리는 것은 셋뿐이고 전부 `scripts/targets.mjs` 에 모여 있다.

```bash
npm run build          # → dist/         (Chrome)
npm run build:safari   # → dist-safari/  (Safari)
npm run build:all
```

### MAIN world 를 어떻게 넣나 — 유일한 진짜 차이

1계층은 **페이지 컨텍스트(MAIN world)**에서 유튜브보다 먼저 돌아야 한다. Chrome 은
매니페스트의 `"world": "MAIN"` 이 이걸 보장한다. Safari 는 다르다.

> Safari 는 `scripting.registerContentScripts` 의 `world:'MAIN'` 은 16.4 부터 지원하지만,
> **정적 `content_scripts` 의 `world` 필드는 버전에 따라 조용히 무시한다.**

무시되면 `main.js` 가 ISOLATED 로 실행된다. 이건 "안 도는 것"보다 나쁘다 — 훅이 페이지에
안 걸린 채로 아무 오류 없이 성공한 척한다. 그래서 Safari 빌드에서는 **매니페스트에서 MAIN
항목을 아예 뺀다** (`scripts/manifest.mjs`). 대신 두 경로를 둔다.

| | 무엇 | 언제 |
|---|---|---|
| 정상 | `background/mainWorld.ts` 가 `registerContentScripts` 로 등록 | 항상 먼저 시도. 지원 안 하면 **예외가 난다** — 조용히 틀리지 않는다 |
| 폴백 | `isolated/injectMain.ts` 가 `<script src>` 로 주입 | 위가 실패했을 때 |

폴백은 정상 경로보다 **느리다.** script-inserted 스크립트라 파서를 막지 못해서, 유튜브
인라인 스크립트가 먼저 돌면 `ytInitialPlayerResponse` 를 놓칠 수 있다 — 첫 재생 광고가
샐 수 있다는 뜻이다. 2·3계층은 그대로 동작한다. 콘솔에 `MAIN world 등록 실패` 경고가
보이면 이 경로로 돌고 있는 것이다.

두 경로가 모두 성공해도 훅은 한 번만 걸린다 (`src/main/index.ts` 의 설치 가드).
콘텐츠 스크립트 실행 순서는 보장되지 않으므로 중복 주입은 정상 상황이다.

### 빌드 타깃 분기

브라우저를 런타임에 스니핑하지 않는다. `__IS_SAFARI__` 를 빌드 시점에 리터럴로 치환해서
안 쓰는 쪽 분기를 번들에서 통째로 지운다.

```ts
if (!__IS_SAFARI__) return   // Chrome 빌드에서는 이 아래가 전부 사라진다
```

**이 상수는 분기에 직접 써야 한다.** `export const IS_SAFARI = __IS_SAFARI__` 로 감싸
import 하면 esbuild 가 모듈 경계를 넘어 인라인하지 못해서 Chrome 번들에 Safari 코드가
그대로 남는다 (실제로 그렇게 됐다). 자세한 건 `src/shared/target.ts` 주석에 있다.

확인:

```bash
npm run build:all
grep -c registerContentScripts dist/background.js   # 0 이어야 한다
```

### Xcode 프로젝트 만들기

**macOS + Xcode 가 필요하다.** 맥이 없으면 GitHub Actions 의 `macos-latest` 러너에서
같은 명령을 돌리면 된다.

```bash
npm run safari:xcode
```

`xcrun safari-web-extension-converter` 가 `dist-safari/` 를 읽어 `safari/` 에 Xcode
프로젝트를 만든다. 이후 서명·설치는 Xcode 쪽 얘기다.

### 알려진 제약

- **`options_page` 는 iOS 에서 열 통로가 없다.** 데스크톱 Safari 는 열리지만 iOS 는
  확장 아이콘 → 팝업뿐이다. 옵션에만 있는 설정은 iOS 에서 손댈 수 없다.
- `optional_host_permissions` 는 Safari 가 인식하지 못해 Safari 빌드에서 뺐다.
- Safari 16.4 미만은 MV3 서비스 워커가 없어 대상이 아니다.
- E2E 는 Chromium 만 돈다. Safari 경로는 실기기 확인이 필요하다.

## 필터 리스트 — 규칙만 따로 업데이트

유튜브가 렌더러 태그를 바꿔도 재설치가 필요 없도록, 차단 규칙을 코드에서 분리해
[`filters/youtube.json`](filters/youtube.json) 에 둔다. uBlock Origin / AdGuard 의 필터
리스트 구독과 같은 모델이다.

**광고가 하나 안 막히면 이렇게 고친다.**

1. 개발자도구로 광고 요소를 찍어 셀렉터를 얻는다
2. 확장 옵션의 **내 규칙**에 붙여넣어 바로 확인한다
3. 잘 되면 `filters/youtube.json` 의 해당 그룹에 추가하고 **`version` 을 올려서** push
4. 몇 시간 안에 이 확장을 쓰는 모두에게 반영된다

`version` 을 안 올리면 확장이 거부한다 (롤백 방지). 번들 기본 규칙
(`src/shared/selectors.ts`) 과는 **합집합**으로 병합되므로, JSON 에서 지워도 번들에
있으면 계속 동작한다. 정말 끄고 싶으면 `allow` 에 넣는다.

### 원격에서 오는 건 데이터뿐이다

MV3 는 원격 코드 실행을 금지하고, 보안상으로도 리스트 저장소가 털리면 유튜브 세션에
임의 코드가 도는 셈이 된다. 그래서 받아오는 건 셀렉터·경로 같은 **데이터뿐**이고,
저장 전에 전부 검사한다.

- `{` `}` `@` `<` `;` 주석 등 스타일시트를 탈출할 수 있는 문자 → 거부
- 실제로 파싱되는 셀렉터만 통과
- 프루닝 경로는 점으로 이은 식별자만 (`__proto__` / `constructor` / `prototype` 거부)
- 리스트 256KB, 그룹당 셀렉터 2000개, 총 8000개 상한
- 받아오기 실패나 검증 실패 시 **기존 규칙을 그대로 유지**한다

검사기는 `src/shared/filterlist.ts` 에 순수 함수로 있고 `tests/` 가 이 규칙들을 지킨다.

## 권한

| 권한 | 왜 |
|---|---|
| `storage` | 설정·규칙 캐시 |
| `alarms` | 6시간마다 리스트 갱신 |
| `activeTab` | 팝업에서 "지금 탭이 유튜브인가" 한 줄 판단. 설치 경고가 늘지 않는다 |
| `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*` | 콘텐츠 스크립트 주입 대상 |
| `https://raw.githubusercontent.com/*` | 필터 리스트 받기 (백그라운드 전용, 스크립트 주입 안 함) |

`declarativeNetRequest` 는 쓰지 않는다. 유튜브 광고는 doubleclick 이 아니라 1st-party
InnerTube 응답으로 오기 때문에 1·2계층으로 이미 잡히고, 전역 권한 경고만 늘어난다.

`*.youtube.com` 에는 `www` / `m` / `music` 이 전부 포함되고,
`youtube-nocookie.com` 은 다른 사이트에 박힌 임베드 영상용이다.

## 개발

```bash
npm install
npm run dev           # vite(팝업/옵션) + esbuild(콘텐츠/백그라운드) watch → dist/
npm run dev:safari    # 같은 것을 dist-safari/ 로
npm run build         # 프로덕션 빌드 (Chrome)
npm run build:safari  # 프로덕션 빌드 (Safari)
npm run build:all     # 둘 다
npm run check         # tsc --noEmit
npm test              # 검증기·프루너 단위 테스트
npm run test:e2e      # 실제 Chromium 에 확장을 물려 광고 차단 검증
npm run test:all      # 위 셋 전부
npm run zip           # dist/ 를 zip 으로
npm run safari:xcode  # dist-safari/ → Xcode 프로젝트 (macOS 필요)
```

`chrome://extensions` 에서 `dist/` 를 한 번만 로드해 두면 `npm run dev` 로 계속 고칠 수 있다
(콘텐츠 스크립트를 고치면 확장 새로고침 + 탭 새로고침이 필요하다).

### 빌드가 둘로 나뉜 이유

`@crxjs/vite-plugin` 같은 도구는 콘텐츠 스크립트를 ESM 로더로 감싸 **비동기로** 실행한다.
1계층은 유튜브 스크립트보다 **먼저 동기적으로** `JSON.parse` 를 후킹해야 해서 그러면
깨진다. 그래서 팝업/옵션(React)만 vite 가 맡고, 콘텐츠 스크립트와 서비스 워커는
esbuild 가 단일 IIFE 로 뽑는다 (`scripts/build-content.mjs`).

### 구조

```
src/
  main/       ← MAIN world. 1계층. chrome.* 못 씀
  isolated/   ← ISOLATED world. 2·3계층 + 설정 브리지 + 앱 배너 + Safari 주입 폴백
  background/ ← 서비스 워커. 리스트 갱신, 통계/배지, Safari MAIN world 등록
  shared/     ← 설정·셀렉터·필터 리스트 검증·빌드 타깃
  popup/ options/ ui/
scripts/
  targets.mjs    ← 타깃 정의 (출력 경로·다운레벨 타깃). vite/esbuild/manifest 가 전부 읽는다
  manifest.mjs   ← public/manifest.json → 타깃별 manifest. vite 의 closeBundle 에서 불린다
filters/youtube.json   ← 원격 필터 리스트 정본
```

MAIN world 는 `chrome.storage` 를 못 읽어서 설정은 ISOLATED 가 `postMessage` 로 넘긴다.
그 전 수백 ms 동안의 기본값은 "차단"이다 — 확장을 꺼둔 사람이 잠깐 더 차단되는 쪽이
광고가 새는 것보다 낫다.

## 정말 막히는지 어떻게 아나 — Playwright E2E

"코드를 짰다"와 "광고가 막힌다"는 다른 말이다. `e2e/` 는 **빌드된 확장을 실제
Chromium 에 물려서** 광고가 사라지는지 본다 (`npm run test:e2e`).

핵심 트릭은 Playwright 의 route 로 `https://www.youtube.com/**` 를 가로채 유튜브의
*구조*를 그대로 재현한 페이지를 돌려주는 것이다. 문서의 origin 이 진짜
`https://www.youtube.com` 이라 확장의 `content_scripts` 매치가 그대로 걸린다 —
네트워크·로그인·광고 노출 운에 기대지 않으면서, "유튜브에서만 동작한다"는 조건까지
같이 검증된다.

**모든 계층에 대조군이 있다.** 확장 없이 같은 페이지를 열어 광고가 실제로 존재함을
먼저 확인한다. 이게 없으면 "원래 광고가 없어서 통과"하는 헛도는 테스트가 된다.

| 무엇을 | 어떻게 확인하나 |
|---|---|
| 1계층 · 경로 A | 인라인 `var ytInitialPlayerResponse = {...}` 에서 `adPlacements` 가 사라지고 `videoDetails`·`streamingData` 는 남는지 |
| 1계층 · 경로 B | 페이지가 부른 `JSON.parse` 결과에서 광고 필드가 사라지는지 |
| 1계층 · 경로 C | `fetch('/youtubei/v1/player')` → `res.json()` 응답에서 사라지는지 |
| 위장 | `JSON.parse.toString()` 이 `[native code]` 로 보이는지 |
| 2계층 | 광고 렌더러 6종이 안 보이고, **같은 태그를 쓰는 일반 영상 카드는 그대로 보이는지** (오탐 회귀) |
| 2계층 | 나중에 삽입된 광고, 애드블록 경고창 제거 + 재생 재개, 닫기 버튼 자동 클릭 |
| 3계층 | 진짜 미디어를 물려두고 스킵 버튼 클릭 / 음소거 후 끝까지 감기 / **광고가 끝나면 음소거 되돌리기** / 사용자가 끈 음소거는 안 건드리기 |
| 범위 | 유튜브가 아닌 사이트에서는 스크립트·스타일시트가 아예 없고 `JSON.parse` 도 원본인지 |
| 설정 | 토글을 끄면 새로고침 없이 광고가 되살아나는지, 마스터 스위치가 1계층까지 멈추는지 |
| 필터 리스트 | 캐시에 들어온 원격 규칙이 페이지까지 닿는지, 번들 규칙과 합쳐지는지 |
| 안전성 | `body { display: none }` 같은 탈출 시도가 스타일시트에 들어가지 못하는지 |
| **로컬 설치** | `npm run zip` 산출물을 실제로 풀어서 로드했을 때 광고가 막히는지 |
| **원격 갱신** | 옵션 페이지 버튼 클릭 → fetch → 검증 → 캐시 → **열려 있는 탭에 새로고침 없이 반영**까지 |
| **갱신 실패** | 서버가 죽거나, 깨진 JSON 이 오거나, 예전 버전으로 되돌리려 해도 기존 규칙으로 계속 막는지 |
| **자동 갱신** | 6시간 주기 알람이 실제로 등록돼 있는지 |

배포 모델(`e2e/06-install-and-update.spec.ts`)은 별도로 검증한다 — **"설치는 로컬로 한 번,
이후는 버튼이든 자동이든"** 이 성립해야 제품이기 때문이다. 앞 스펙들이 `dist/` 를 직접
물려서 차단 로직만 봤다면, 이쪽은 사용자가 실제로 받는 zip 을 풀어서 설치하고 옵션
페이지 버튼을 진짜로 누른다.

원격 갱신 테스트는 네트워크를 타지 않는다. Playwright 의 route 가 **확장 서비스 워커가
나가는 fetch 까지 가로채기 때문에**, 실제 `updateFilters()` 코드를 그대로 돌리면서
응답만 우리가 정해준다. 그래서 "서버가 500 을 뱉을 때", "JSON 이 깨졌을 때",
"공격자가 예전 버전을 다시 먹일 때" 같은 경우를 결정적으로 재현할 수 있다.

3계층은 스텁을 쓰지 않는다. 콘텐츠 스크립트는 ISOLATED world 라 페이지에서
`HTMLMediaElement.prototype` 을 갈아끼워도 보이지 않기 때문이다. 대신 무음 WAV 를
`data:` URI 로 물려 **진짜 재생 가능한 미디어**를 만들고, 두 월드가 공유하는 실제 DOM
상태(`currentTime` / `muted` / `paused`)로만 판정한다.

`e2e/05-visual.spec.ts` 는 차단 전후 스크린샷을 `e2e/__screenshots__/` 에 남긴다.
CI(`.github/workflows/ci.yml`)와 릴리스 워크플로 양쪽에서 돌아서, **광고가 실제로
막히지 않는 빌드는 릴리스되지 않는다.**

### 진짜 유튜브 스모크 (기본은 건너뜀)

```bash
E2E_LIVE=1 npm run test:e2e
```

픽스처가 절대 못 잡는 것 둘을 실물로 확인한다.

**1. 유튜브가 실제로 내려주는 광고 페이로드가 잘리는가.** 우리가 만든 가짜가 아니라.

여기엔 함정이 있다. 아무 영상이나 열고 `adPlacements` 가 없는 걸 확인하면 **아무것도
증명하지 못한다** — 애초에 광고가 안 붙는 영상이 흔하기 때문이다. 실측하면 이렇다.

```
Big Buck Bunny   adPlacements 없음     ← 광고가 원래 안 붙는다
Me at the zoo    adPlacements 없음
강남스타일        adPlacements 1        ← 진짜 광고
Despacito        adPlacements 1
```

그래서 **확장 없이 먼저 열어 광고가 붙는 것을 확인한 뒤**, 같은 영상을 확장과 함께 연다.
대조군에 광고가 없으면 증명이 성립하지 않으므로 테스트를 fail 이 아니라 skip 한다.

**2. 확장이 유튜브를 깨뜨리지 않는가.** `JSON.parse` 를 후킹하는 확장에서 제일 무서운
실패는 "광고가 안 막힘"이 아니라 "유튜브가 안 열림"이고, 그건 진짜 유튜브에서만
드러난다. 플레이어가 뜨는지, `videoDetails`·`streamingData` 가 살아 있는지, 페이지
오류가 0건인지를 본다.

기본으로 안 도는 이유는 네트워크·지역·로그인 상태·그날의 실험군에 따라 광고 노출이
달라져서다. 그래서 차단 로직의 상시 판정은 대조군이 있는 픽스처 테스트가 맡고,
여기는 "진짜에서도 되더라"를 확인하는 자리다.

## 라이선스와 출처

**GPLv3** ([LICENSE](LICENSE)).

이 바닥이 거의 다 GPLv3 라서 맞췄다 — uBlock Origin, AdGuard, ReVanced 전부 GPLv3 다.
같은 라이선스면 저쪽에서 코드든 필터 규칙이든 가져올 때 라이선스 문제가 생기지 않는다.
MIT 로 갔다가 GPL 프로젝트의 규칙을 복사해 오면 그 순간 위반이 된다.

### 무엇을 참조했나

지금까지 **코드를 복사한 곳은 없다.** 기법과 구조를 참조했고, 그건 저작권 대상이 아니다.
다만 어디서 왔는지는 밝혀두는 게 맞다.

| 출처 | 참조한 것 |
|---|---|
| [ReVanced Patches](https://github.com/ReVanced/revanced-patches) (GPLv3) | `video-ads` 가 PlayerResponse 에서 광고를 없애는 접근. `AdsFilter`/`ShortsFilter` 의 litho buffer string 을 읽고 웹 렌더러 태그로 옮긴 것이 2계층 셀렉터의 출발점이다 (대응표는 위 "2계층" 절) |
| [AdGuard](https://github.com/AdguardTeam/AdguardFilters) (GPLv3) | `json-prune` 스크립틀릿이 잘라내는 필드 목록, 코스메틱 규칙을 해당 호스트에만 적용하는 원칙 |
| SmartTube | 별도 클라이언트라서 인페이지 차단기처럼 깨지지 않는다는 구조적 교훈. 사이드로드 배포 모델도 여기와 같다 |

### 앞으로 규칙을 가져올 때

안 막히는 광고를 [uAssets](https://github.com/uBlockOrigin/uAssets) 나
[AdguardFilters](https://github.com/AdguardTeam/AdguardFilters) 에서 퍼오는 일이 생길 텐데,
**셀렉터 목록은 편집저작물로 보호될 수 있다.** 둘 다 GPLv3 이고 이 프로젝트도 GPLv3 이라
가져오는 것 자체는 문제없지만, 어디서 가져왔는지 `filters/youtube.json` 의 해당 항목에
주석으로 남긴다.

## 한계

- **서버가 스트림에 광고를 이어붙이는 경우**(server-side stitching)는 응답 프루닝으로
  막을 수 없다. 3계층이 건너뛰지만 완벽하지는 않다.
- 유튜브는 차단을 계속 바꾼다. 안 막히는 게 생기면 위 "필터 리스트" 절의 순서대로 규칙을 더한다.
- 자동 업데이트가 없다 (스토어 밖 확장의 한계). 코드가 바뀌면 zip 을 다시 받아야 한다.
