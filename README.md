# OC Ad Bye-Pass

### → **[설치 안내 · 다운로드 (jshsakura.github.io/oc-ad-bye-pass)](https://jshsakura.github.io/oc-ad-bye-pass/)**

광고 차단 확장 (Manifest V3). **Chrome · Edge 와 Orion(아이폰 포함)이 같은 zip 하나를 쓴다.**

유튜브를 특별히 잘 막는다. 범용 차단기들이 유튜브에서 고전하는 이유는 유튜브 광고가
광고망이 아니라 **본문과 같은 응답에 실려 오기 때문**인데, 여기서는 그 응답을 직접
자른다. 그래서 계층이 나뉜다.

```
  모든 사이트
  ─────────────────────────────────────────────────────────
  0계층  네트워크 차단   광고망 요청 자체를 막는다 (166,682 도메인)
  2계층  범용 코스메틱   남은 광고 자리를 숨긴다

  유튜브에서 추가로
  ─────────────────────────────────────────────────────────
  1계층  응답 프루닝     광고가 로드되지 않게 만든다   ← 여기서 대부분 끝
  2계층  컴포넌트 필터   광고 렌더러를 그리지 않는다
  3계층  플레이어 폴백   그래도 뜬 광고를 건너뛴다
```

**어느 사이트든 한 번의 클릭으로 끌 수 있다.** 확장 아이콘 → 그 사이트 스위치. 전역으로
동작하는 이상 무엇이든 깨뜨릴 수 있고, 그때 확장을 통째로 지우는 것 말고 다른 선택지가
없으면 사람들은 통째로 지운다. 하위 도메인까지 함께 꺼지고, 끄면 네트워크 차단과 요소
숨김이 **둘 다** 멈춘다.

## 설치

### Chrome

압축해제 로드로 쓴다.

**압축 풀기까지는 명령어 한 줄로 끝난다.** 최신 zip 을 받아 고정된 위치에 풀고,
크롬에 붙여넣을 경로를 찍어준다 (윈도우는 탐색기로 열고 클립보드에도 복사한다).

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/scripts/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/scripts/install.sh | bash
```

그다음은 크롬에서 직접 해야 한다. **이 4단계는 자동화할 방법이 없다** — 크롬은 웹에서
`chrome://extensions` 로 이동하는 것도, 개발자 모드를 켜는 것도 막아뒀다.

1. 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → 위에서 찍어준 폴더 선택

명령어를 쓰기 싫으면 [사이트](https://jshsakura.github.io/oc-ad-bye-pass/)나
[Releases](../../releases) 에서 zip 을 받아 직접 풀어도 된다. 단 **푼 폴더를 지우면
확장이 죽는다** — 크롬이 그 폴더를 계속 참조한다. 다운로드 폴더에 풀지 말 것.

설치 스크립트가 고정 위치를 쓰는 이유가 이것이다.

| OS | 설치 위치 |
|---|---|
| Windows | `%LOCALAPPDATA%\OcAdByePass` |
| macOS | `~/Library/Application Support/OcAdByePass` |
| Linux | `~/.local/share/oc-ad-bye-pass` |

코드가 바뀌었을 때는 **같은 명령을 다시 돌리고** `chrome://extensions` 에서 새로고침만
누르면 된다. 경로가 그대로라 다시 로드할 필요가 없다.

### 아이폰 · 아이패드 (Orion)

**아이폰에서 확장이 되는 브라우저는 Safari 와 [Orion](https://browser.kagi.com/) 둘뿐이고,
Orion 은 크롬 확장을 zip 그대로 받는다.** Safari 처럼 앱으로 감쌀 필요도, 7일마다
다시 서명할 일도 없다.

1. App Store 에서 **Orion Browser by Kagi** 설치
2. [Releases](../../releases/latest) 에서 **`oc-ad-bye-pass-orion.zip`** 을 받는다 (Chrome 용과 다른 파일이다)
3. Orion 우측 하단 **•••** → **Extensions** → **+** → 받은 zip 선택
4. `youtube.com` 권한 허용

**Orion 은 Chrome 패키지를 설치조차 거절한다.** 실기기에서 확인했다 —
"Extensions Error. Something went wrong." 한 줄이 전부고 이유는 안 알려준다.
Orion 빌드는 그것이 받지 못하는 것을 뺀 패키지다 (3.9MB → 276KB). 자세한 건 아래
"Orion 에서 달라지는 것" 절에 있다.

업데이트는 두 갈래다.

| 바뀐 것 | 할 일 |
|---|---|
| 차단 규칙 (셀렉터·프루닝 경로) | **없음.** 유튜브 탭을 열 때 확장이 알아서 확인한다 |
| 확장 코드 | 새 zip 을 덮어쓰고 `chrome://extensions` 에서 새로고침 |

## 어떻게 막는가

Android 의 [ReVanced](https://github.com/ReVanced/revanced-patches) 와
[AdGuard](https://github.com/AdguardTeam/AdguardFilters) 가 쓰는 방식을 웹으로 옮겼다.

### 0계층 — 네트워크 차단 (모든 사이트)

`declarativeNetRequest` 정적 룰셋으로 광고망 요청 자체를 막는다. 요청이 안 나가므로
광고가 그려질 일도 없고, 대역폭도 안 쓴다. **호스트 권한이 필요 없다** — 정적 룰셋은
권한 경고를 늘리지 않는다.

규칙은 공개 리스트(AdGuard DNS filter, EasyList, EasyPrivacy)에서 `scripts/build-rules.mjs`
가 만든다. 여기서 전처리가 전부다.

| 단계 | 하는 일 |
|---|---|
| 파싱 | ABP 문법 중 **도메인 차단만** 정확히 옮긴다. 못 옮긴 규칙은 몇 개를 왜 버렸는지 보고한다 |
| 보호 | `NEVER_BLOCK` — 한 줄만 잘못 들어와도 로그인·결제가 막힌다. 그건 "광고가 샜다"와 차원이 다르다 |
| 고정 | 없으면 의미가 없는 광고망 40여 개는 목록에 없어도 **강제로 넣는다** |
| 서브섬션 | `\|\|example.com^` 은 서브도메인까지 매칭한다 → 부모가 이미 차단된 도메인은 지운다 |
| 배치 | 도메인 하나당 룰 하나는 낭비다. `requestDomains` 배열로 1000개씩 묶는다 |

마지막 두 줄이 결정적이다. 도메인 하나당 룰 하나로 하면 30,000개 한도에 걸려
**166,682개 중 136,000개가 잘려나간다.** 그것도 알파벳순으로 — `0.avmarket.rs` 는 넣고
`doubleclick.net` 은 버리는 식이라, 3만 개의 보호처럼 보이지만 아무것도 아니다.
배치로 묶으면 **전부 들어가고 룰은 168개**로 끝난다.

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

## MAIN world 에 어떻게 들어가나

1계층은 **페이지 컨텍스트(MAIN world)**에서 유튜브보다 먼저 돌아야 한다. 들어가는 길이
둘이고, 둘 다 남겨둔 데에는 각각 이유가 있다.

| | 무엇 | 왜 |
|---|---|---|
| 빠른 길 | 매니페스트의 `"world": "MAIN"` 정적 선언 | Chrome 은 이걸 지킨다. 파서가 유튜브 첫 인라인 스크립트에 닿기 전에 이미 들어가 있다 |
| 덮는 길 | `background/mainWorld.ts` 의 `registerContentScripts` | **WebKit 계열은 정적 `world` 를 버전에 따라 조용히 무시한다.** Orion 이 그렇다 |
| 최후 | `isolated/injectMain.ts` 의 `<script src>` 주입 | 등록마저 실패했을 때 |

무시되면 `main.js` 가 ISOLATED 로 실행된다. 이건 "안 도는 것"보다 나쁘다 — 훅이 페이지에
안 걸린 채로 아무 오류 없이 성공한 척한다. 그래서 Orion 을 위해 **등록 경로가 항상 돈다.**

정적 선언만 지우고 등록에만 맡겨보는 것도 해봤는데 더 나빴다. script-inserted 스크립트는
파서를 못 막아서, 1계층이 유튜브 인라인 스크립트에 밀려 E2E 세 개가 깨졌다. 그래서 둘 다
남긴다. 겹쳐서 두 번 들어와도 훅은 한 번만 걸린다 (`src/main/index.ts` 의 설치 가드).

주입 폴백은 등록보다 **느리다.** 콘솔에 `MAIN world 등록 실패` 경고가 보이면 그 길로
돌고 있는 것이고, 첫 재생 광고가 샐 수 있다. 2·3계층은 그대로 동작한다.

### 조용히 무너지는 것을 막는다

위 셋 중 무엇이 빠져도 **확장은 멀쩡해 보인다.** 그래서 검사가 따로 있다.

```bash
npm run build && npm run verify
```

정적 선언, 번들 안의 등록 코드와 주입 폴백, `web_accessible_resources` 의 `main.js`,
`scripting` 권한, DNR 키 — 다섯 가지를 못 박는다 (`scripts/verify-build.mjs`).
E2E `07-mainworld-paths` 는 한 걸음 더 간다: `dist/` 에서 정적 MAIN 선언만 뜯어낸
사본을 실제 크로미움에 물려서, 등록 경로와 주입 폴백이 **정말로** 1계층을 살리는지 본다.

### Safari 는 안 한다

한때 `dist-safari/` 를 따로 뽑고, Xcode 로 앱을 감싸고, 서명한 IPA 를 홈서버에서
`itms-services://` 로 내려주는 경로가 있었다. **2026-08-11 에 통째로 지웠다** — Orion 이
크롬 확장 zip 을 그대로, 아이폰에서도 받기 때문이다. 앱도 서명도 서버도 필요가 없다.

지운 것: `TARGET=safari` 빌드, `scripts/manifest.mjs` 의 매니페스트 변환,
`__IS_SAFARI__` 빌드 상수, `safari.yml`, `ota-manifest.mjs`, `altstore-source.mjs`,
그리고 그 파일들을 내려주던 nginx 스택과 터널 ingress.

**남긴 것은 런타임 경로다.** 등록과 주입은 원래 Safari 때문에 만들었지만 지금은 Orion 을
살리는 코드이고, 위 E2E 가 그대로 지킨다. 다시 필요해지면 `scripts/targets.mjs` 에
타깃을 하나 더 적는 데서 시작한다.

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
| `declarativeNetRequest` | 광고망 요청 차단. **정적 룰셋은 호스트 권한이 필요 없다** |
| `activeTab` | 팝업에서 "지금 이 사이트가 어디인가" 판단. 설치 경고가 늘지 않는다 |
| `http://*/*`, `https://*/*` | 코스메틱 필터용 콘텐츠 스크립트. **이것이 설치 경고를 만든다** |
| `*://*.youtube.com/*` (MAIN world) | 1계층 훅. 유튜브 밖으로 나가지 않는다 |
| `https://raw.githubusercontent.com/*` | 필터 리스트 받기 (백그라운드 전용, 스크립트 주입 안 함) |

### 설치 경고에 대해

전역 코스메틱 필터 때문에 **"방문하는 모든 웹사이트의 데이터 읽기 및 변경"** 경고가 뜬다.
크롬에 "CSS 만 넣는 권한"이 없어서다 — 요소를 숨기려면 페이지 안에서 코드가 돌아야 하고,
코드가 도는 순간 기술적으로는 모든 것에 접근할 수 있다. 브라우저는 그 둘을 구분하지 못한다.

그래서 **범위를 좁히는 쪽으로 설계했다.**

- 1계층(`JSON.parse` 후킹)은 **유튜브 밖으로 나가지 않는다.** 은행 사이트에서 `JSON.parse`
  를 후킹할 이유가 없다.
- 유튜브 밖에서는 범용 셀렉터 그룹 하나만 내보낸다. `ytd-*` 는 애초에 매칭될 리 없지만,
  안 내보내면 **모든 페이지에서** 스타일시트가 작아진다.
- 유튜브 밖에서는 MutationObserver 도 인터벌도 돌지 않는다. 다른 사이트에서 이 확장의
  비용은 **스타일시트 한 장이 전부고 반복 작업은 없다.**
- 그리고 사이트별로 끌 수 있다.

`*.youtube.com` 에는 `www` / `m` / `music` 이 전부 포함되고,
`youtube-nocookie.com` 은 다른 사이트에 박힌 임베드 영상용이다.

## 개발

```bash
npm install
npm run dev        # vite(팝업/옵션) + esbuild(콘텐츠/백그라운드) watch → dist/
npm run build      # 프로덕션 빌드 → dist/
npm run build:orion # Orion 패키지 → dist-orion/
npm run build:all  # 둘 다
npm run verify     # 빌드 불변식 검사 (조용히 죽는 것들)
npm run check      # tsc --noEmit
npm test           # 검증기·프루너 단위 테스트
npm run test:e2e   # 실제 Chromium 에 확장을 물려 광고 차단 검증
npm run test:all   # check → 단위 → 빌드 → verify → E2E
npm run zip        # dist/ 를 zip 으로 (verify 통과분만)
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
  isolated/   ← ISOLATED world. 2·3계층 + 설정 브리지 + 앱 배너 + MAIN 주입 폴백
  background/ ← 서비스 워커. 리스트 갱신, 통계/배지, MAIN world 런타임 등록
  shared/     ← 설정·셀렉터·필터 리스트 검증
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
| **자동 갱신** | 유튜브 탭을 열면 낡은 규칙을 받아오는지, ETag 로 304 를 받는지 |

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

## Orion 브라우저

[Orion](https://browser.kagi.com/) 은 WebKit 기반인데 **Chrome · Firefox · Safari 확장을
전부 받는다.** 그리고 Chrome 웹스토어에서 원클릭 설치가 되고 자동 업데이트를 지원한다 —
Chrome 과 Orion 을 하나의 확장으로 덮을 수 있다는 뜻이다.

문제는 Orion 이 WebExtensions API 를 **약 70%만** 구현했다는 것이다. 안 되는 API 를 쓰면
**오류 없이 조용히 기능만 죽는다.** Chrome 에서는 멀쩡히 도니까 눈치채기가 어렵다.

그래서 Kagi 가 공개하는 지원 표에 우리가 호출하는 API 를 전부 대조한다
(`npm run check:orion`, CI 에서도 돈다).

```
scripting.registerContentScripts   Full support   ← 1계층이 Orion 에서 사는 근거
storage.local · alarms · action · permissions · runtime · tabs   Full support
storage.sync                       Partial support ← 유일한 구멍
```

`registerContentScripts` 가 되는 게 결정적이다. WebKit 계열은 정적 `content_scripts` 의
`world` 를 못 믿는데, **런타임 등록 경로가 그 구멍을 덮는다** — 크롬 빌드에서도 항상
돌기 때문에 Orion 을 위해 따로 만들 게 없다.

`storage.sync` 만 Partial 이라 설정을 sync/local **양쪽에** 쓰고 읽을 때 sync 를 우선한다
(`src/shared/settings.ts`). sync 에만 쓰면 조용히 저장이 안 돼서 사용자 눈에는 설정이
매번 초기화되는 것처럼 보인다.

지원 표를 못 받으면(네트워크·시트 이동) 검사는 실패가 아니라 건너뛴다 — 남의 인프라에
우리 CI 를 묶어두지 않는다.

## 배포 — 릴리스가 정본이다

**사람들이 받는 것은 GitHub 릴리스에 붙은 zip 하나뿐이다.** 서버도, 손으로 돌리는
배포 스크립트도 없다.

```
git tag v0.2.0 && git push --tags
   → release.yml   check · 단위 · E2E 를 통과한 것만 빌드해서 릴리스에 첨부
       oc-ad-bye-pass.zip         Chrome · Edge
       oc-ad-bye-pass-orion.zip   Orion (아이폰 포함). DNR 을 뺀 276KB
```

사이트는 릴리스와 **연동되지 않는다.** 그럴 필요가 없다 — 버튼은
`releases/latest/download/...` 를 가리키고, 푸터의 버전은 브라우저가 릴리스 API 에서
직접 읽는다. `pages.yml` 은 `site/` 나 필터가 바뀔 때만 돈다.

> `release: published` 트리거는 안 쓴다. **안 걸린다.** 릴리스를 만든 주체가
> `GITHUB_TOKEN` 이면 GitHub 은 그 이벤트로 다른 워크플로를 시작하지 않는다.

| 어디 | 무엇 |
|---|---|
| [Releases](../../releases/latest) | zip 정본. `releases/latest/download/<이름>.zip` 은 항상 최신으로 넘어간다 |
| [사이트](https://jshsakura.github.io/oc-ad-bye-pass/) (`site/`) | 설치 안내. 다운로드 버튼은 위 주소를 가리킬 뿐 파일을 들고 있지 않다 |
| `filters/youtube.json` | 규칙. 릴리스와 무관하게 갱신되고 확장이 알아서 받아간다 |

**에셋 이름은 계약이다.** 사이트 버튼도 `install.sh`/`install.ps1` 도 그 이름을 박아
쓴다. 바꾸면 전부 404 가 되고, 아무도 오류를 못 본다 — 그냥 다운로드가 안 될 뿐이다.

이전에는 홈서버 nginx(`adbyepass.opencourse.kr`)에 `deploy.sh` 로 손수 복사했다.
그러면 **커밋과 사이트가 맞는 게 우연**이라, 배포를 잊으면 옛 빌드가 조용히 계속
나갔다. 그래서 릴리스 기반으로 옮겼다.

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

### 규칙이 낡았는지 자동으로 감시한다

이 확장이 깨지는 방식은 하나뿐이다 — **유튜브가 바뀌는 것.** 코드는 그대로인데 어느 날
갑자기 안 막힌다. push 기반 CI 는 이걸 못 잡는다. 아무도 push 를 안 해도 깨지기 때문이다.

그래서 `.github/workflows/audit.yml` 이 **매일** 진짜 유튜브를 열어 실측한다
(`node scripts/audit-ads.mjs`).

처음엔 "내 셀렉터가 매칭되는가"를 셌는데 그건 **틀린 질문**이었다. 실측해보니 번들
셀렉터 57개 중 7개만 매칭됐는데, 그렇다고 광고가 새는 게 아니었다. 유튜브가
`ytd-*-renderer` 에서 `*-view-model` 체계로 옮겨갔지만 새 요소들이 전부 우리가 이미 잡는
컨테이너 안에 있었다.

```
ad-badge-view-model < … < ytd-in-feed-ad-layout-renderer < ytd-ad-slot-renderer
                                                           └ 우리가 잡는 것
```

그래서 질문을 바꿨다 — **확장을 켠 채로 광고성 요소가 화면에 보이는가.** 셀렉터 이름이
뭐로 바뀌든 이 질문의 답은 항상 유효하다.

판정에는 대조군이 필요하다. "광고가 안 보인다"만으로는 아무것도 증명하지 못한다 —
그 페이지에 원래 광고가 안 붙었을 수도 있다. 그래서 확장 없이 먼저 열어 광고가 실제로
있는지 확인하고, 있을 때만 차단 여부를 따진다. 없으면 실패가 아니라 **판정 불가**다.

```
시청   대조군 1 → 실험군 0   OK
검색   대조군 4 → 실험군 0   OK
홈     대조군 0 → 실험군 0   판정 불가 (비로그인이라 광고가 안 붙었다)
```

누출이 발견되면 이슈를 열고(이미 열려 있으면 댓글), 리포트를 artifact 로 남긴다.
덤으로 **규칙이 모르는 광고성 태그**도 같이 보고한다 — 아직 안 새더라도 유튜브가
새 이름을 쓰기 시작했다는 신호다. 실제로 이 감사가
`ytd-ads-engagement-panel-content-renderer` 를 찾아냈고 그렇게 규칙에 들어갔다.

오탐 방지로 `NOT_ADS` 목록을 둔다. `ytd-masthead` 는 이름에 masthead 가 들어가지만
상단 네비게이션 바다 — 이런 걸 안 걸러내면 "UI 를 통째로 숨기자"는 제안이 나온다.

### 앞으로 규칙을 가져올 때

안 막히는 광고를 [uAssets](https://github.com/uBlockOrigin/uAssets) 나
[AdguardFilters](https://github.com/AdguardTeam/AdguardFilters) 에서 퍼오는 일이 생길 텐데,
**셀렉터 목록은 편집저작물로 보호될 수 있다.** 둘 다 GPLv3 이고 이 프로젝트도 GPLv3 이라
가져오는 것 자체는 문제없지만, 어디서 가져왔는지 `filters/youtube.json` 의 해당 항목에
주석으로 남긴다.

## Orion 에서 달라지는 것

**Orion 은 `declarativeNetRequest` 를 지원하지 않는다.** Kagi 의 API 표에서 88개 항목이
macOS·iOS 모두 미지원이다. 같은 패키지를 설치하되 0계층만 죽는다.

| | Chrome / Edge | Orion |
|---|---|---|
| 0계층 네트워크 차단 | 동작 | **없음** |
| 1계층 유튜브 응답 프루닝 | 동작 | 동작 |
| 2계층 코스메틱 | 동작 | 동작 |
| 3계층 플레이어 폴백 | 동작 | 동작 |

DNR 호출은 전부 API 존재 확인을 거치므로 없는 쪽에서도 조용히 넘어간다. 유튜브는 그대로
다 막히고, 다른 사이트에서는 광고 요청이 나가되 광고 자리는 숨겨진다.

**설치 자체를 거절한다.** 2026-08-11 아이폰에서 확인했다. Chrome 패키지를 고르면
"Extensions Error. Something went wrong." 만 뜨고 이유는 없다. 그래서
`TARGET=orion` 빌드가 있다 — `scripts/targets.mjs` 의 `strip` 목록이 무엇을 왜 빼는지
말한다. 어느 항목이 진짜 원인이었는지는 모른다. 셋을 한꺼번에 뺐고, 깔리는 것이
먼저였다.

## 한계

- **서버가 스트림에 광고를 이어붙이는 경우**(server-side stitching)는 응답 프루닝으로
  막을 수 없다. 3계층이 건너뛰지만 완벽하지는 않다.
- 유튜브는 차단을 계속 바꾼다. 안 막히는 게 생기면 위 "필터 리스트" 절의 순서대로 규칙을 더한다.
- 자동 업데이트가 없다 (스토어 밖 확장의 한계). 코드가 바뀌면 zip 을 다시 받아야 한다.
