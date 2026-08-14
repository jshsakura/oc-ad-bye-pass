import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  TOGGLE_META,
  loadSettings,
  loadStats,
  saveSettings,
  watchSettings,
  type Settings,
  type Stats,
  type ToggleKey,
} from '../shared/settings.ts'
import { makeT } from '../shared/i18n.ts'
import {
  addToAllowlist,
  hostFromUrl,
  isAllowlisted,
  removeFromAllowlist,
  siteKindFor,
} from '../shared/sites.ts'
import { Icon } from '../ui/Icon.tsx'
import { Switch } from '../ui/Switch.tsx'
import { App as SettingsView } from '../options/App.tsx'
import { collect, format, type Report } from './diagnose.ts'
import { formatCount } from '../ui/format.ts'

/** Toggles that only mean anything on a video site we have all three layers for. */
const YOUTUBE_KEYS: ToggleKey[] = TOGGLE_META.map((m) => m.key).filter((k) => k !== 'genericAds')

// The PiP button exists for the mobile web player, where the site hides the
// control and leaving the app stops the video — a phone problem. On desktop the
// browser has its own picture-in-picture and there is nothing to add, so the
// toggle only confuses. declarativeNetRequest is present only in the Chrome
// (desktop/Edge) package, so its presence is the "this is not Orion" tell.
const IS_DESKTOP = typeof chrome.declarativeNetRequest !== 'undefined'

export function App() {
  /*
   * Settings live in the popup, not behind it.
   *
   * They were a page, opened with `openOptionsPage` and a fallback that opens the
   * file as a tab. On a phone that tab arrives with no browser chrome around it,
   * so there was nothing to close it with — and the button that was added for
   * that took two presses, because the first one only handed focus back.
   *
   * There is no second window to manage if there is no second window.
   */
  const [showSettings, setShowSettings] = useState(false)
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
    // Keep in step with the settings page shown inline below: switching the
    // language there should re-render this list too, not just on next open.
    const stop = watchSettings(setSettings)
    // activeTab lets us read the URL of the tab that was active when the popup
    // opened, and nothing else. We never request the broader tabs permission.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setHost(hostFromUrl(tab?.url)))
      .catch(() => setHost(null))
      .finally(() => setTabReady(true))
    return stop
  }, [])

  const t = useMemo(() => makeT(settings.lang), [settings.lang])

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
    // The PiP button is an Orion-only feature — never surface it on desktop.
    if (IS_DESKTOP && meta.key === 'pipButton') return false
    if (showAll) return true
    // Lead with what applies here; the rest is one click away.
    return onYouTube ? YOUTUBE_KEYS.includes(meta.key) : meta.key === 'genericAds'
  })

  const blocked = stats.pruned + stats.skipped
  const active = settings.enabled && !siteOff

  if (showSettings) {
    return (
      <div className="popup">
        <SettingsView onClose={() => setShowSettings(false)} />
      </div>
    )
  }

  return (
    <div className="popup">
      <header className="head">
        <span className="mark" />
        <h1>
          {t('app.name')}
          <span className="sub">
            {' · '}
            {blocked > 0 ? t('popup.sub.blocked', { n: formatCount(blocked, settings.lang) }) : t('popup.sub.idle')}
          </span>
        </h1>
        <Switch
          label={t('popup.master')}
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
      </header>

      {!settings.enabled && <div className="banner warn">{t('popup.master.off')}</div>}

      {settings.enabled && tabReady && (
        <div className={`site${siteOff ? ' off' : ''}`}>
          <div className="site-text">
            <span className="site-host">{host ?? t('popup.site.thisPage')}</span>
            <span className="site-state">
              {!host
                ? t('popup.site.cannotRun')
                : siteOff
                  ? t('popup.site.offHere')
                  : onYouTube
                    ? t('popup.site.youtubeAll')
                    : t('popup.site.generic')}
            </span>
          </div>
          {host && (
            <Switch
              label={t('popup.site.toggle', { host })}
              checked={!siteOff}
              onChange={toggleSite}
            />
          )}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{formatCount(stats.pruned, settings.lang)}</b>
          <span>{t('popup.stat.pruned')}</span>
        </div>
        <div className="stat">
          <b>{formatCount(stats.skipped, settings.lang)}</b>
          <span>{t('popup.stat.skipped')}</span>
        </div>
      </div>

      <div className="list">
        {visibleToggles.map((meta) => (
          <div key={meta.key} className={`row${active ? '' : ' disabled'}`}>
            <span className="text">
              <span className="label">{t(`toggle.${meta.key}.label`)}</span>
              <span className="hint">{t(`toggle.${meta.key}.hint`)}</span>
            </span>
            {meta.layer ? (
              <span className={`layer l${meta.layer}`} title={t('layer.nTitle', { n: meta.layer })}>
                L{meta.layer}
              </span>
            ) : (
              // Not a blocking layer — these change what YouTube does rather
              // than what it shows. A layer badge there would be a lie.
              <span className="layer opt" title={t('layer.appTitle')}>
                APP
              </span>
            )}
            <Switch
              label={t(`toggle.${meta.key}.label`)}
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
          {showAll ? t('popup.foot.thisSiteOnly') : t('popup.foot.allItems')}
        </button>
        <button onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
          {t('popup.foot.settings')}
        </button>
        <button
          onClick={() => {
            setCopied(false)
            void collect().then(setReport)
          }}
        >
          <Icon name="stethoscope" />
          {t('popup.foot.diagnose')}
        </button>
      </div>

      {report && (
        <div className="diag">
          <pre>{format(report)}</pre>
          <div className="diag-actions">
            <button
              onClick={() => {
                // The point of the panel is getting this text to someone else.
                void navigator.clipboard
                  .writeText(format(report))
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }}
            >
              <Icon name="copy" />
              {copied ? t('popup.diag.copied') : t('popup.diag.copy')}
            </button>
            <button
              onClick={() => {
                setReport(null)
                setCopied(false)
              }}
            >
              <Icon name="close" />
              {t('popup.diag.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
