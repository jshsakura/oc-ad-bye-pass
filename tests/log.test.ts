// 폭주가 자기 앞의 기록을 지우지 못하게 하는 것.
//
// 로그는 DOM 속성에 든 1800자 링버퍼다. 페이지가 정지되는 순간에도 살아남는 것이
// 그것뿐이라서 그렇게 돼 있고, 대신 짧다. 2026-08-12 실기기에서 두 세계가 서로를
// 부르는 고리가 돌면서 같은 두 줄이 1밀리초 안에 수십 쌍 쌓였고, 링버퍼가 그
// 앞의 모든 줄을 밀어냈다 — 폭주는 보이는데 무엇이 폭주를 시작시켰는지는 지워진 채로.
//
// 고리 자체는 고쳤다. 이건 다음 고리가 증거까지 가져가지 못하게 하는 쪽이다.

import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * 최소한의 documentElement.
 *
 * log.ts 는 브라우저 밖에서 import 될 수 있어야 한다는 이유로 이미 `document` 를
 * 함수 안에서만 만진다. 여기서 세워주는 것은 속성 하나짜리 가짜다.
 */
function stubDocument(): { attributes: Map<string, string> } {
  const attributes = new Map<string, string>()
  const element = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value)
    },
  }
  ;(globalThis as unknown as { document: unknown }).document = { documentElement: element }
  return { attributes }
}

const { attributes } = stubDocument()
const { log, readLog } = await import('../src/shared/log.ts')

const lines = () => (readLog() ?? '').split('\n').filter(Boolean)

test('같은 줄이 반복되면 한 줄과 횟수로 접힌다', () => {
  attributes.clear()
  log('시작')
  for (let i = 0; i < 200; i += 1) log('삼킴 → 다시 알림')
  log('끝')

  const written = lines()
  // 시작 · 삼킴 · "위 줄 199번 더" · 끝
  assert.equal(written.length, 4)
  assert.ok(written[1]?.includes('삼킴 → 다시 알림'))
  assert.ok(written[2]?.includes('199번 더'))
  assert.ok(written[3]?.includes('끝'))
})

test('폭주가 그 앞의 기록을 밀어내지 못한다', () => {
  attributes.clear()
  log('나가는 손짓: 위로 22px')
  for (let i = 0; i < 500; i += 1) log('배경재생: visibilitychange 삼킴')

  // 접기 전에는 500줄이 1800자 버퍼를 세 번 넘게 채우고도 남았다.
  assert.ok(readLog()?.includes('나가는 손짓'), '증거가 폭주에 밀려 사라졌다')
})

test('서로 다른 줄은 그대로 남는다 — 접는 것은 연속된 같은 줄뿐이다', () => {
  // 세지 못한 반복은 다음 줄이 올 때 비워진다. 실제 페이지에서는 속성이 비워지는
  // 일이 없으니 상관없지만, 여기서는 앞 시험이 남긴 것을 먼저 흘려보내야 한다.
  log('앞 시험 정리')
  attributes.clear()
  log('가')
  log('나')
  log('가')
  assert.equal(lines().length, 3)
})

// 읽기는 두 벌을 합친다 — 쓰기는 이제 한 벌뿐이어도.
//
// 페이지의 localStorage 에 매 줄 쓰는 것은 그만뒀다(플레이어가 죽었고, 그 무렵
// 페이지를 건드리기 시작한 것 중 하나가 이것이었다). 읽는 쪽은 그대로 둔다 —
// 옛 빌드가 남긴 꼬리를 버릴 이유가 없고, 겹치는 줄은 접고 한쪽에만 있는 줄은
// 살려야 한다.
test('옛 빌드가 남긴 기록도 같이 읽고, 겹치는 줄은 한 번만 나온다', () => {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
  }

  log('앞 시험 정리')
  attributes.clear()

  log('둘 다 본 줄')
  const written = attributes.get('data-oc-abp-log') ?? ''
  // 옛 빌드가 남겨둔 것: 같은 줄 하나와, 그 빌드에만 있던 줄 하나.
  store.set('oc-abp-log', `${written}\n${written.slice(0, 12)} 옛 빌드에만`)

  const merged = (readLog() ?? '').split('\n').filter(Boolean)
  assert.equal(merged.filter((l) => l.includes('둘 다 본 줄')).length, 1, '겹친 줄이 두 번 나왔다')
  assert.equal(merged.filter((l) => l.includes('옛 빌드에만')).length, 1, '옛 기록이 사라졌다')

  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
})
