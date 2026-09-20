// @vitest-environment jsdom
// Auto / skip as engine mechanisms, the read-line tracking behind skip, the
// persisted player settings, and the quick / slot save API the menu sits on.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, SETTINGS_KEY, type Engine } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, tries = 200): Promise<void> => {
  for (let i = 0; i < tries && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}
const SCRIPT = '[label s]\nyuki: one\nyuki: two\nyuki: three\n[set done = 1]\n'
function make(opts: Partial<Parameters<typeof createEngine>[0]> = {}): Engine {
  return createEngine({ container: document.createElement('div'), textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, ...opts })
}

describe('auto mode', () => {
  it('advances lines by itself after autoDelay; a tap takes the wheel back', async () => {
    const e = make({ settings: { autoDelay: 0.02 } })
    e.loadSource(SCRIPT)
    e.setAuto(true)
    expect(e.auto).toBe(true)
    const run = e.start()
    await until(() => e.vars.done === 1)
    await run
    expect(e.session).toBe('ending')
    e.loadSource(SCRIPT)
    e.setAuto(true)
    void e.start()
    await until(() => e.getBacklog().length >= 1)
    e.stage.root.dispatchEvent(new MouseEvent('click', { bubbles: true })) // a tap cancels auto
    expect(e.auto).toBe(false)
    e.destroy()
  })
})

describe('skip mode', () => {
  it('"read" passes only lines seen before and turns itself off at the first unread one', async () => {
    const e = make()
    e.loadSource(SCRIPT)
    e.setSkip(true)
    void e.start()
    await until(() => e.getBacklog().length === 1)
    await tick(80)
    expect(e.skip).toBe(false) // unread: parked on line one
    expect(e.getBacklog().length).toBe(1)
    const root = e.stage.root
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await until(() => e.getBacklog().length === 2)
    // Restart: lines one and two are read now, three is not.
    e.loadSource(SCRIPT)
    await e.restart()
    await until(() => e.getBacklog().length === 1)
    e.setSkip(true)
    await until(() => e.getBacklog().length === 3)
    await tick(80)
    expect(e.skip).toBe(false)
    expect(e.vars.done).toBeUndefined()
    e.destroy()
  })

  it('"all" passes everything; holding Ctrl skips while held', async () => {
    const e = make({ settings: { skipMode: 'all' } })
    e.loadSource(SCRIPT)
    e.setSkip(true)
    await e.start()
    expect(e.vars.done).toBe(1)
    const f = make({ settings: { skipMode: 'all' } })
    f.loadSource(SCRIPT)
    void f.start()
    await until(() => f.getBacklog().length === 1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }))
    await until(() => f.getBacklog().length === 3)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    e.destroy()
    f.destroy()
  })
})

describe('player settings persist', () => {
  it('text speed, volumes, auto delay, skip mode, ui scale and dialogue opacity come back through the store', async () => {
    const store = new MemorySaveStore()
    const a = make({ saveStore: store })
    a.textSpeed = 80
    a.setVolume('bgm', 0.5)
    a.setAutoDelay(2)
    a.setSkipMode('all')
    a.setUiScale(1.2)
    a.setDialogOpacity(0.6)
    await tick(400) // debounced write
    expect((await store.get(SETTINGS_KEY)) as object).toMatchObject({ v: 1, textSpeed: 80, autoDelay: 2, skipMode: 'all', uiScale: 1.2, dialogOpacity: 0.6, volumes: { bgm: 0.5 } })
    a.destroy()
    const b = make({ saveStore: store })
    b.loadSource('[label s]\n')
    await b.prepare()
    expect(b.textSpeed).toBe(80)
    expect(b.getVolume('bgm')).toBe(0.5)
    expect(b.autoDelay).toBe(2)
    expect(b.skipMode).toBe('all')
    expect(b.uiScale).toBe(1.2)
    expect(b.theme['ui-scale']).toBe('1.2')
    expect(b.theme['dialog-opacity']).toBe('0.6')
    b.destroy()
  })
})

describe('quick and slot saves', () => {
  it('quickSave / quickLoad and saveSlot / loadSlot round-trip; deleteSave clears', async () => {
    const e = make()
    e.loadSource('[label s]\n[set x = 1]\nyuki: hi\n[set x = 2]\nyuki: bye\n')
    void e.start()
    await until(() => e.getBacklog().length === 1)
    expect(await e.quickSave()).toBe(true)
    expect(await e.saveSlot(4)).toBe(true)
    e.stage.root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await until(() => e.vars.x === 2)
    expect(await e.quickLoad()).toBe(true)
    await until(() => e.vars.x === 1)
    expect((await e.readSave('slot:4'))?.preview).toBe('yuki: hi')
    await e.deleteSave('slot:4')
    expect(await e.loadSlot(4)).toBe(false)
    expect(await e.readSave('slot:4')).toBeUndefined()
    e.destroy()
  })

  it('the engine confirm resolves per button and swallows its keys', async () => {
    const e = make()
    const p = e.stage.chrome.confirm('sure?', { ok: 'Yes', cancel: 'No' })
    const modal = e.stage.root.querySelector<HTMLElement>('.nilvn-modal')!
    expect(modal.querySelector('.nilvn-modal__msg')!.textContent).toBe('sure?')
    modal.querySelector<HTMLButtonElement>('[data-id="ok"]')!.click()
    expect(await p).toBe(true)
    expect(e.stage.root.querySelector('.nilvn-modal')).toBeNull()
    const q = e.stage.chrome.confirm('again?', { ok: 'Yes', cancel: 'No' })
    e.stage.root.querySelector<HTMLElement>('.nilvn-modal')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await q).toBe(false)
    e.destroy()
  })
})
