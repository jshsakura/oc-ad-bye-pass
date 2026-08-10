# OC Ad Bye-Pass

유튜브에서만 동작하는 Chrome 광고 차단 확장 (Manifest V3).

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

Chrome 웹스토어에는 올리지 않는다 (유튜브 전용 차단기는 심사 리스크가 크고, Chrome 은
스토어 밖 `.crx` 설치를 막아뒀다). 압축해제 로드로 쓴다.

1. [Releases](../../releases) 에서 zip 을 받아 압축을 푼다
2. `chrome://extensions` 를 연다
3. 우측 상단 **개발자 모드**를 켠다
4. **압축해제된 확장 프로그램을 로드** → 압축 푼 폴더 선택

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
npm run dev       # vite(팝업/옵션) + esbuild(콘텐츠/백그라운드) watch → dist/
npm run build     # 프로덕션 빌드
npm run check     # tsc --noEmit
npm test          # 검증기·프루너 단위 테스트
npm run test:e2e  # 실제 Chromium 에 확장을 물려 광고 차단 검증
npm run test:all  # 위 셋 전부
npm run zip       # dist/ 를 zip 으로
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
  isolated/   ← ISOLATED world. 2·3계층 + 설정 브리지
  background/ ← 서비스 워커. 리스트 갱신, 통계/배지
  shared/     ← 설정·셀렉터·필터 리스트 검증
  popup/ options/ ui/
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

픽스처가 절대 못 잡는 것 하나를 실물로 확인한다 — **확장이 유튜브를 깨뜨리지 않는가.**
`JSON.parse` 를 후킹하는 확장에서 제일 무서운 실패는 "광고가 안 막힘"이 아니라
"유튜브가 안 열림"이고, 그건 진짜 유튜브에서만 드러난다. 플레이어가 뜨는지,
`videoDetails`·`streamingData` 가 살아 있는지, 페이지 오류가 0건인지를 본다.

기본으로 안 도는 이유는 네트워크·지역·로그인 상태·그날의 실험군에 따라 결과가 바뀌고,
"광고가 안 떴다"가 차단 덕분인지 원래 안 붙은 건지 구분할 수 없기 때문이다.
차단 여부의 판정은 대조군이 있는 픽스처 테스트가 맡는다.

## 한계

- **서버가 스트림에 광고를 이어붙이는 경우**(server-side stitching)는 응답 프루닝으로
  막을 수 없다. 3계층이 건너뛰지만 완벽하지는 않다.
- 유튜브는 차단을 계속 바꾼다. 안 막히는 게 생기면 위 "필터 리스트" 절의 순서대로 규칙을 더한다.
- 자동 업데이트가 없다 (스토어 밖 확장의 한계). 코드가 바뀌면 zip 을 다시 받아야 한다.
