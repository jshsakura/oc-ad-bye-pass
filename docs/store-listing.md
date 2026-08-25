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
