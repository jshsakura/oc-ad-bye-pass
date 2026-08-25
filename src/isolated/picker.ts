// The element picker — point at something, get a rule.
//
// This exists because the settings page used to tell people to open devtools
// and use "Copy selector". That instruction is fine for the handful of readers
// who would have written the rule anyway, and it is the end of the road for
// everyone else — which is most of the people who install an ad blocker and
// then find one thing it misses.
//
// It runs in the ISOLATED world: it needs `chrome.storage` to save the rule,
// and it needs to be unreachable by the page's own scripts, which the isolated
// world gives for free.
//
// **Nothing here is styled by the page.** The overlay lives in a closed shadow
// root with `all: initial` at the top, because it has to look the same on a
// site whose stylesheet sets `* { box-sizing: border-box }` and on one that
// sets `div { display: none }`. A picker that a page can restyle is a picker
// that vanishes on exactly the sites somebody needed it for.

import { isSafeSelector } from '../shared/filterlist.ts'
import { candidateSelectors, nameableAncestor } from '../shared/picker.ts'
import { makeT, type Lang } from '../shared/i18n.ts'
import { MAX_CUSTOM_RULES_CHARS, loadSettings, saveSettings } from '../shared/settings.ts'

const HOST_ID = 'oc-ad-bye-pass-picker'

/** Above everything. Sites do use the top of the range, so we take the very top. */
const Z = 2147483647

interface Session {
  host: HTMLElement
  root: ShadowRoot
  box: HTMLElement
  label: HTMLElement
  bar: HTMLElement
  selectorText: HTMLElement
  countText: HTMLElement
  t: ReturnType<typeof makeT>
  /** The element the rule is currently about. Null while still hovering. */
  chosen: Element | null
  /** Candidates for `chosen`, and where we are in them. Widening walks this. */
  chain: Element[]
  chainIndex: number
}

let session: Session | null = null

const CSS = `
:host { all: initial; }
.box {
  position: fixed;
  pointer-events: none;
  z-index: ${Z};
  border: 2px solid #7c5cff;
  background: rgba(124, 92, 255, .14);
  border-radius: 3px;
  transition: all .05s linear;
}
.label {
  position: fixed;
  pointer-events: none;
  z-index: ${Z};
  max-width: 60vw;
  padding: 3px 7px;
  border-radius: 5px;
  background: #7c5cff;
  color: #fff;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: ${Z};
  width: min(560px, calc(100vw - 24px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #16161c;
  color: #f4f4f6;
  border: 1px solid #34343e;
  box-shadow: 0 10px 40px rgba(0, 0, 0, .45);
  font: 400 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.hint { color: #a0a0ad; font-size: 12px; }
.sel {
  font: 600 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
  color: #cbb9ff;
}
.count { color: #a0a0ad; font-size: 11px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  flex: 1;
  min-width: 88px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid #34343e;
  background: #22222b;
  color: #f4f4f6;
  font: 600 13px/1 inherit;
  cursor: pointer;
}
button:hover { border-color: #7c5cff; }
button:disabled { opacity: .45; cursor: default; }
button.primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
`

function usable(selector: string): boolean {
  return isSafeSelector(selector)
}

function countFor(selector: string): number {
  try {
    return document.querySelectorAll(selector).length
  } catch {
    return 0
  }
}

/** The element's ancestor chain, from itself outward, stopping before <body>. */
function chainFor(element: Element): Element[] {
  const chain: Element[] = []
  let node: Element | null = element
  while (node && node !== document.body && node !== document.documentElement) {
    chain.push(node)
    node = node.parentElement
  }
  return chain
}

function selectorAt(session: Session): string | null {
  const element = session.chain[session.chainIndex]
  if (!element) return null
  return candidateSelectors(element).find(usable) ?? null
}

function place(target: Element, session: Session): void {
  const rect = target.getBoundingClientRect()
  const { box, label } = session
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
  box.style.display = 'block'

  // Above the box, unless the box is at the top of the screen.
  const above = rect.top > 22
  label.style.left = `${Math.max(4, rect.left)}px`
  label.style.top = above ? `${rect.top - 20}px` : `${rect.bottom + 4}px`
  label.style.display = 'block'
}

function hideBox(session: Session): void {
  session.box.style.display = 'none'
  session.label.style.display = 'none'
}

function render(session: Session): void {
  const { t } = session
  const selector = selectorAt(session)
  const element = session.chain[session.chainIndex]

  if (!selector || !element) {
    session.selectorText.textContent = t('picker.noSelector')
    session.countText.textContent = ''
    hideBox(session)
  } else {
    session.selectorText.textContent = selector
    session.countText.textContent = t('picker.matches', { n: countFor(selector) })
    // The floating tag says what is about to be written, right where the eye
    // already is. The bar at the bottom repeats it for the case where the
    // element is at the top of a tall page and the two are far apart.
    session.label.textContent = selector
    place(element, session)
  }

  const save = session.root.querySelector<HTMLButtonElement>('[data-act="save"]')
  const wider = session.root.querySelector<HTMLButtonElement>('[data-act="wider"]')
  const narrower = session.root.querySelector<HTMLButtonElement>('[data-act="narrower"]')
  if (save) save.disabled = !selector
  if (wider) wider.disabled = session.chainIndex >= session.chain.length - 1
  if (narrower) narrower.disabled = session.chainIndex <= 0
}

/**
 * What is under the pointer, ignoring ourselves.
 *
 * The overlay is `pointer-events: none`, so `elementFromPoint` looks straight
 * through it — but the shadow host still answers for itself on some engines,
 * hence the explicit skip.
 */
function targetAt(x: number, y: number): Element | null {
  const element = document.elementFromPoint(x, y)
  if (!element || element.id === HOST_ID) return null
  if (element === document.documentElement || element === document.body) return null
  return element
}

// --- events ------------------------------------------------------------------
//
// All in capture, all cancelling. While the picker is up, the page must not see
// the pointer at all: one stray click on a link and the page navigates, taking
// the picker and the user's place on the page with it.

function onPointerMove(event: PointerEvent | MouseEvent): void {
  if (!session || session.chosen) return
  const target = targetAt(event.clientX, event.clientY)
  if (!target) return hideBox(session)
  session.chain = chainFor(target)
  // Point at what carries a name, not at the bare <span> inside it.
  const named = nameableAncestor(target, usable)
  session.chainIndex = named ? Math.max(0, session.chain.indexOf(named.element)) : 0
  render(session)
}

function onClick(event: MouseEvent): void {
  if (!session) return
  // Inside our own bar: let the button handler have it.
  if (event.composedPath().includes(session.host)) return
  event.preventDefault()
  event.stopPropagation()
  const target = targetAt(event.clientX, event.clientY)
  if (!target) return
  session.chain = chainFor(target)
  const named = nameableAncestor(target, usable)
  session.chainIndex = named ? Math.max(0, session.chain.indexOf(named.element)) : 0
  session.chosen = target
  render(session)
}

function swallow(event: Event): void {
  if (!session) return
  if (event.composedPath().includes(session.host)) return
  event.preventDefault()
  event.stopPropagation()
}

/**
 * The same four actions the buttons perform.
 *
 * Not an afterthought: on a desktop the whole interaction is at the pointer,
 * and reaching for a bar pinned to the bottom of the window to widen by one
 * level is the part that makes a picker tedious. Escape and Enter are also the
 * only way to drive this from a test, since the overlay is in a closed shadow
 * root that nothing outside can reach into.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (!session) return
  const act = KEYS[event.key]
  if (!act) return
  event.preventDefault()
  event.stopPropagation()
  perform(act)
}

const KEYS: Record<string, Action> = {
  Escape: 'cancel',
  Enter: 'save',
  ArrowUp: 'wider',
  ArrowLeft: 'wider',
  ArrowDown: 'narrower',
  ArrowRight: 'narrower',
}

const CAPTURE = { capture: true } as const

function bind(on: boolean): void {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('pointermove', onPointerMove as EventListener, CAPTURE)
  window[method]('mousemove', onPointerMove as EventListener, CAPTURE)
  window[method]('click', onClick as EventListener, CAPTURE)
  // The page must not act on the press either — plenty of sites navigate on
  // mousedown, and a swallowed click would not save them from that.
  window[method]('mousedown', swallow, CAPTURE)
  window[method]('pointerdown', swallow, CAPTURE)
  window[method]('touchstart', swallow, CAPTURE)
  window[method]('keydown', onKeyDown as EventListener, CAPTURE)
}

// --- lifecycle ---------------------------------------------------------------

async function saveRule(selector: string): Promise<void> {
  const settings = await loadSettings()
  const lines = settings.customRules.split('\n')
  if (lines.some((line) => line.trim() === selector)) return
  const next = settings.customRules ? `${settings.customRules.replace(/\n+$/, '')}\n${selector}` : selector
  // Silently truncating somebody's rules would be worse than refusing, and the
  // settings page is where a full list can actually be pruned.
  if (next.length > MAX_CUSTOM_RULES_CHARS) throw new Error('rules full')
  await saveSettings({ customRules: next })
}

type Action = 'wider' | 'narrower' | 'save' | 'cancel'

function perform(act: Action): void {
  const active = session
  if (!active) return
  if (act === 'cancel') return stopPicker()
  if (act === 'wider' && active.chainIndex < active.chain.length - 1) {
    active.chainIndex++
    active.chosen = active.chain[active.chainIndex]
    return render(active)
  }
  if (act === 'narrower' && active.chainIndex > 0) {
    active.chainIndex--
    active.chosen = active.chain[active.chainIndex]
    return render(active)
  }
  if (act === 'save') {
    const selector = selectorAt(active)
    if (!selector) return
    void saveRule(selector)
      .then(() => stopPicker())
      .catch(() => {
        active.selectorText.textContent = active.t('picker.full')
      })
  }
}

export function stopPicker(): void {
  if (!session) return
  bind(false)
  session.host.remove()
  session = null
}

export function startPicker(lang: Lang): void {
  if (session) return

  const t = makeT(lang)
  const host = document.createElement('div')
  host.id = HOST_ID
  // The host itself must not intercept anything; the bar re-enables it.
  host.style.cssText = 'all: initial; position: static;'
  const root = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = CSS
  root.appendChild(style)

  const box = document.createElement('div')
  box.className = 'box'
  box.style.display = 'none'

  const label = document.createElement('div')
  label.className = 'label'
  label.style.display = 'none'

  const bar = document.createElement('div')
  bar.className = 'bar'
  bar.style.pointerEvents = 'auto'
  bar.innerHTML = `
    <div class="hint"></div>
    <div class="sel"></div>
    <div class="count"></div>
    <div class="row">
      <button data-act="wider"></button>
      <button data-act="narrower"></button>
    </div>
    <div class="row">
      <button data-act="save" class="primary"></button>
      <button data-act="cancel"></button>
    </div>
  `
  root.append(box, label, bar)
  document.documentElement.appendChild(host)

  bar.querySelector('.hint')!.textContent = t('picker.hint')
  bar.querySelector<HTMLButtonElement>('[data-act="wider"]')!.textContent = t('picker.wider')
  bar.querySelector<HTMLButtonElement>('[data-act="narrower"]')!.textContent = t('picker.narrower')
  bar.querySelector<HTMLButtonElement>('[data-act="save"]')!.textContent = t('picker.save')
  bar.querySelector<HTMLButtonElement>('[data-act="cancel"]')!.textContent = t('picker.cancel')

  session = {
    host,
    root,
    box,
    label,
    bar,
    selectorText: bar.querySelector('.sel')!,
    countText: bar.querySelector('.count')!,
    t,
    chosen: null,
    chain: [],
    chainIndex: 0,
  }

  bar.addEventListener('click', (event) => {
    const act = (event.target as HTMLElement).closest('button')?.dataset.act
    if (!act) return
    event.stopPropagation()
    perform(act as Action)
  })

  render(session)
  bind(true)
}
