// UI language. Korean and English, chosen at runtime and stored in settings.
//
// Not chrome.i18n: that binds to the browser's UI language and cannot be
// switched from inside the extension. The whole ask here is a toggle the user
// flips, so the catalog lives in code and `t()` takes the language explicitly.
//
// One key, both languages, side by side — a missing translation is visible in
// the diff rather than at runtime. `{name}` placeholders are filled by `t`'s
// second argument.

export const LANGS = ['ko', 'en'] as const
export type Lang = (typeof LANGS)[number]

export const LANG_LABEL: Record<Lang, string> = { ko: '한국어', en: 'English' }

type Vars = Record<string, string | number>

/** Every user-facing string, Korean first. */
const M = {
  // — popup —
  'app.name': { ko: 'OC Ad Bye-Pass', en: 'OC Ad Bye-Pass' },
  'popup.sub.blocked': { ko: '{n}건 차단', en: '{n} blocked' },
  'popup.sub.idle': { ko: '광고 차단', en: 'Ad blocking' },
  'popup.master': { ko: '전체 켜기/끄기', en: 'Master on/off' },
  'popup.master.off': {
    ko: '전체가 꺼져 있습니다. 어느 사이트에서도 동작하지 않습니다.',
    en: "Everything is off — it won't run on any site.",
  },
  'popup.site.thisPage': { ko: '이 페이지', en: 'this page' },
  'popup.site.cannotRun': {
    ko: '확장이 동작할 수 없는 페이지입니다',
    en: "The extension can't run on this page",
  },
  'popup.site.offHere': { ko: '이 사이트에서 꺼져 있습니다', en: 'Turned off on this site' },
  'popup.site.youtubeAll': {
    ko: '이 사이트 — 3계층 전부 동작 중',
    en: 'This site — all three layers active',
  },
  'popup.site.generic': {
    ko: '광고망 차단 + 광고 자리 숨김',
    en: 'Ad-network blocking + slot hiding',
  },
  'popup.site.toggle': { ko: '{host} 에서 켜기/끄기', en: 'Toggle on {host}' },
  'popup.stat.pruned': { ko: '차단한 광고 요청', en: 'Ad requests blocked' },
  'popup.stat.skipped': { ko: '자동 스킵·닫기', en: 'Auto skip / close' },
  'popup.foot.thisSiteOnly': { ko: '이 사이트 항목만', en: 'This site only' },
  'popup.foot.allItems': { ko: '전체 항목 보기', en: 'Show all items' },
  'popup.foot.settings': { ko: '설정', en: 'Settings' },
  'popup.foot.diagnose': { ko: '진단', en: 'Diagnose' },
  'popup.blocked.title': { ko: '이 사이트에서', en: 'On this site' },
  'popup.blocked.applying': { ko: '적용 중', en: 'Active here' },
  'popup.blocked.network': {
    ko: '광고·추적 요청 차단 (16만+ 도메인)',
    en: 'Ad & tracker requests blocked (160k+ domains)',
  },
  'popup.blocked.youtube': {
    ko: 'YouTube 3계층 — 응답 광고 제거·요소 숨김·스킵',
    en: 'All three YouTube layers — prune, hide, skip',
  },
  'popup.blocked.slots': { ko: '광고 자리 숨김', en: 'Ad slots hidden' },
  'popup.blocked.krlist': { ko: '한국 사이트 규칙', en: 'Korean-site rules' },
  'popup.blocked.custom': { ko: '내 규칙 {n}개', en: '{n} custom rule(s)' },
  'popup.blocked.off': { ko: '이 사이트에서 꺼져 있습니다', en: 'Turned off on this site' },
  'popup.blocked.nohost': {
    ko: '이 페이지에서는 동작할 수 없습니다',
    en: "Can't run on this page",
  },
  'popup.blocked.exempt': { ko: '이 사이트 예외처리 (끄기)', en: 'Turn off for this site' },
  'popup.blocked.unexempt': { ko: '예외 해제 (다시 켜기)', en: 'Re-enable on this site' },
  'popup.blocked.close': { ko: '닫기', en: 'Close' },
  'popup.blocked.cookies': { ko: '쿠키 동의창 숨김', en: 'Cookie notices hidden' },
  'popup.blocked.popups': { ko: '누르지 않은 팝업 차단', en: 'Unasked-for pop-ups blocked' },
  'popup.blocked.hint': {
    ko: '사이트가 깨지면 여기서 이 사이트만 꺼 두세요.',
    en: 'If a site breaks, switch it off here for that site only.',
  },
  'popup.diag.copy': { ko: '복사', en: 'Copy' },
  'popup.diag.copied': { ko: '복사했습니다', en: 'Copied' },
  'popup.diag.close': { ko: '닫기', en: 'Close' },
  'layer.appTitle': { ko: '차단 계층이 아닌 기능', en: 'Not a blocking layer' },
  'layer.nTitle': { ko: '{n}계층', en: 'Layer {n}' },

  // — toggles (label + hint) —
  'toggle.videoAds.label': { ko: '동영상 광고 차단', en: 'Block video ads' },
  'toggle.videoAds.hint': {
    ko: '플레이어 응답에서 광고를 제거합니다',
    en: 'Strips ads out of the player response',
  },
  'toggle.generalAds.label': { ko: '피드·배너 광고 숨김', en: 'Hide feed & banner ads' },
  'toggle.generalAds.hint': { ko: '홈/검색/추천의 광고 카드', en: 'Ad cards in home / search / suggestions' },
  'toggle.shortsAds.label': { ko: 'Shorts 광고 숨김', en: 'Hide Shorts ads' },
  'toggle.shortsAds.hint': { ko: 'Shorts 피드에 섞인 광고', en: 'Ads mixed into the Shorts feed' },
  'toggle.merchandise.label': { ko: '상품·머천다이즈 숨김', en: 'Hide merchandise' },
  'toggle.merchandise.hint': { ko: '영상 하단 상품 선반, 쇼핑 패널', en: 'Product shelves, shopping panels' },
  'toggle.getPremium.label': { ko: 'Premium 권유 숨김', en: 'Hide Premium prompts' },
  'toggle.getPremium.hint': { ko: '하단 배너, 가입 유도 팝업', en: 'Bottom banners, sign-up pop-ups' },
  'toggle.fullscreenAds.label': { ko: '전면·오버레이 광고 닫기', en: 'Close overlay ads' },
  'toggle.fullscreenAds.hint': { ko: '재생 중 겹쳐 뜨는 광고', en: 'Ads laid over the video' },
  'toggle.antiAdblockNag.label': { ko: '애드블록 경고창 무시', en: 'Ignore adblock warnings' },
  'toggle.antiAdblockNag.hint': {
    ko: '"광고 차단기를 사용 중입니다" 안내',
    en: 'The "you are using an ad blocker" notice',
  },
  'toggle.appPromo.label': { ko: '앱으로 열기 유도 숨김', en: 'Hide open-in-app prompts' },
  'toggle.appPromo.hint': {
    ko: '상단 스마트 앱 배너, "앱에서 보기" 바',
    en: 'Smart app banners, "open in app" bars',
  },
  'toggle.playerFallback.label': { ko: '광고 자동 스킵 (폴백)', en: 'Auto-skip ads (fallback)' },
  'toggle.playerFallback.hint': {
    ko: '위 차단이 뚫렸을 때만 동작',
    en: 'Only runs when the blocking above is bypassed',
  },
  'toggle.genericAds.label': { ko: '다른 사이트 광고 숨김', en: 'Hide ads on other sites' },
  'toggle.genericAds.hint': {
    ko: '영상 사이트 밖에서도 광고 자리를 숨깁니다',
    en: 'Hides ad slots away from video sites too',
  },
  'toggle.cookieBanners.label': { ko: '쿠키 동의창 숨김', en: 'Hide cookie notices' },
  'toggle.cookieBanners.hint': {
    ko: '쿠키 동의 배너와 함께 뜨는 구독·앱 설치 유도창을 숨깁니다. 배너를 눌러야만 넘어가는 사이트에서는 꺼 주세요',
    en: 'Hides cookie consent walls and the newsletter or app-install nags that come with them. Turn it off on sites that only continue once the banner is answered',
  },
  'toggle.popups.label': { ko: '팝업·팝언더 차단', en: 'Block pop-ups' },
  'toggle.popups.hint': {
    ko: '누르지도 않았는데 열리는 새 창만 막습니다. 직접 누른 링크는 그대로 열립니다',
    en: 'Blocks windows that open without you touching anything. A link you actually clicked still opens',
  },
  'toggle.pipButton.label': { ko: '작은 화면(PiP) 버튼', en: 'Picture-in-picture button' },
  'toggle.pipButton.hint': {
    ko: '플레이어 오른쪽 아래에 버튼을 답니다 — 누르면 브라우저의 작은 화면이 열립니다',
    en: "Adds a button at the player's lower right — it opens the browser's floating window",
  },
  'toggle.autoCaptions.label': { ko: '현재 언어로 자막 자동 선택', en: 'Auto captions in your language' },
  'toggle.autoCaptions.hint': {
    ko: '외국어 영상일 때만 브라우저 언어의 자막을 고르고, 없으면 자동 번역을 켭니다. 내 언어 영상과 직접 바꾼 선택은 건드리지 않습니다',
    en: 'On foreign-language videos, picks subtitles in the browser language or auto-translates. Videos already in your language, and your own changes, are left alone',
  },

  // — options / settings page —
  'opt.title': { ko: 'OC Ad Bye-Pass 설정', en: 'OC Ad Bye-Pass Settings' },
  'opt.close': { ko: '닫기', en: 'Close' },
  'opt.close.aria': { ko: '설정 닫기', en: 'Close settings' },
  'opt.update.available': {
    ko: '새 버전 v{latest} 이 있습니다 (지금 v{current})',
    en: 'A new version v{latest} is available (now v{current})',
  },
  'opt.update.download': { ko: '내려받기', en: 'Download' },
  'opt.lede': {
    ko: '차단 규칙은 확장 안에 기본값이 들어 있고, 아래 필터 리스트를 더해서 씁니다. 영상 사이트가 태그를 바꿔도 리스트만 갱신되면 재설치 없이 반영됩니다.',
    en: 'Blocking rules ship with the extension as defaults, added to by the filter list below. If a video site changes its markup, an updated list applies it without a reinstall.',
  },
  'opt.lang': { ko: '언어', en: 'Language' },
  'opt.lang.desc': {
    ko: '팝업과 이 설정 화면의 표시 언어입니다.',
    en: 'The display language for the popup and this settings page.',
  },

  'opt.version': { ko: '버전', en: 'Version' },
  'opt.version.desc': {
    ko: '이 확장은 스스로 업데이트하지 못합니다 — 파일로 설치한 확장을 다시 설치해 주는 API 가 브라우저에 없습니다. 대신 새 버전이 나왔는지 확인하고 받는 데까지는 해 드립니다. 받은 뒤에는 Extensions 에서 기존 것을 지우고 다시 넣으시면 됩니다.',
    en: "The extension can't update itself — browsers give a file-installed extension no API to reinstall itself. It can check for a new version and fetch it, though. After that, remove the old one in Extensions and add it again.",
  },
  'opt.version.storeDesc': {
    ko: '크롬 웹스토어에서 설치된 버전입니다. 새 버전이 나오면 브라우저가 알아서 업데이트하니 여기서 하실 일은 없습니다.',
    en: 'Installed from the Chrome Web Store. The browser updates it by itself when a new version ships, so there is nothing to do here.',
  },
  'opt.version.now': { ko: '지금 버전', en: 'Current' },
  'opt.version.latest': { ko: '최신 버전', en: 'Latest' },
  'opt.version.notChecked': { ko: '확인 전', en: 'Not checked' },
  'opt.version.new': { ko: 'v{v} — 새 버전', en: 'v{v} — new' },
  'opt.version.upToDate': { ko: 'v{v} — 최신입니다', en: 'v{v} — up to date' },
  'opt.version.checkFail': { ko: '확인하지 못했습니다', en: "Couldn't check" },
  'opt.version.check': { ko: '업데이트 확인', en: 'Check for updates' },
  'opt.version.checking': { ko: '확인 중…', en: 'Checking…' },
  'opt.version.getZip': { ko: '{file} 받기', en: 'Get {file}' },
  'opt.version.store': { ko: '스토어에서 확인', en: 'Open the store listing' },

  'opt.list': { ko: '필터 리스트', en: 'Filter list' },
  'opt.list.desc': {
    ko: 'JSON 규칙을 30분마다 받아옵니다. 받아오는 것은 셀렉터 같은 데이터뿐이고 스크립트는 실행하지 않습니다. 형식·크기·안전성 검사를 통과하지 못하면 버리고 기존 규칙을 그대로 씁니다.',
    en: 'JSON rules are fetched every 30 minutes. Only data — selectors and the like — is fetched; no script is run. Anything that fails the format, size or safety checks is discarded and the existing rules are kept.',
  },
  'opt.list.useRemote': { ko: '원격 리스트 사용', en: 'Use remote list' },
  'opt.list.useRemoteHint': {
    ko: '끄면 확장에 내장된 기본 규칙만 씁니다',
    en: 'Off = only the built-in rules',
  },
  'opt.list.url': { ko: '리스트 주소', en: 'List URL' },
  'opt.list.add': { ko: '리스트 추가', en: 'Add a list' },
  'opt.list.addBtn': { ko: '추가하고 갱신', en: 'Add & refresh' },
  'opt.list.remove': { ko: '이 리스트 제거', en: 'Remove this list' },
  'opt.list.none': {
    ko: '구독한 리스트가 없습니다. 확장에 내장된 규칙만 씁니다.',
    en: 'No lists subscribed — the built-in rules are all that apply.',
  },
  'opt.list.subMeta': { ko: 'v{v} · {when}', en: 'v{v} · {when}' },
  'opt.list.subNever': { ko: '아직 받지 않음', en: 'Not fetched yet' },
  'opt.list.full': {
    ko: '리스트는 {n}개까지 넣을 수 있습니다.',
    en: 'Up to {n} lists.',
  },
  'opt.list.savePerm': { ko: '권한 허용하고 저장', en: 'Grant permission & save' },
  'opt.list.save': { ko: '저장하고 갱신', en: 'Save & refresh' },
  'opt.list.updateNow': { ko: '지금 업데이트', en: 'Update now' },
  'opt.list.default': { ko: '기본 목록으로', en: 'Reset to defaults' },
  'opt.list.notGithub': {
    ko: 'GitHub 이 아닌 주소입니다. 리스트 제공자는 보고 있는 화면의 요소를 숨길 수 있으니 믿을 수 있는 곳만 쓰세요.',
    en: "This is not a GitHub address. A list provider can hide elements on the pages you view, so use only sources you trust.",
  },
  'opt.list.source': { ko: '현재 소스', en: 'Current source' },
  'opt.list.remote': { ko: '원격 리스트', en: 'Remote list' },
  'opt.list.builtin': { ko: '내장 기본 규칙', en: 'Built-in rules' },
  'opt.list.version': { ko: '버전', en: 'Version' },
  'opt.list.lastUpdate': { ko: '마지막 갱신', en: 'Last updated' },
  'opt.list.dropped': { ko: '걸러낸 규칙', en: 'Dropped rules' },
  'opt.list.droppedVal': { ko: '{n}개 (안전 검사 불통과)', en: '{n} (failed safety check)' },
  'opt.err.badUrl': { ko: '올바른 주소가 아닙니다.', en: 'Not a valid URL.' },
  'opt.err.dupList': {
    ko: '이미 들어 있는 주소입니다.',
    en: "That list is already in the list.",
  },
  'opt.err.noPerm': {
    ko: '이 주소를 쓸 권한을 얻지 못했습니다. 브라우저가 권한 요청을 지원하지 않는 경우도 있습니다 — 기본 주소나 jshsakura.github.io 주소는 권한 없이 바로 됩니다.',
    en: "Couldn't get permission for this address. Some browsers don't support permission requests — the default address and jshsakura.github.io work without one.",
  },

  'opt.rules': { ko: '내 규칙', en: 'My rules' },
  'opt.rules.desc.a': {
    ko: '한 줄에 CSS 셀렉터 하나. 여기 적은 것은 항상 적용되고 원격 업데이트에 덮이지 않습니다.',
    en: 'One CSS selector per line. What you put here always applies and is never overwritten by a remote update.',
  },
  'opt.rules.desc.b': {
    ko: '로 시작하는 줄은 주석입니다. 안 사라지는 광고를 직접 찍어 넣는 곳입니다. 셀렉터를 직접 쓰는 대신 팝업의 "요소 고르기" 로 눌러서 넣을 수도 있습니다.',
    en: 'A line starting with it is a comment. This is where you point at an ad that will not go away — or use "Pick an element" in the popup and tap it instead of writing the selector.',
  },
  'opt.rules.save': { ko: '저장', en: 'Save' },
  'opt.rules.bad': { ko: '쓸 수 없는 셀렉터 {n}개: {list}', en: '{n} unusable selectors: {list}' },
  'opt.rules.count': { ko: '{n}개 규칙', en: '{n} rules' },
  'opt.rules.unsaved': { ko: ' · 저장하지 않음', en: ' · unsaved' },

  'opt.siteOff': { ko: '이 사이트에서 끄기 목록', en: 'Per-site off list' },
  'opt.siteOff.desc': {
    ko: '여기 적힌 사이트에서는 확장이 완전히 손을 뗍니다 — 광고망 차단도, 요소 숨김도 하지 않습니다. 하위 도메인까지 함께 적용됩니다. 사이트를 끄는 것은 확장 아이콘을 눌러 그 자리에서 할 수 있고, 여기서는 목록을 정리합니다.',
    en: "On the sites listed here the extension stands down entirely — no network blocking, no element hiding. Subdomains are covered too. You can switch a site off from the extension icon; here you manage the list.",
  },
  'opt.siteOff.empty': {
    ko: '아직 없습니다. 어느 사이트에서도 켜져 있습니다.',
    en: 'None yet. On everywhere.',
  },
  'opt.siteOff.reenable': { ko: '다시 켜기', en: 'Re-enable' },
  'opt.siteOff.add': { ko: '추가', en: 'Add' },

  'opt.backup': { ko: '설정 백업', en: 'Back up settings' },
  'opt.backup.desc': {
    ko: '예외 사이트 목록과 내 규칙처럼 직접 적어 넣은 것들을 파일 하나로 빼 둘 수 있습니다. 아이폰(Orion)은 업데이트가 삭제 후 재설치라 그때마다 설정이 날아가는데, 이 파일을 다시 넣으면 그대로 돌아옵니다. 통계와 받아 둔 리스트는 들어가지 않습니다.',
    en: 'Puts everything you typed in yourself — the per-site exceptions, your own rules — into one file. On iPhone (Orion) an update means delete and reinstall, which takes the settings with it; this file brings them back. Statistics and downloaded lists are not included.',
  },
  'opt.backup.export': { ko: '파일로 내보내기', en: 'Save to a file' },
  'opt.backup.copy': { ko: '복사', en: 'Copy' },
  'opt.backup.copied': { ko: '설정을 복사했습니다.', en: 'Settings copied.' },
  'opt.backup.copyFail': {
    ko: '복사하지 못했습니다. 아래 붙여넣기 칸을 쓰세요.',
    en: "Couldn't copy — use the paste box below.",
  },
  'opt.backup.exported': { ko: '설정 파일을 내려받았습니다.', en: 'Settings file downloaded.' },
  'opt.backup.importFile': { ko: '파일에서 가져오기', en: 'Load from a file' },
  'opt.backup.paste': { ko: '또는 내보낸 내용을 붙여넣기', en: 'Or paste an exported file' },
  'opt.backup.importPaste': { ko: '붙여넣은 설정 적용', en: 'Apply pasted settings' },
  'opt.backup.imported': {
    ko: '설정을 가져왔습니다. 지금 설정을 전부 덮어썼습니다.',
    en: 'Settings imported — everything here was replaced.',
  },
  'opt.stats': { ko: '통계', en: 'Statistics' },
  'opt.stats.desc': {
    ko: '팝업에 표시되는 누적 차단 수입니다. 아이콘 배지에는 지금 보고 있는 탭에서 막은 광고 수가 실시간으로 뜹니다.',
    en: "The cumulative count shown in the popup. The icon badge shows, live, how many ads were blocked on the tab you're looking at.",
  },
  'opt.stats.reset': { ko: '통계 초기화', en: 'Reset statistics' },
  'opt.stats.resetDone': { ko: '통계를 초기화했습니다.', en: 'Statistics reset.' },

  'opt.foot.source': { ko: '소스 코드 · 문제 신고', en: 'Source code · report an issue' },
  'opt.foot.sourceLink': { ko: 'GitHub 에서 보기', en: 'View on GitHub' },

  // — element picker —
  'picker.hint': {
    ko: '숨기고 싶은 것을 누르세요. 방향키로 범위를 넓히거나 좁히고, Enter 로 추가, Esc 로 취소합니다.',
    en: 'Tap what you want gone. Arrow keys widen or narrow, Enter adds it, Esc cancels.',
  },
  'picker.matches': { ko: '이 페이지에서 {n}개와 일치', en: 'matches {n} on this page' },
  'picker.noSelector': {
    ko: '이 요소는 규칙으로 만들 수 없습니다. 조금 넓혀 보세요.',
    en: 'No stable rule for this element. Try widening it.',
  },
  'picker.wider': { ko: '넓게', en: 'Wider' },
  'picker.narrower': { ko: '좁게', en: 'Narrower' },
  'picker.save': { ko: '내 규칙에 추가', en: 'Add to my rules' },
  'picker.cancel': { ko: '취소', en: 'Cancel' },
  'picker.full': {
    ko: '내 규칙이 가득 찼습니다. 설정에서 정리해 주세요.',
    en: 'Your rules are full — prune them in settings.',
  },
  'popup.foot.pick': { ko: '요소 고르기', en: 'Pick element' },
  'popup.pick.cannot': {
    ko: '이 페이지에서는 요소를 고를 수 없습니다.',
    en: "Can't pick on this page.",
  },

  // — relative time (format.ts) —
  'time.never': { ko: '아직 없음', en: 'never' },
  'time.justNow': { ko: '방금', en: 'just now' },
  'time.min': { ko: '{n}분 전', en: '{n} min ago' },
  'time.hour': { ko: '{n}시간 전', en: '{n}h ago' },
  'time.day': { ko: '{n}일 전', en: '{n}d ago' },
} as const

export type MessageKey = keyof typeof M

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

export type TFn = (key: MessageKey, vars?: Vars) => string

/** A translator bound to one language. Falls back to Korean for any gap. */
export function makeT(lang: Lang): TFn {
  return (key, vars) => {
    const entry = M[key]
    const s = (entry && (entry[lang] ?? entry.ko)) ?? key
    return interpolate(s, vars)
  }
}

/** Best-effort language from the browser, for the very first run only. */
export function detectLang(): Lang {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
    return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en'
  } catch {
    return 'ko'
  }
}
