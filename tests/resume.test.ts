// The iPhone leaving sequence, played out in node.
//
// There is no phone in this loop. The failure this whole feature keeps hitting —
// a video that will not stay stopped, or sound that dies a few seconds after
// leaving — is a sequence of `pause` events under `document.hidden`, and that
// sequence can be scripted. This is the harness that was asked for: emulate what
// iOS does to the media, run the real decision over it, and assert the outcome.
//
// It drives src/isolated/resume.ts, the pure state machine background playback
// makes its one call from. The events are exactly what the DOM would deliver:
// visibilitychange (hidden/visible), timeupdate (playing), and pause.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initialResumeState,
  reduceResume,
  type ResumeEvent,
  type ResumeState,
} from '../src/isolated/resume.ts'

/**
 * A tiny model of what iOS does to a playing <video>, and what our resume does
 * back. Each `play()` is recorded; the test asserts on whether the video ends
 * playing or paused.
 */
class Phone {
  private state: ResumeState = initialResumeState()
  private clock = 1_000_000
  playing = true
  resumes = 0

  private tick(ms = 100): void {
    this.clock += ms
  }

  private send(event: ResumeEvent): void {
    const { state, resume } = reduceResume(this.state, event)
    this.state = state
    if (resume) {
      this.playing = true
      this.resumes += 1
    }
  }

  /** The video plays — starts if it was paused, and timeupdate keeps firing. */
  play(seconds = 3): this {
    this.playing = true
    for (let i = 0; i < seconds; i += 1) {
      this.tick(1000)
      this.send({ type: 'playing', at: this.clock })
    }
    return this
  }

  /** The app goes to the background; the engine stops the media as it does. */
  leave(): this {
    this.send({ type: 'hidden' })
    this.tick(50) // the engine's stop lands just after, still fresh
    this.playing = false
    this.send({ type: 'pause', at: this.clock })
    return this
  }

  /** The user presses pause on the lock screen, some time into the absence. */
  pressPause(afterSeconds = 20): this {
    this.tick(afterSeconds * 1000)
    this.playing = false
    this.send({ type: 'pause', at: this.clock })
    return this
  }

  /** The engine stops the media again while still backgrounded (if it does). */
  engineStopsAgain(afterSeconds = 8): this {
    this.tick(afterSeconds * 1000)
    this.playing = false
    this.send({ type: 'pause', at: this.clock })
    return this
  }

  /** Back to the front. */
  returnToApp(): this {
    this.send({ type: 'visible' })
    return this
  }
}

test('나가면 엔진이 세운 것을 한 번 되살린다 — 소리 이어짐', () => {
  const p = new Phone().play().leave()
  assert.equal(p.playing, true, '나간 순간의 멈춤을 되살리지 못했다')
  assert.equal(p.resumes, 1)
})

test('되살린 뒤 사용자가 멈추면 그대로 둔다 — 무한재생 없음', () => {
  const p = new Phone().play().leave().pressPause(20)
  assert.equal(p.playing, false, '사용자가 누른 정지를 되살렸다 (무한재생)')
  assert.equal(p.resumes, 1, '되살리기는 나갈 때 한 번뿐이어야 한다')
})

test('사용자가 멈춘 뒤 또 눌러도 계속 멈춰 있다', () => {
  const p = new Phone().play().leave().pressPause(20).pressPause(5)
  assert.equal(p.playing, false)
  assert.equal(p.resumes, 1)
})

test('돌아왔다 다시 나가면 그 이탈은 새로 되살린다', () => {
  const p = new Phone().play().leave().pressPause(20).returnToApp().play().leave()
  assert.equal(p.playing, true, '두 번째 이탈에서 되살리지 못했다')
  assert.equal(p.resumes, 2)
})

test('보고 있는 중의 정지는 절대 안 건드린다', () => {
  // hidden 이 아닌 상태에서의 pause — 사용자가 화면 보며 누른 것.
  const p = new Phone().play()
  ;(p as unknown as { send: (e: ResumeEvent) => void }) // no-op typing guard
  // leave 없이 pause 를 흉내내려면 상태를 직접 만들 수 없으니, 보이는 상태의 규칙은
  // 리듀서로 직접 확인한다.
  const s: ResumeState = { hidden: false, spent: false, lastPlayingAt: 1000 }
  assert.equal(reduceResume(s, { type: 'pause', at: 1100 }).resume, false)
})

test('한참 전에 멈춰 재생이 끊긴 뒤의 정지는 되살리지 않는다', () => {
  // lastPlayingAt 이 오래됐다 — 되살릴 재생이 없었다.
  const s: ResumeState = { hidden: true, spent: false, lastPlayingAt: 1000 }
  assert.equal(reduceResume(s, { type: 'pause', at: 1000 + 5000 }).resume, false)
})

// 엔진이 백그라운드에서 몇 초마다 또 세운다면, "한 번만" 규칙은 그 두 번째에서
// 소리를 끊는다. 이 테스트가 그 경우를 드러낸다 — 지금은 사용자 보고("이어재생은
// 된다")를 믿어 실패로 두지 않지만, 폰에서 소리가 중간에 끊기면 이 가정이 틀린
// 것이고 여기서부터 다시 설계한다.
test('가정: 엔진은 나갈 때 한 번만 세운다 (틀리면 여기가 깨진다)', () => {
  const p = new Phone().play().leave().engineStopsAgain(8)
  // 지금 설계에서는 두 번째 엔진 정지를 사용자 것으로 보고 안 되살린다.
  assert.equal(p.resumes, 1)
  assert.equal(
    p.playing,
    false,
    '엔진이 다시 세우면 이 설계는 소리를 끊는다 — 폰에서 확인되면 재설계 신호',
  )
})
