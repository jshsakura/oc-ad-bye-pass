# 스토어 리스팅 문안

크롬 웹스토어의 **상세 설명**은 대시보드에만 있고 저장소에서 배포되지 않습니다. 그래서 정본을 여기 둡니다. 바꿀 일이 생기면 여기를 고치고 대시보드에 붙여넣으세요. 리스팅과 저장소가 어긋나는 것은 그러지 않으면 시간 문제입니다.

짧은 설명(이름 아래 한 줄)은 여기 없습니다. 그건 `public/_locales/*/messages.json`의 `extDescription`이고 패키지와 함께 올라갑니다. 132자 상한이 있고 `npm run verify`가 지킵니다.

**두 언어를 번역해서 쓰지 않았습니다.** 같은 불만이지만 같은 문장은 아닙니다.

---

## 한국어 (상세 설명)

```
웹을 쓰다 보면 읽으려던 것에 닿기까지 몇 번을 닫아야 합니다. 쿠키 동의창을 닫고, 구독하라는 창을 닫고, 앱으로 열라는 배너를 닫고, 누른 적도 없는데 열린 창을 닫습니다. 그러고 나면 광고가 자리를 잡고 있습니다.

이 확장은 그것들이 아예 안 뜨게 합니다.

무엇을 치우나

· 광고와 추적 요청을 주소 단계에서 막습니다. 요청이 나가지 않으니 그려질 것도 없고 데이터도 쓰지 않습니다.
· 남은 광고 자리를 숨깁니다. 한국 사이트 규칙을 따로 싣고 있어서 국내 포털과 커뮤니티, 뉴스 사이트에서도 동작합니다.
· 쿠키 동의창과 거기 딸려오는 구독·앱 설치 유도창을 숨깁니다.
· 누르지도 않았는데 열리는 새 창을 막습니다. 직접 누른 링크와 버튼은 그대로 열립니다.
· 영상 사이트에서는 광고가 재생되기 전에 응답에서 걷어냅니다. 건너뛸 것 자체가 남지 않습니다.

안 사라지는 게 하나 있다면

확장 아이콘을 누르고 "요소 고르기"를 고른 다음, 화면에서 그것을 누르면 됩니다. 개발자도구를 열 필요도, 셀렉터를 쓸 줄 알 필요도 없습니다. 범위는 방향키로 넓히거나 좁힙니다.

뭔가 깨지면

전역으로 도는 확장은 무엇이든 깨뜨릴 수 있습니다. 그래서 사이트별로 끌 수 있게 해 두었습니다. 확장 아이콘을 눌러 그 사이트의 스위치만 내리면 하위 도메인까지 함께 멈춥니다. 깨진 페이지를 만났을 때 선택지가 "확장 삭제"뿐이면 사람들은 실제로 지웁니다.

차단 규칙은 확장과 따로 갱신됩니다. 사이트가 화면을 바꿔도 다시 설치하실 필요가 없습니다.

예외 사이트 목록과 직접 넣은 규칙은 파일 하나로 빼 두었다가 되돌릴 수 있습니다.

데이터

계정도 서버도 없습니다. 모든 처리가 브라우저 안에서 끝나고, 무엇을 보셨는지는 어디로도 나가지 않습니다. 받아오는 것은 차단 규칙 목록뿐이고, 그것도 셀렉터 같은 데이터일 뿐 실행되는 코드가 아닙니다.

오픈소스입니다 (GPLv3). 코드는 github.com/jshsakura/oc-ad-bye-pass 에 있습니다.
```

## English (detailed description)

```
Getting to the thing you came for takes a few dismissals. Close the cookie wall, close the newsletter box, close the open-in-app banner, close the window you never clicked. By then the ads have settled in.

This stops them arriving.

What it clears

· Ad and tracker requests, blocked at the address. Nothing is fetched, so nothing is drawn and nothing is paid for in data.
· Leftover ad slots, hidden. Korean site rules ship alongside the global ones, so domestic portals and forums are covered too.
· Cookie consent walls, and the newsletter and app-install nags that travel with them.
· Windows that open out of nothing you pressed. Links and buttons you actually clicked still open.
· On video sites, ads are cut out of the response before playback. There is nothing left to skip.

If something slips through

Click the icon, choose "Pick element", and tap the thing on the page. No DevTools, no need to know what a selector is. Arrow keys widen or narrow what you picked.

If something breaks

An extension that runs everywhere can break anything, so it can be switched off per site — subdomains included. When the only recourse for a broken page is uninstalling, people uninstall.

Blocking rules update separately from the extension, so a site changing its markup does not mean reinstalling. Your per-site exceptions and your own rules save to a file and load back from it.

Data

No account, no server. Everything happens inside your browser, and what you looked at goes nowhere. The only thing fetched is the rule list, and that is data — selectors — not code that runs.

Open source, GPLv3: github.com/jshsakura/oc-ad-bye-pass
```

---

## 쓰면서 지킨 것

**과장하지 않습니다.** "완벽 차단", "100%", "최고" 같은 말은 넣지 않습니다. 서버가 스트림에 광고를 이어 붙이는 경우는 못 막고, 팝업 차단은 평범한 `<div>`로 창을 여는 정상 사이트도 막습니다. 리스팅이 약속한 것과 사용자가 겪는 것이 어긋나면 남는 것은 나쁜 리뷰입니다.

**한글에 줄표(—)를 쓰지 않습니다.** 마침표나 쉼표로 끊습니다. 문장 부호 하나로 번역 티가 납니다.

**어투는 하나로 갑니다.** 전부 합니다체입니다.

**기능 나열로 시작하지 않습니다.** 첫 문단은 읽는 사람이 어제 겪은 일이어야 합니다. 무엇을 하는 확장인지는 그다음에 와도 늦지 않습니다.

---

# 권한 정당화 (Privacy practices)

대시보드 **항목 → 개인정보 보호 관행**에 있는 입력란들입니다. 선언한 권한마다 사유를 한 문단씩 적어야 하고, 비어 있으면 심사가 반려됩니다. 이것도 대시보드에만 있는 값이라 여기에 정본을 둡니다.

**심사자는 영어로 읽습니다.** 그래서 문안은 영어로 씁니다.

문안을 쓸 때 지킨 것: 권한마다 **무엇을 하려고 쓰는지**와 **무엇을 하지 않는지**를 같이 적습니다. 뒤쪽이 실제로 심사를 통과시키는 절반입니다. "이 확장은 요청 내용을 읽지 않는다"는 문장이 있는 것과 없는 것은 다릅니다.

## 무엇을 요구하고 있나

| 선언 | 값 |
|---|---|
| `permissions` | `storage`, `activeTab`, `declarativeNetRequest`, `scripting` |
| `host_permissions` | `raw.githubusercontent.com`, `gist.githubusercontent.com` |
| `optional_host_permissions` | 모든 https 오리진 (요청할 때만) |
| `content_scripts` | 모든 http/https 사이트, ISOLATED 와 MAIN 둘 다 |

**v0.16.0 에서 바뀐 것은 마지막 줄입니다.** ISOLATED 스크립트는 전부터 모든 사이트에 있었지만(그게 다른 사이트 광고 숨김의 전부입니다), MAIN 월드 스크립트는 영상 사이트에만 있었습니다. 팝업 차단 때문에 그것도 전 사이트가 됐습니다. 예전 정당화 문구에 "페이지 컨텍스트 주입은 영상 사이트에서만" 같은 표현이 남아 있으면 지금은 사실이 아닙니다.

## 붙여넣을 문안

### storage

```
Stores the user's own settings — which blocking layers are on, the sites they
have switched the extension off on, and any hiding rules they wrote themselves —
and caches the filter lists the extension downloads. Both sync and local areas
are used because sync is unreliable on some browsers this package supports, and
losing a hand-written rule list is not recoverable. Nothing in storage is sent
anywhere.
```

### activeTab

```
Reads the hostname of the tab the user opened the popup on, so the popup can
name the site it is acting on and offer a per-site off switch for it. Used only
in response to the user invoking the extension. The broader "tabs" permission is
not requested, and no browsing history is read.
```

### declarativeNetRequest

```
Blocks requests to known advertising and tracking hosts using a static ruleset
bundled inside the package, and adds dynamic allow rules for the sites the user
has switched the extension off on. Declarative only: the extension never sees
the URLs or contents of the requests it blocks, and does not use the
declarativeNetRequestFeedback permission.
```

### scripting

```
Registers the MAIN-world content script at runtime with
scripting.registerContentScripts. Chrome honours world:"MAIN" on the static
declaration, but WebKit-based browsers that install this same package ignore it,
and the ad-removal in the video player response must run in the page's own
context to work at all. The script registered is a file inside the package; no
code is ever fetched, generated, or evaluated.
```

### 호스트 권한 (raw.githubusercontent.com, gist.githubusercontent.com)

```
The filter lists the extension subscribes to are JSON files hosted on these two
origins. They carry CSS selectors and JSON field paths — data, never code — and
every entry is validated against a schema before it is used. Access to any other
origin is declared as optional and requested only if the user points the
extension at a filter list of their own.
```

### 모든 사이트에 콘텐츠 스크립트를 넣는 이유

```
The extension hides advertising on whatever site the user is reading, so its
content script runs on all of them. Two scripts are declared.

The isolated-world script applies a stylesheet that hides ad slots. It also
draws the element picker, but only after the user opens the popup and asks for
it. Away from video sites it does nothing else: no observers, no timers.

The page-world script installs one guard on window.open, which refuses windows
that open out of a press on something that is not a link or a button — the
pop-under pattern that browsers permit because it rides a real click. On video
sites, and only there, it also filters advertising out of the player's response
before playback.

Both stand down entirely on any site the user has switched the extension off on.
No page content is read, collected, or transmitted.
```

### 단일 목적 (Single purpose)

```
Blocking advertising, and the interruptions that arrive with it — cookie consent
walls, unasked-for pop-up windows, and app-install prompts.
```

### 원격 코드 사용 (Are you using remote code?)

**아니오.** 받아오는 것은 필터 리스트 JSON 뿐이고 그것은 데이터입니다. 이 답이 흔들리면 심사가 길어집니다. 원격 스크립틀릿(`##+js(...)`)을 끝내 넣지 않은 이유 중 하나가 이것입니다.

### 데이터 사용

수집하는 것 없음. 개인정보처리방침: https://jshsakura.github.io/oc-ad-bye-pass/privacy.html
