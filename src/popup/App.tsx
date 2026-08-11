import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  TOGGLE_META,
  loadSettings,
  loadStats,
  saveSettings,
  type Settings,
  type Stats,
  type ToggleKey,
} from '../shared/settings.ts'
import {
  addToAllowlist,
  hostFromUrl,
  isAllowlisted,
  removeFromAllowlist,
  siteKindFor,
} from '../shared/sites.ts'
import { Icon } from '../ui/Icon.tsx'
import { Switch } from '../ui/Switch.tsx'
import { collect, format, type Report } from './diagnose.ts'
import { formatCount } from '../ui/format.ts'

/**
 * Open the settings page.
 *
 * `openOptionsPage` is the idiomatic call and the right one on desktop. On iOS
 * there is no options entry point at all — the extension is reachable only
 * through its popup — and the call can resolve having done nothing. Opening the
 * page as an ordinary tab always works, so that is the fallback, and it is the
 * only way settings are reachable at all on a phone.
 */
async function openSettings() {
  const url = chrome.runtime.getURL('options.html')
  try {
    if (chrome.runtime.openOptionsPage) {
      await chrome.runtime.openOptionsPage()
      // It resolved, but on WebKit that is not proof anything opened. Check.
      const open = await chrome.tabs.query({ url })
      if (open.length > 0) return
    }
  } catch {
    // fall through
  }
  await chrome.tabs.create({ url })
}

/** Toggles that only mean anything on YouTube. */
const YOUTUBE_KEYS: ToggleKey[] = TOGGLE_META.map((m) => m.key).filter((k) => k !== 'genericAds')

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS)
  const [host, setHost] = useState<string | null>(null)
  const [tabReady, setTabReady] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadStats().then(setStats)
    // activeTab lets us read the URL of the tab that was active when the popup
    // opened, and nothing else. We never request the broader tabs permission.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setHost(hostFromUrl(tab?.url)))
      .catch(() => setHost(null))
      .finally(() => setTabReady(true))
  }, [])

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    void saveSettings(patch).then(setSettings)
  }

  const siteOff = useMemo(
    () => (host ? isAllowlisted(host, settings.allowlist) : false),
    [host, settings.allowlist],
  )
  const onYouTube = host ? siteKindFor(host) === 'youtube' : false

  const toggleSite = (on: boolean) => {
    if (!host) return
    update({
      allowlist: on
        ? removeFromAllowlist(host, settings.allowlist)
        : addToAllowlist(host, settings.allowlist),
    })
  }

  const visibleToggles = TOGGLE_META.filter((meta) => {
    if (showAll) return true
    // Lead with what applies here; the rest is one click away.
    return onYouTube ? YOUTUBE_KEYS.includes(meta.key) : meta.key === 'genericAds'
  })

  const blocked = stats.pruned + stats.skipped
  const active = settings.enabled && !siteOff

  return (
    <div className="popup">
      <header className="head">
        <span className="mark" />
        <h1>
          OC Ad Bye-Pass
          <span className="sub"> · {blocked > 0 ? `${formatCount(blocked)}건 차단` : '광고 차단'}</span>
        </h1>
        <Switch
          label="전체 켜기/끄기"
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
      </header>

      {!settings.enabled && (
        <div className="banner warn">전체가 꺼져 있습니다. 어느 사이트에서도 동작하지 않습니다.</div>
      )}

      {settings.enabled && tabReady && (
        <div className={`site${siteOff ? ' off' : ''}`}>
          <div className="site-text">
            <span className="site-host">{host ?? '이 페이지'}</span>
            <span className="site-state">
              {!host
                ? '확장이 동작할 수 없는 페이지입니다'
                : siteOff
                  ? '이 사이트에서 꺼져 있습니다'
                  : onYouTube
                    ? '유튜브 — 3계층 전부 동작 중'
                    : '광고망 차단 + 광고 자리 숨김'}
            </span>
          </div>
          {host && (
            <Switch
              label={`${host} 에서 켜기/끄기`}
              checked={!siteOff}
              onChange={toggleSite}
            />
          )}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{formatCount(stats.pruned)}</b>
          <span>차단한 광고 요청</span>
        </div>
        <div className="stat">
          <b>{formatCount(stats.skipped)}</b>
          <span>자동 스킵·닫기</span>
        </div>
      </div>

      <div className="list">
        {visibleToggles.map((meta) => (
          <div key={meta.key} className={`row${active ? '' : ' disabled'}`}>
            <span className="text">
              <span className="label">{meta.label}</span>
              <span className="hint">{meta.hint}</span>
            </span>
            {meta.layer ? (
              <span className="layer" title={`${meta.layer}계층`}>
                L{meta.layer}
              </span>
            ) : (
              // Not a blocking layer — these change what YouTube does rather
              // than what it shows. A layer badge there would be a lie.
              <span className="layer opt" title="차단 계층이 아닌 기능">
                APP
              </span>
            )}
            <Switch
              label={meta.label}
              checked={settings.toggles[meta.key]}
              disabled={!active}
              onChange={(v) => update({ toggles: { ...settings.toggles, [meta.key]: v } })}
            />
          </div>
        ))}
      </div>

      <div className="foot">
        <button onClick={() => setShowAll((v) => !v)}>
          <Icon name="layers" />
          {showAll ? '이 사이트 항목만' : '전체 항목 보기'}
        </button>
        <button onClick={() => void openSettings()}>
          <Icon name="settings" />
          설정
        </button>
        <button
          onClick={() => {
            setCopied(false)
            void collect().then(setReport)
          }}
        >
          <Icon name="stethoscope" />
          진단
        </button>
      </div>

      {report && (
        <div className="diag">
          <pre>{format(report)}</pre>
          <button
            onClick={() => {
              // The point of the panel is getting this text to someone else.
              void navigator.clipboard
                .writeText(format(report))
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            {copied ? '복사했습니다' : '복사'}
          </button>
        </div>
      )}
    </div>
  )
}
