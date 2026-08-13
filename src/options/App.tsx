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
  checkForUpdate,
  downloadUrlFor,
  packageForThisBuild,
  type UpdateCheck,
} from '../shared/update.ts'
import { formatWhen } from '../ui/format.ts'

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

  // Checked on open, once. The page is where someone goes when they want to
  // know, and a version banner they have to ask for is a version banner nobody
  // sees.
  useEffect(() => {
    void checkForUpdate().then(setUpdate)
  }, [])

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
      setNote('올바른 주소가 아닙니다.')
      return
    }
    setBusy(true)
    setNote(null)
    try {
      if (needsPermission) {
        const granted = await requestOrigin(urlOrigin)
        if (!granted) {
          setNote(
            '이 주소를 쓸 권한을 얻지 못했습니다. 브라우저가 권한 요청을 지원하지 않는 경우도 있습니다 — ' +
              '기본 주소나 jshsakura.github.io 주소는 권한 없이 바로 됩니다.',
          )
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
    setNote('통계를 초기화했습니다.')
  }

  return (
    <div className="page">
      <div className="page-top">
        <h1>OC Ad Bye-Pass 설정</h1>
        {/*
          On a phone this page has no browser chrome around it — Orion opens it as
          the whole screen, and there was no way back out of it at all. `close()`
          only works on a window a script opened, so history is the fallback and
          the popup's own page is the last resort.
        */}
        <button
          className="close"
          type="button"
          aria-label="설정 닫기"
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
          닫기
        </button>
      </div>
      {update?.newer && (
        <div className="banner update">
          <span>
            새 버전 <b>v{update.latest}</b> 이 있습니다 (지금 v{update.current})
          </span>
          <a className="btn-primary" href={downloadUrlFor(packageForThisBuild())}>
            <Icon name="download" />
            내려받기
          </a>
        </div>
      )}
      <p className="lede">
        차단 규칙은 확장 안에 기본값이 들어 있고, 아래 필터 리스트를 더해서 씁니다. 영상 사이트가
        태그를 바꿔도 리스트만 갱신되면 재설치 없이 반영됩니다.
      </p>

      <section className="card">
        <h2>
          <Icon name="version" />
          버전
        </h2>
        <p className="desc">
          이 확장은 스스로 업데이트하지 못합니다 — 파일로 설치한 확장을 다시 설치해 주는 API 가
          브라우저에 없습니다. 대신 새 버전이 나왔는지 확인하고 받는 데까지는 해 드립니다.
          받은 뒤에는 Extensions 에서 기존 것을 지우고 다시 넣으시면 됩니다.
        </p>

        <dl className="kv">
          <dt>지금 버전</dt>
          <dd>v{chrome.runtime.getManifest().version}</dd>
          <dt>최신 버전</dt>
          <dd>
            {update === null
              ? '확인 전'
              : update.latest
                ? `v${update.latest}${update.newer ? ' — 새 버전' : ' — 최신입니다'}`
                : (update.error ?? '확인하지 못했습니다')}
          </dd>
        </dl>

        <div className="actions">
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
            {checking ? '확인 중…' : '업데이트 확인'}
          </button>
          {update?.newer && (
            <a className="btn-link" href={downloadUrlFor(packageForThisBuild())}>
              <Icon name="download" />
              {`oc-ad-bye-pass-${packageForThisBuild()}.zip 받기`}
            </a>
          )}
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="list" />
          필터 리스트
        </h2>
        <p className="desc">
          JSON 규칙을 30분마다 받아옵니다. 받아오는 것은 셀렉터 같은{' '}
          <b>데이터뿐</b>이고 스크립트는 실행하지 않습니다. 형식·크기·안전성 검사를 통과하지
          못하면 버리고 기존 규칙을 그대로 씁니다.
        </p>

        <div className="row" style={{ padding: '0 0 14px' }}>
          <span className="text">
            <span className="label">원격 리스트 사용</span>
            <span className="hint">끄면 확장에 내장된 기본 규칙만 씁니다</span>
          </span>
          <Switch
            label="원격 리스트 사용"
            checked={settings.listEnabled}
            onChange={(v) => void persist({ listEnabled: v })}
          />
        </div>

        <label className="field" htmlFor="listUrl">
          리스트 주소
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
            {needsPermission && urlDraft !== settings.listUrl ? '권한 허용하고 저장' : '저장하고 갱신'}
          </button>
          <button onClick={() => void updateNow()} disabled={busy || !settings.listEnabled}>
            <Icon name="refresh" />
            지금 업데이트
          </button>
          <button
            onClick={() => {
              setUrlDraft(DEFAULT_LIST_URL)
              void persist({ listUrl: DEFAULT_LIST_URL })
            }}
            disabled={busy || urlDraft === DEFAULT_LIST_URL}
          >
            기본값으로
          </button>
        </div>

        {needsPermission && (
          <p className="status error" style={{ marginTop: 10 }}>
            GitHub 이 아닌 주소입니다. 리스트 제공자는 보고 있는 화면의 요소를 숨길 수 있으니 믿을 수
            있는 곳만 쓰세요.
          </p>
        )}

        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>현재 소스</dt>
          <dd>{status?.source === 'remote' ? '원격 리스트' : '내장 기본 규칙'}</dd>
          <dt>버전</dt>
          <dd>{status?.version ?? '—'}</dd>
          <dt>마지막 갱신</dt>
          <dd>{formatWhen(status?.fetchedAt ?? null)}</dd>
          {!!status?.dropped && (
            <>
              <dt>걸러낸 규칙</dt>
              <dd>{status.dropped}개 (안전 검사 불통과)</dd>
            </>
          )}
        </dl>
        {status?.error && <p className="status error">{status.error}</p>}
        {note && <p className="status">{note}</p>}
      </section>

      <section className="card">
        <h2>
          <Icon name="rules" />
          내 규칙
        </h2>
        <p className="desc">
          한 줄에 CSS 셀렉터 하나. 여기 적은 것은 항상 적용되고 원격 업데이트에 덮이지 않습니다.
          <code> ! </code>로 시작하는 줄은 주석입니다. 안 사라지는 광고를 직접 찍어 넣는 곳입니다
          (개발자도구에서 요소 선택 → Copy selector).
        </p>
        <textarea
          value={rulesDraft}
          spellCheck={false}
          onChange={(e) => setRulesDraft(e.currentTarget.value)}
          placeholder={'! 예시\nytd-ad-slot-renderer\n#masthead-ad'}
        />
        <div className="actions">
          <button
            className="primary"
            onClick={() => void persist({ customRules: rulesDraft })}
            disabled={rulesDraft === settings.customRules || badRules.length > 0}
          >
            저장
          </button>
          {badRules.length > 0 ? (
            <span className="status error">
              쓸 수 없는 셀렉터 {badRules.length}개: {badRules.slice(0, 3).join(', ')}
            </span>
          ) : (
            <span className="status">
              {parseCustomRules(rulesDraft).length}개 규칙
              {rulesDraft !== settings.customRules ? ' · 저장하지 않음' : ''}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="site" />
          이 사이트에서 끄기 목록
        </h2>
        <p className="desc">
          여기 적힌 사이트에서는 확장이 완전히 손을 뗍니다 — 광고망 차단도, 요소 숨김도 하지
          않습니다. 하위 도메인까지 함께 적용됩니다. 사이트를 끄는 것은 확장 아이콘을 눌러
          그 자리에서 할 수 있고, 여기서는 목록을 정리합니다.
        </p>

        {settings.allowlist.length === 0 ? (
          <p className="status">아직 없습니다. 어느 사이트에서도 켜져 있습니다.</p>
        ) : (
          <ul className="hosts">
            {settings.allowlist.map((host) => (
              <li key={host}>
                <span>{host}</span>
                <button
                  onClick={() => void persist({ allowlist: removeFromAllowlist(host, settings.allowlist) })}
                >
                  다시 켜기
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
            추가
          </button>
        </div>
      </section>

      <section className="card">
        <h2>
          <Icon name="chart" />
          통계
        </h2>
        <p className="desc">확장 아이콘 배지에 표시되는 누적 차단 수입니다.</p>
        <div className="actions">
          <button onClick={() => void resetStats()}>
            <Icon name="undo" />
            통계 초기화
          </button>
        </div>
      </section>
    </div>
  )
}
