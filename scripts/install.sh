#!/usr/bin/env bash
# OC Ad Bye-Pass — macOS / Linux 설치 스크립트
#
#   curl -fsSL https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/scripts/install.sh | bash
#
# 하는 일: 최신 zip 을 받아 **고정된 위치**에 풀고, 크롬에 붙여넣을 경로를 찍어준다.
#
# 왜 고정된 위치인가: 압축해제 로드는 원본 폴더를 계속 참조한다. 다운로드 폴더에
# 풀었다가 나중에 정리하면 확장이 조용히 죽는다 — 지인 배포에서 제일 흔한 사고다.
#
# 업데이트도 같은 명령을 다시 돌리면 된다. 폴더 경로가 그대로라 크롬에서
# 새로고침만 누르면 끝이고, 다시 로드할 필요가 없다.

set -euo pipefail

# The GitHub release is the distribution. `latest/download/<asset>` always
# redirects to the newest release, so this URL never has to change — which is
# also why the asset name in .github/workflows/release.yml must not.
ZIP_URL="${OCABP_ZIP:-https://github.com/jshsakura/oc-ad-bye-pass/releases/latest/download/oc-ad-bye-pass.zip}"

case "$(uname -s)" in
  Darwin) DEFAULT_DIR="$HOME/Library/Application Support/OcAdByePass" ;;
  *)      DEFAULT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/oc-ad-bye-pass" ;;
esac
TARGET="${OCABP_DIR:-$DEFAULT_DIR}"

say() { printf '%s\n' "$*"; }
die() { printf '오류: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl 이 필요합니다"
command -v unzip >/dev/null || die "unzip 이 필요합니다"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "내려받는 중… $ZIP_URL"
curl -fsSL --max-time 120 -o "$TMP/ext.zip" "$ZIP_URL" || die "내려받기 실패"

unzip -q "$TMP/ext.zip" -d "$TMP/unpacked" || die "압축 풀기 실패"

# 받은 게 정말 확장인지 확인한 뒤에야 기존 폴더를 건드린다.
# (서버가 404 HTML 을 뱉거나 zip 이 깨졌을 때 멀쩡한 설치본을 날리지 않기 위해)
[ -f "$TMP/unpacked/manifest.json" ] || die "manifest.json 이 없습니다 — 확장 zip 이 아닙니다"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/unpacked/manifest.json" | head -1)"

# 안전장치: 우리가 만든 폴더이거나 비어 있을 때만 지운다
if [ -e "$TARGET" ]; then
  if [ ! -f "$TARGET/manifest.json" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
    die "이미 다른 내용이 있습니다: $TARGET (OCABP_DIR 로 다른 경로를 지정하세요)"
  fi
  rm -rf "$TARGET"
fi

mkdir -p "$(dirname "$TARGET")"
mv "$TMP/unpacked" "$TARGET"

say ""
say "설치 완료 — 버전 ${VERSION:-알 수 없음}"
say ""
say "  $TARGET"
say ""
say "크롬에서 (Edge 도 같습니다):"
say "  1. 주소창에 chrome://extensions 입력"
say "  2. 우측 상단 '개발자 모드' 켜기"
say "  3. '압축해제된 확장 프로그램을 로드' → 위 경로 선택"
say ""
say "이 폴더는 지우면 안 됩니다. 크롬이 계속 참조합니다."
say "업데이트는 이 명령을 다시 돌린 뒤 chrome://extensions 에서 새로고침만 누르면 됩니다."

# macOS 는 Finder 로 폴더를 열어준다 — 경로 붙여넣기보다 쉽다
if [ "$(uname -s)" = "Darwin" ] && [ -t 1 ]; then
  open "$TARGET" 2>/dev/null || true
fi
