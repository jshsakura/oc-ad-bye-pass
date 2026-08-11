# OC Ad Bye-Pass — Windows 설치 스크립트
#
#   irm https://raw.githubusercontent.com/jshsakura/oc-ad-bye-pass/main/scripts/install.ps1 | iex
#
# 하는 일: 최신 zip 을 받아 **고정된 위치**에 풀고, 크롬에 붙여넣을 경로를 찍어준다.
# 폴더도 탐색기로 열어준다 — 경로를 손으로 옮겨 적을 필요가 없다.
#
# 왜 고정된 위치인가: 압축해제 로드는 원본 폴더를 계속 참조한다. 다운로드 폴더에
# 풀었다가 나중에 정리하면 확장이 조용히 죽는다 — 지인 배포에서 제일 흔한 사고다.
#
# 업데이트도 같은 명령을 다시 돌리면 된다. 경로가 그대로라 크롬에서 새로고침만
# 누르면 되고, 다시 로드할 필요가 없다.

$ErrorActionPreference = 'Stop'

# The GitHub release is the distribution — see the comment in install.sh.
$ZipUrl = if ($env:OCABP_ZIP)  { $env:OCABP_ZIP }  else { 'https://github.com/jshsakura/oc-ad-bye-pass/releases/latest/download/oc-ad-bye-pass-desktop.zip' }
$Target = if ($env:OCABP_DIR)  { $env:OCABP_DIR }  else { Join-Path $env:LOCALAPPDATA 'OcAdByePass' }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ocabp-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null

try {
  Write-Host "내려받는 중… $ZipUrl"
  $zip = Join-Path $Tmp 'ext.zip'
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing -TimeoutSec 120

  $unpacked = Join-Path $Tmp 'unpacked'
  Expand-Archive -Path $zip -DestinationPath $unpacked -Force

  # 받은 게 정말 확장인지 확인한 뒤에야 기존 폴더를 건드린다.
  # (서버가 404 페이지를 뱉거나 zip 이 깨졌을 때 멀쩡한 설치본을 날리지 않기 위해)
  $manifest = Join-Path $unpacked 'manifest.json'
  if (-not (Test-Path $manifest)) {
    throw "manifest.json 이 없습니다 — 확장 zip 이 아닙니다"
  }
  $version = (Get-Content $manifest -Raw | ConvertFrom-Json).version

  # 안전장치: 우리가 만든 폴더이거나 비어 있을 때만 지운다
  if (Test-Path $Target) {
    $hasManifest = Test-Path (Join-Path $Target 'manifest.json')
    $isEmpty = -not (Get-ChildItem -Path $Target -Force -ErrorAction SilentlyContinue)
    if (-not $hasManifest -and -not $isEmpty) {
      throw "이미 다른 내용이 있습니다: $Target (OCABP_DIR 로 다른 경로를 지정하세요)"
    }
    Remove-Item -Path $Target -Recurse -Force
  }

  $parent = Split-Path $Target -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Move-Item -Path $unpacked -Destination $Target

  Write-Host ''
  Write-Host "설치 완료 — 버전 $version"
  Write-Host ''
  Write-Host "  $Target"
  Write-Host ''
  Write-Host '크롬에서 (Edge 도 같습니다):'
  Write-Host '  1. 주소창에 chrome://extensions 입력'
  Write-Host "  2. 우측 상단 '개발자 모드' 켜기"
  Write-Host "  3. '압축해제된 확장 프로그램을 로드' → 열려 있는 탐색기 창의 폴더 선택"
  Write-Host ''
  Write-Host '이 폴더는 지우면 안 됩니다. 크롬이 계속 참조합니다.'
  Write-Host '업데이트는 이 명령을 다시 돌린 뒤 chrome://extensions 에서 새로고침만 누르면 됩니다.'

  # 경로를 클립보드에 넣고 탐색기로 열어준다 — 손으로 옮겨 적을 일이 없다
  try { Set-Clipboard -Value $Target; Write-Host ''; Write-Host '(경로를 클립보드에 복사했습니다)' } catch {}
  Start-Process explorer.exe $Target
}
finally {
  Remove-Item -Path $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
