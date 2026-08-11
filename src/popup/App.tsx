import { useEffect, useState } from 'react'
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
import { Switch } from '../ui/Switch.tsx'
import { formatCount, isYouTubeUrl } from '../ui/format.ts'

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS)
  const [onYouTube, setOnYouTube] = useState<boolean | null>(null)

  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadStats().then(setStats)
    // The activeTab permission lets us see the URL of the tab that was active
    // when the popup opened — and nothing else. We never request the broader
    // tabs permission, so other tabs' URLs stay invisible to us.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setOnYouTube(isYouTubeUrl(tab?.url)))
      .catch(() => setOnYouTube(null))
  }, [])

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    void saveSettings(patch).then(setSettings)
  }

  const toggle = (key: ToggleKey, value: boolean) =>
    update({ toggles: { ...settings.toggles, [key]: value } })

  return (
    <div className="popup">
      <header className="head">
        <span className="mark" />
        <h1>
          OC Ad Bye-Pass
          <span className="sub"> · 유튜브 전용</span>
        </h1>
        <Switch
          label="전체 켜기/끄기"
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
      </header>

      {onYouTube === false && (
        <div className="banner">지금 탭은 유튜브가 아닙니다. 이 확장은 유튜브에서만 동작합니다.</div>
      )}
      {!settings.enabled && <div className="banner warn">차단이 꺼져 있습니다.</div>}

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
        {TOGGLE_META.map((meta) => (
          <div key={meta.key} className={`row${settings.enabled ? '' : ' disabled'}`}>
            <span className="text">
              <span className="label">{meta.label}</span>
              <span className="hint">{meta.hint}</span>
            </span>
            <span className="layer" title={`${meta.layer}계층`}>
              L{meta.layer}
            </span>
            <Switch
              label={meta.label}
              checked={settings.toggles[meta.key]}
              disabled={!settings.enabled}
              onChange={(v) => toggle(meta.key, v)}
            />
          </div>
        ))}
      </div>

      <div className="foot">
        <button onClick={() => chrome.runtime.openOptionsPage()}>규칙·고급 설정</button>
      </div>
    </div>
  )
}
