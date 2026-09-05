import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  TOGGLE_META,
  loadSettings,
  loadStats,
  parseCustomRules,
  saveSettings,
  watchSettings,
  type Settings,
  type Stats,
} from '../shared/settings.ts'
import { applyLangToDocument, makeT } from '../shared/i18n.ts'
import { PICKER_KEY, type PickerRequest } from '../shared/messages.ts'
import {
  addToAllowlist,
  hostFromUrl,
  isAllowlisted,
  removeFromAllowlist,
  siteKindFor,
} from '../shared/sites.ts'
import { SKIP_CATEGORIES, type SkipCategory } from '../shared/sponsorblock.ts'
import { Icon } from '../ui/Icon.tsx'
import { Switch } from '../ui/Switch.tsx'
import { App as SettingsView } from '../options/App.tsx'
import { collect, format, type Report } from './diagnose.ts'
import { needsPipButton, pipButtonFacts } from '../ui/device.ts'
import { formatCount } from '../ui/format.ts'


/** Network (DNR) blocking ships only in the Chrome/Edge package, not Orion. */
const HAS_NETWORK_BLOCKING = typeof chrome.declarativeNetRequest !== 'undefined'

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
  const [showBlocked, setShowBlocked] = useState(false)

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
  // `lang` and `dir` belong to the document, and the document outlives every
  // render — an Arabic UI laid out left to right is the whole language wasted.
  useEffect(() => applyLangToDocument(settings.lang), [settings.lang])

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    void saveSettings(patch).then(setSettings)
  }

  /*
   * Tick one category, without losing the one ticked a moment ago.
   *
   * A checkbox replaces the whole list, and the list it starts from is the one
   * this render closed over. Ticking four in a row faster than the storage
   * round trip meant each new list was built from a snapshot taken before the
   * previous save landed, and the last writer won: four clicks, two categories.
   * Measured, not feared.
   *
   * So the change is expressed as "add or remove this one" and applied to
   * whatever is stored at the moment it runs, and the writes are queued behind
   * each other rather than raced. `queue` is a ref because it must survive the
   * re-render each save causes — a state variable would be the same bug again.
   *
   * `update` above cannot be used for this: it merges a patch into the render's
   * own copy of the settings, which is exactly the stale snapshot at issue.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const toggleCategory = (category: SkipCategory) => {
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        const current = await loadSettings()
        const has = current.sponsorCategories.includes(category)
        setSettings(
          await saveSettings({
            // Rebuilt in the declared order rather than pushed onto, so the
            // stored list reads the same however it was arrived at.
            sponsorCategories: SKIP_CATEGORIES.filter((c) =>
              c === category ? !has : current.sponsorCategories.includes(c),
            ) as SkipCategory[],
          }),
        )
      })
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

  // The popup runs in the same browser as the page, so what it reads here is
  // what the content script will read there.
  const pipApplies = useMemo(() => needsPipButton(pipButtonFacts()), [])

  const visibleToggles = TOGGLE_META.filter((meta) => {
    // Not hidden behind "show all" — absent. A switch for a button this browser
    // never draws would be a switch that does nothing, and that is worse than
    // no switch: someone turns it on, sees nothing, and files it as broken.
    if (meta.key === 'pipButton' && !pipApplies) return false
    if (showAll) return true
    // Lead with what applies here; the rest is one click away.
    return onYouTube ? !meta.everywhere : !!meta.everywhere
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
        <button
          type="button"
          className="stat stat-btn"
          onClick={() => {
            setReport(null)
            setShowBlocked((v) => !v)
          }}
          aria-expanded={showBlocked}
        >
          <b>{formatCount(stats.pruned, settings.lang)}</b>
          <span>{t('popup.stat.pruned')}</span>
        </button>
        <div className="stat">
          <b>{formatCount(stats.skipped, settings.lang)}</b>
          <span>{t('popup.stat.skipped')}</span>
        </div>
      </div>

      {showBlocked && (
        <div className="diag blocked">
          <div className="blk-top">
            <div className="blk-host">{host ?? t('popup.blocked.nohost')}</div>
            <button
              type="button"
              className="blk-x"
              aria-label={t('popup.blocked.close')}
              onClick={() => setShowBlocked(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          {!host ? (
            <p className="blk-note">{t('popup.blocked.nohost')}</p>
          ) : siteOff ? (
            <p className="blk-note">{t('popup.blocked.off')}</p>
          ) : (
            <>
              <div className="blk-label">{t('popup.blocked.applying')}</div>
              <ul className="blk-list">
                {HAS_NETWORK_BLOCKING && <li>{t('popup.blocked.network')}</li>}
                {onYouTube ? (
                  <li>{t('popup.blocked.youtube')}</li>
                ) : (
                  settings.toggles.genericAds && <li>{t('popup.blocked.slots')}</li>
                )}
                {settings.lang === 'ko' && settings.toggles.genericAds && (
                  <li>{t('popup.blocked.krlist')}</li>
                )}
                {settings.toggles.cookieBanners && <li>{t('popup.blocked.cookies')}</li>}
                {settings.toggles.popups && <li>{t('popup.blocked.popups')}</li>}
                {parseCustomRules(settings.customRules).length > 0 && (
                  <li>
                    {t('popup.blocked.custom', {
                      n: parseCustomRules(settings.customRules).length,
                    })}
                  </li>
                )}
              </ul>
              <p className="blk-hint">{t('popup.blocked.hint')}</p>
            </>
          )}
          {host && (
            <div className="diag-actions">
              <button
                className={`blk-exempt${siteOff ? '' : ' primary'}`}
                onClick={() => toggleSite(siteOff)}
              >
                <Icon name={siteOff ? 'undo' : 'site'} />
                {siteOff ? t('popup.blocked.unexempt') : t('popup.blocked.exempt')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="list">
        {visibleToggles.map((meta) => (
          <Fragment key={meta.key}>
          <div className={`row${active ? '' : ' disabled'}`} data-key={meta.key}>
            <span className="text">
              <span className="label">{t(`toggle.${meta.key}.label`)}</span>
              <span className="hint">{t(`toggle.${meta.key}.hint`)}</span>
            </span>
            {/* `meta.layer ?` would be wrong: layer 0 is a real layer — it is
                the network one in the README's own diagram — and falsy. */}
            {meta.layer !== undefined ? (
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
          {/* The switch above says whether segments are skipped; this says
              which kinds. It used to be a card on the settings view, one press
              away, which turned a single decision into two screens — and the
              boxes were dead until the switch was on, so the two halves had to
              be done in a fixed order, in that order only.

              Both halves are here now, and the list stays editable whatever the
              switch is doing. Choosing what you would skip before you skip
              anything is the ordinary way round, and the switch is close enough
              to read that nothing has to be said about what it is set to. */}
          {meta.key === 'sponsorSkip' && (
            /* Folded, because nine rows of it is most of the list and this is
               set once and left. `details` rather than a state variable and a
               chevron: the browser already owns the marker, the keyboard
               behaviour and the aria, and none of that is worth rewriting.

               Shut, it still says what it is doing — the count, then the kinds
               that are ticked, on one line that ellipsises. That is the thing
               you would open it to find out, and it costs no new wording in 52
               languages to say it with the names already there. */
            /* Dimmed and disabled with the rest of the list when the extension
               or this site is off — that is the list's own on/off, not the
               sponsor switch's, and the fold is the one control that ignored
               it. It still does not care about the sponsor switch itself. */
            <details className={`sponsor-cats${active ? '' : ' disabled'}`}>
              <summary>
                <span className="sponsor-count">
                  {settings.sponsorCategories.length}/{SKIP_CATEGORIES.length}
                </span>
                <span className="sponsor-chosen">
                  {SKIP_CATEGORIES.filter((c) => settings.sponsorCategories.includes(c))
                    .map((c) => t(`opt.sponsor.cat.${c}`))
                    .join(', ')}
                </span>
              </summary>
              {SKIP_CATEGORIES.map((category) => (
                <label key={category} className="sponsor-cat">
                  <input
                    type="checkbox"
                    checked={settings.sponsorCategories.includes(category)}
                    disabled={!active}
                    onChange={() => toggleCategory(category)}
                  />
                  <span>{t(`opt.sponsor.cat.${category}`)}</span>
                </label>
              ))}
            </details>
          )}
          </Fragment>
        ))}
      </div>

      <div className="foot">
        <button onClick={() => setShowAll((v) => !v)}>
          <Icon name="layers" />
          {showAll ? t('popup.foot.thisSiteOnly') : t('popup.foot.allItems')}
        </button>
        <button
          disabled={!host}
          title={host ? undefined : t('popup.pick.cannot')}
          onClick={() => {
            // The picker draws on the page, so the popup gets out of the way.
            void chrome.tabs
              .query({ active: true, currentWindow: true })
              .then(([tab]) => {
                if (!tab?.url) return
                const request: PickerRequest = { url: tab.url, at: Date.now() }
                return chrome.storage.local.set({ [PICKER_KEY]: request })
              })
              .catch(() => {})
              .finally(() => window.close())
          }}
        >
          <Icon name="target" />
          {t('popup.foot.pick')}
        </button>
        <button onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
          {t('popup.foot.settings')}
        </button>
        <button
          onClick={() => {
            setShowBlocked(false)
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
