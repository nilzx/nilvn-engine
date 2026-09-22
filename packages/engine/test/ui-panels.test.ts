// @vitest-environment jsdom
// Batch I inc 5 — declarative UI: `[ui.<id>]` panels (HUD / window, five
// widgets, bindings, show policies, `[ui show|hide|toggle]`, saves), events that
// are script commands (`runInline`), `[hotspot]` and `[sprite … onclick=]`, and
// `ui:<id>` entries on the menu and the title page.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, type Engine } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
  ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve()
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, baseUrl: 'http://g.test/', catalogs: { en: { 'ui.aff': 'Affection', 'ui.day': 'Day {$day}', 'ui.status': 'Status', 'ui.none': 'nothing', 'ui.close': 'Close' } }, ...opts })
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
const panel = (e: Engine, id: string): HTMLElement | null => e.stage.root.querySelector<HTMLElement>(`.nilvn-ui[data-id="${id}"]`)
const shown = (e: Engine, id: string): boolean => !!panel(e, id) && panel(e, id)!.style.display !== 'none'

const UI = {
  affection: {
    kind: 'hud',
    anchor: 'top-right',
    widgets: [
      { type: 'bar', var: 'affection', max: 10, label: '@ui.aff' },
      { type: 'text', text: '@ui.day' },
      { type: 'text', var: 'mood' },
      { type: 'image', src: '@ui/heart.png', if: 'affection >= 5' },
    ],
  },
  status: {
    kind: 'window',
    title: '@ui.status',
    show: 'manual',
    widgets: [
      { type: 'list', var: 'items', empty: '@ui.none' },
      { type: 'button', label: '@ui.close', onclick: 'ui hide status' },
      { type: 'button', label: 'Go', onclick: '[set went = 1]\n[jump there]' },
    ],
  },
} as const

describe('[ui.<id>] panels', () => {
  it('draws a HUD from widgets bound to variables and re-renders on every change; if hides a widget', async () => {
    const e = engineWith()
    applyConfig(e, { ui: UI as never })
    expect(panel(e, 'affection')!.className).toBe('nilvn-ui nilvn-ui--hud nilvn-ui--top-right')
    expect(shown(e, 'affection')).toBe(false) // show = playing: hidden in idle
    e.loadSource('[set affection = 3]\n[set day = 2]\n[set mood = "calm"]\nnarr: one\n[set affection = 7]\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    const p = panel(e, 'affection')!
    expect(shown(e, 'affection')).toBe(true)
    expect(p.querySelector<HTMLElement>('.nilvn-ui__bar-fill')!.style.width).toBe('30%')
    expect(p.querySelector('.nilvn-ui__bar-label')!.textContent).toBe('Affection')
    expect([...p.querySelectorAll('.nilvn-ui__text')].map((t) => t.textContent)).toEqual(['Day 2', 'calm'])
    expect(p.querySelector('.nilvn-ui__image')).toBeNull()
    e.stage.root.click()
    await until(() => text(e) === 'two')
    expect(p.querySelector<HTMLElement>('.nilvn-ui__bar-fill')!.style.width).toBe('70%')
    expect(p.querySelector<HTMLImageElement>('.nilvn-ui__image')!.src).toBe('http://g.test/@ui/heart.png')
    await e.showTitle()
    expect(shown(e, 'affection')).toBe(false)
    e.destroy()
    expect(document.querySelector('.nilvn-ui')).toBeNull()
  })

  it('a manual window shows on [ui show], a button runs its onclick, the list has an empty text; unknown ids and anchors report', async () => {
    const e = engineWith()
    applyConfig(e, { ui: { ...UI, odd: { anchor: 'sideways', show: 'sometimes' } } as never })
    expect(e.diagnostics.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringContaining('[ui.odd] unknown anchor "sideways"'), expect.stringContaining('[ui.odd] unknown show "sometimes"')]))
    e.loadSource('[ui show status]\nnarr: one\n[ui toggle nothing]\n[set items = "sword, shield"]\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    const w = panel(e, 'status')!
    expect(shown(e, 'status')).toBe(true)
    expect(w.className).toBe('nilvn-ui nilvn-ui--window nilvn-ui--center')
    expect(w.querySelector('.nilvn-ui__title')!.textContent).toBe('Status')
    expect(w.querySelector('.nilvn-ui__empty')!.textContent).toBe('nothing')
    e.stage.root.click()
    await until(() => text(e) === 'two')
    expect([...w.querySelectorAll('.nilvn-ui__list li')].map((li) => li.textContent)).toEqual(['sword', 'shield'])
    expect(e.diagnostics.some((d) => d.message.includes('[ui] unknown panel "nothing"'))).toBe(true)
    const close = [...w.querySelectorAll<HTMLButtonElement>('.nilvn-ui__button')].find((b) => b.textContent === 'Close')!
    close.click()
    await until(() => !shown(e, 'status'))
    e.destroy()
  })

  it('a title-page window closes from its own button — a click runs panel and variable commands with no story running, nothing else', async () => {
    const e = engineWith()
    applyConfig(e, { ui: UI as never, title: { buttons: ['new', 'ui:status'] } } as never)
    e.loadSource('narr: one\n')
    await e.showTitle()
    expect(e.session).toBe('title')
    await e.runInline('[ui show status]')
    expect(shown(e, 'status')).toBe(true)
    const close = [...panel(e, 'status')!.querySelectorAll<HTMLButtonElement>('.nilvn-ui__button')].find((b) => b.textContent === 'Close')!
    close.click()
    await until(() => !shown(e, 'status'))
    await e.runInline('[set went = 1]\n[jump there]', 'button')
    expect(e.vars.went).toBe(1)
    expect(e.session).toBe('title')
    expect(e.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('button: [jump] needs a running story ("[jump there]")')])
    e.destroy()
  })

  it('a button that moves the playhead releases the parked line; the show decisions ride in the save', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    applyConfig(e, { ui: UI as never })
    e.loadSource('[ui show status]\nnarr: parked\n[set after = 1]\n[label there]\nnarr: there\n')
    void e.start()
    await until(() => text(e) === 'parked')
    const save = e.saveState()
    expect(save.ui).toEqual({ status: true })
    const go = [...panel(e, 'status')!.querySelectorAll<HTMLButtonElement>('.nilvn-ui__button')].find((b) => b.textContent === 'Go')!
    go.click()
    await until(() => text(e) === 'there')
    expect(e.vars.went).toBe(1)
    expect(e.vars.after).toBeUndefined() // jumped past it
    e.ui.hide('status')
    expect(await e.restoreState(save)).toBe(true)
    await until(() => text(e) === 'parked')
    expect(shown(e, 'status')).toBe(true)
    e.destroy()
  })

  it('ui:<id> entries join the menu and the title page, toggling the panel', async () => {
    const e = engineWith({ menu: { items: ['save', 'ui:status', 'ui:missing'] }, title: { buttons: ['new', 'ui:status'] } })
    applyConfig(e, { ui: UI as never })
    e.refreshMenu()
    const items = [...e.stage.root.querySelectorAll<HTMLButtonElement>('.nilvn-menu__item')].map((b) => b.textContent)
    expect(items).toContain('Status')
    expect(e.diagnostics.some((d) => d.message.includes('[menu] unknown item "ui:missing"'))).toBe(true)
    e.loadSource('narr: x\n')
    await e.showTitle()
    const btn = [...e.stage.root.querySelectorAll<HTMLButtonElement>('.nilvn-screen__button')].find((b) => b.textContent === 'Status')!
    expect(btn).toBeDefined()
    btn.click()
    expect(shown(e, 'status')).toBe(true) // manual: shown whenever asked, even on the title page
    btn.click()
    expect(shown(e, 'status')).toBe(false)
    e.destroy()
  })
})

describe('hotspots and clickable sprites', () => {
  it('[hotspot] puts a clickable region in the world that runs commands; if= hides; remove / clear; saved and restored', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    e.loadSource('[hotspot shop x=10 y=20 w=25 h=30 onclick="set visited = 1"]\n[hotspot gone x=0 y=0 w=5 h=5 onclick="set x = 1" if=day > 1]\nnarr: map\n[hotspot remove shop]\nnarr: gone\n[hotspot clear]\n')
    void e.start()
    await until(() => text(e) === 'map')
    const hs = e.stage.root.querySelector<HTMLElement>('.nilvn-hotspot[data-id="shop"]')!
    expect(hs.style.cssText).toContain('left: 10%')
    expect(hs.style.width).toBe('25%')
    expect(e.stage.root.querySelector('.nilvn-hotspot[data-id="gone"]')).toBeNull()
    const save = e.saveState()
    expect(save.stage.hotspots).toEqual([{ id: 'shop', x: 10, y: 20, w: 25, h: 30, onclick: 'set visited = 1' }])
    hs.click()
    await until(() => e.vars.visited === 1)
    expect(text(e)).toBe('map') // no playhead move: still parked
    e.stage.root.click()
    await until(() => text(e) === 'gone')
    expect(e.stage.root.querySelector('.nilvn-hotspot')).toBeNull()
    expect(await e.restoreState(save)).toBe(true)
    await until(() => text(e) === 'map')
    expect(e.stage.root.querySelector('.nilvn-hotspot[data-id="shop"]')).not.toBeNull()
    e.destroy()
  })

  it('a sprite with onclick takes clicks; runInline reports a bad line and, outside a session, runs only panel / variable commands', async () => {
    const e = engineWith()
    await e.stage.showSprite('star', { url: 'http://g.test/s.png', frames: 1, fps: 1, loop: true, onclick: '[set hit = 1]\n[bogus line' }, 0)
    const el = e.stage.root.querySelector<HTMLElement>('.nilvn-sprite[data-id="star"]')!
    expect(el.classList.contains('nilvn-clickable')).toBe(true)
    expect(e.stage.snapshot().sprites?.[0]?.onclick).toBe('[set hit = 1]\n[bogus line')
    el.click()
    await until(() => e.vars.hit === 1) // a variable write runs even before the story does
    e.setVar('hit', 0)
    e.loadSource('narr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    el.click()
    await until(() => e.vars.hit === 1)
    await tick(20) // the second line runs after the first's await
    expect(e.diagnostics.some((d) => d.message.includes('unknown command [[bogus]'))).toBe(true)
    e.destroy()
  })
})
