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
import { Switch } from '../ui/Switch.tsx'
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

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [urlDraft, setUrlDraft] = useState('')
  const [rulesDraft, setRulesDraft] = useState('')
  const [status, setStatus] = useState<FilterStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

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

  const saveUrl = async () => {
    if (!urlOrigin) {
      setNote('올바른 주소가 아닙니다.')
      return
    }
    setBusy(true)
    setNote(null)
    try {
      if (needsPermission) {
        const granted = await chrome.permissions.request({ origins: [`${urlOrigin}/*`] })
        if (!granted) {
          setNote('권한을 허용하지 않아서 이 주소는 쓸 수 없습니다.')
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
      <h1>OC Ad Bye-Pass 설정</h1>
      <p className="lede">
        차단 규칙은 확장 안에 기본값이 들어 있고, 아래 필터 리스트를 더해서 씁니다. 유튜브가
        태그를 바꿔도 리스트만 갱신되면 재설치 없이 반영됩니다.
      </p>

      <section className="card">
        <h2>필터 리스트</h2>
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
            {needsPermission && urlDraft !== settings.listUrl ? '권한 허용하고 저장' : '저장하고 갱신'}
          </button>
          <button onClick={() => void updateNow()} disabled={busy || !settings.listEnabled}>
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
            GitHub 이 아닌 주소입니다. 리스트 제공자는 유튜브 화면의 요소를 숨길 수 있으니 믿을 수
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
        <h2>내 규칙</h2>
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
        <h2>통계</h2>
        <p className="desc">확장 아이콘 배지에 표시되는 누적 차단 수입니다.</p>
        <div className="actions">
          <button onClick={() => void resetStats()}>통계 초기화</button>
        </div>
      </section>
    </div>
  )
}
