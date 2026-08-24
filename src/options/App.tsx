import { useEffect, useMemo, useState } from 'react'
import { isSafeSelector } from '../shared/filterlist.ts'
import type { FilterStatus, RuntimeRequest } from '../shared/messages.ts'
import {
  DEFAULT_LIST_URL,
  DEFAULT_SETTINGS,
  STATS_KEY,
  loadSettings,
  parseCustomRules,
  saveSettings,
  type Settings,
} from '../shared/settings.ts'
import { normalizeHost, removeFromAllowlist } from '../shared/sites.ts'
import { Icon } from '../ui/Icon.tsx'
import { Switch } from '../ui/Switch.tsx'
import {
  SOURCE_URL,
  STORE_URL,
  checkForUpdate,
  isStoreInstall,
  releasePageFor,
  type UpdateCheck,
} from '../shared/update.ts'
import { formatWhen } from '../ui/format.ts'
import { LANGS, LANG_LABEL, makeT } from '../shared/i18n.ts'

const GRANTED_BY_DEFAULT = ['https://raw.githubusercontent.com', 'https://gist.githubusercontent.com']

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function ask(request: RuntimeRequest): Promise<FilterStatus> {
  return chrome.runtime.sendMessage(request) as Promise<FilterStatus>
}

/**
 * Ask for one origin, and survive browsers that cannot be asked.
 *
 * The Orion package ships without `optional_host_permissions` — it is one of
 * the keys stripped to get the thing to install at all — so this request has
 * nowhere to go there. It can reject, or resolve false, or not exist. All three
 * mean the same thing to the user, and the message below says it.
 */
async function requestOrigin(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

export function App({ onClose }: { onClose?: () => void } = {}) {
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [urlDraft, setUrlDraft] = useState('')
  const [rulesDraft, setRulesDraft] = useState('')
  const [status, setStatus] = useState<FilterStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [hostDraft, setHostDraft] = useState('')

  const t = useMemo(() => makeT(settings.lang), [settings.lang])

  const storeInstall = isStoreInstall()

  // Checked on open, once. The page is where someone goes when they want to
  // know, and a version banner they have to ask for is a version banner nobody
  // sees. A store copy never checks: the browser updates it, and pointing a
  // store install at GitHub downloads is a policy risk besides.
  useEffect(() => {
    if (!storeInstall) void checkForUpdate().then(setUpdate)
  }, [storeInstall])

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s)
      setUrlDraft(s.listUrl)
      setRulesDraft(s.customRules)
    })
    void ask({ type: 'filters:status' }).then(setStatus)
  }, [])

  const badRules = useMemo(
    () => parseCustomRules(rulesDraft).filter((line) => !isSafeSelector(line)),
    [rulesDraft],
  )

  const urlOrigin = originOf(urlDraft)
  const needsPermission = !!urlOrigin && !GRANTED_BY_DEFAULT.includes(urlOrigin)

  const persist = async (patch: Partial<Settings>) => {
    setSettings(await saveSettings(patch))
  }

  const addHost = () => {
    const host = normalizeHost(hostDraft.trim().replace(/^https?:\/\//, '').split('/')[0])
    if (!host) return
    setHostDraft('')
    void persist({ allowlist: [...new Set([...settings.allowlist, host])].sort() })
  }

  const saveUrl = async () => {
    if (!urlOrigin) {
      setNote(t('opt.err.badUrl'))
      return
    }
    setBusy(true)
    setNote(null)
    try {
      if (needsPermission) {
        const granted = await requestOrigin(urlOrigin)
        if (!granted) {
          setNote(t('opt.err.noPerm'))
          return
        }
      }
      await persist({ listUrl: urlDraft })
      setStatus(await ask({ type: 'filters:update', force: true }))
    } finally {
      setBusy(false)
    }
  }

  const updateNow = async () => {
    setBusy(true)
    setNote(null)
    try {
      setStatus(await ask({ type: 'filters:update', force: true }))
    } finally {
      setBusy(false)
    }
  }

  const resetStats = async () => {
    await chrome.storage.local.set({ [STATS_KEY]: { pruned: 0, skipped: 0, since: Date.now() } })
    await chrome.action.setBadgeText({ text: '' })
    setNote(t('opt.stats.resetDone'))
  }

  return (
    <div className="page">
      <div className="page-top">
        <h1>{t('opt.title')}</h1>
        {/*
          On a phone this page has no browser chrome around it — Orion opens it as
          the whole screen, and there was no way back out of it at all. `close()`
          only works on a window a script opened, so history is the fallback and
          the popup's own page is the last resort.
        */}
        <button
          className="close"
          type="button"
          aria-label={t('opt.close.aria')}
          onClick={() => {
            // Inside the popup this is a view, not a page: closing it means going
            // back to the list, not closing anything. Only a settings page that
            // really is a page needs the window dance, and on a phone that page
            // has no chrome around it to close it with.
            if (onClose) return onClose()
            window.close()
            setTimeout(() => {
              if (history.length > 1) history.back()
              else location.replace('popup.html')
            }, 120)
          }}
        >
          <Icon name="close" />
          {t('opt.close')}
        </button>
      </div>
      {update?.newer && update.latest && (
        <div className="banner update">
          <span>{t('opt.update.available', { latest: update.latest, current: update.current })}</span>
          {/* Just open the release page in the browser — the notice hands off, it
              does not download or install anything itself. */}
          <a className="btn-primary" href={releasePageFor(update.latest)} target="_blank" rel="noopener">
            <Icon name="download" />
            {t('opt.update.download')}
          </a>
        </div>
      )}
      <p className="lede">{t('opt.lede')}</p>

      <section className="card">
        <h2>
          <Icon name="settings" />
          {t('opt.lang')}
        </h2>
        <p className="desc">{t('opt.lang.desc')}</p>
        <div className="actions">
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className={settings.lang === code ? 'primary' : ''}
              aria-pressed={settings.lang === code}
              onClick={() => void persist({ lang: code })}
            >
              {LANG_LABEL[code]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="version" />
          {t('opt.version')}
        </h2>
        <p className="desc">{storeInstall ? t('opt.version.storeDesc') : t('opt.version.desc')}</p>

        <dl className="kv">
          <dt>{t('opt.version.now')}</dt>
          <dd>v{chrome.runtime.getManifest().version}</dd>
          {!storeInstall && (
            <>
              <dt>{t('opt.version.latest')}</dt>
              <dd>
                {update === null
                  ? t('opt.version.notChecked')
                  : update.latest
                    ? update.newer
                      ? `v${update.latest}` /* the banner above announces "new"; don't repeat it */
                      : t('opt.version.upToDate', { v: update.latest })
                    : (update.error ?? t('opt.version.checkFail'))}
              </dd>
            </>
          )}
        </dl>

        <div className="actions">
          {storeInstall ? (
            /* A store copy updates itself, so there is nothing to press here —
               except the listing, which is the one page that can say what
               version the store is handing out. */
            <a className="btn-link" href={STORE_URL} target="_blank" rel="noopener">
              <Icon name="external" />
              {t('opt.version.store')}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                setChecking(true)
                void checkForUpdate()
                  .then(setUpdate)
                  .finally(() => setChecking(false))
              }}
              disabled={checking}
            >
              <Icon name="refresh" />
              {checking ? t('opt.version.checking') : t('opt.version.check')}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="list" />
          {t('opt.list')}
        </h2>
        <p className="desc">{t('opt.list.desc')}</p>

        <div className="row" style={{ padding: '0 0 14px' }}>
          <span className="text">
            <span className="label">{t('opt.list.useRemote')}</span>
            <span className="hint">{t('opt.list.useRemoteHint')}</span>
          </span>
          <Switch
            label={t('opt.list.useRemote')}
            checked={settings.listEnabled}
            onChange={(v) => void persist({ listEnabled: v })}
          />
        </div>

        <label className="field" htmlFor="listUrl">
          {t('opt.list.url')}
        </label>
        <input
          id="listUrl"
          type="url"
          value={urlDraft}
          spellCheck={false}
          onChange={(e) => setUrlDraft(e.currentTarget.value)}
          placeholder={DEFAULT_LIST_URL}
        />

        <div className="actions">
          <button className="primary" onClick={() => void saveUrl()} disabled={busy || urlDraft === ''}>
            <Icon name="save" />
            {needsPermission && urlDraft !== settings.listUrl ? t('opt.list.savePerm') : t('opt.list.save')}
          </button>
          <button onClick={() => void updateNow()} disabled={busy || !settings.listEnabled}>
            <Icon name="refresh" />
            {t('opt.list.updateNow')}
          </button>
          <button
            onClick={() => {
              setUrlDraft(DEFAULT_LIST_URL)
              void persist({ listUrl: DEFAULT_LIST_URL })
            }}
            disabled={busy || urlDraft === DEFAULT_LIST_URL}
          >
            {t('opt.list.default')}
          </button>
        </div>

        {needsPermission && (
          <p className="status error" style={{ marginTop: 10 }}>
            {t('opt.list.notGithub')}
          </p>
        )}

        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>{t('opt.list.source')}</dt>
          <dd>{status?.source === 'remote' ? t('opt.list.remote') : t('opt.list.builtin')}</dd>
          <dt>{t('opt.list.version')}</dt>
          <dd>{status?.version ?? '—'}</dd>
          <dt>{t('opt.list.lastUpdate')}</dt>
          <dd>{formatWhen(status?.fetchedAt ?? null, t)}</dd>
          {!!status?.dropped && (
            <>
              <dt>{t('opt.list.dropped')}</dt>
              <dd>{t('opt.list.droppedVal', { n: status.dropped })}</dd>
            </>
          )}
        </dl>
        {status?.error && <p className="status error">{status.error}</p>}
        {note && <p className="status">{note}</p>}
      </section>

      <section className="card">
        <h2>
          <Icon name="rules" />
          {t('opt.rules')}
        </h2>
        <p className="desc">
          {t('opt.rules.desc.a')} <code> ! </code>
          {t('opt.rules.desc.b')}
        </p>
        <textarea
          value={rulesDraft}
          spellCheck={false}
          onChange={(e) => setRulesDraft(e.currentTarget.value)}
          placeholder={'! ytd-ad-slot-renderer\n#masthead-ad'}
        />
        <div className="actions">
          <button
            className="primary"
            onClick={() => void persist({ customRules: rulesDraft })}
            disabled={rulesDraft === settings.customRules || badRules.length > 0}
          >
            {t('opt.rules.save')}
          </button>
          {badRules.length > 0 ? (
            <span className="status error">
              {t('opt.rules.bad', { n: badRules.length, list: badRules.slice(0, 3).join(', ') })}
            </span>
          ) : (
            <span className="status">
              {t('opt.rules.count', { n: parseCustomRules(rulesDraft).length })}
              {rulesDraft !== settings.customRules ? t('opt.rules.unsaved') : ''}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="site" />
          {t('opt.siteOff')}
        </h2>
        <p className="desc">{t('opt.siteOff.desc')}</p>

        {settings.allowlist.length === 0 ? (
          <p className="status">{t('opt.siteOff.empty')}</p>
        ) : (
          <ul className="hosts">
            {settings.allowlist.map((host) => (
              <li key={host}>
                <span>{host}</span>
                <button
                  onClick={() => void persist({ allowlist: removeFromAllowlist(host, settings.allowlist) })}
                >
                  {t('opt.siteOff.reenable')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="actions">
          <input
            type="text"
            value={hostDraft}
            spellCheck={false}
            placeholder="example.com"
            onChange={(e) => setHostDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addHost()
            }}
          />
          <button onClick={addHost} disabled={!hostDraft.trim()}>
            <Icon name="plus" />
            {t('opt.siteOff.add')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="chart" />
          {t('opt.stats')}
        </h2>
        <p className="desc">{t('opt.stats.desc')}</p>
        <div className="actions">
          <button onClick={() => void resetStats()}>
            <Icon name="undo" />
            {t('opt.stats.reset')}
          </button>
        </div>
      </section>

      {/* The repo, on its own line and away from the version card. It is where
          the code and the issues are — not an update route — and mixing it into
          the update block is what made the two read as the same thing. */}
      <div className="page-foot">
        <span>{t('opt.foot.source')}</span>
        <a href={SOURCE_URL} target="_blank" rel="noopener">
          {t('opt.foot.sourceLink')}
          <Icon name="external" />
        </a>
      </div>
    </div>
  )
}
