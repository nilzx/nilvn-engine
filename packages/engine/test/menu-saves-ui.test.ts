// @vitest-environment jsdom
// The system menu's save-slot screen: the old menu plugin's localStorage saves
// migrate into the store, page tabs, saving into a slot (metadata + the engine's
// own overwrite confirm), loading back, deleting, the autosave / quick cells.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createEngine, type Engine } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
  // Neither Node's experimental localStorage nor this jsdom provides a working
  // Storage — install an in-memory one so the default store is exercised.
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub })
})
beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}
// jsdom has an empty document.title → the work id falls back to 'game'.
const slotKey = (i: number): string => `nilvn:game:slot:${i}`

async function playedEngine(): Promise<{ engine: Engine; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.append(container)
  const engine = createEngine({ container, textSpeed: 0, saves: { autosave: false } })
  engine.loadSource('[label start]\nyuki: Hello line one\nyuki: Second line')
  void engine.start()
  await until(() => engine.getBacklog().length === 1)
  return { engine, container }
}
const item = (c: HTMLElement, label: string, e: Engine): HTMLButtonElement => [...c.querySelectorAll<HTMLButtonElement>('.nilvn-menu__item')].find((b) => b.textContent === e.t(label))!
const slots = (c: HTMLElement): HTMLButtonElement[] => [...c.querySelectorAll<HTMLButtonElement>('.nilvn-saves__slot')]
const panelOpen = (c: HTMLElement): boolean => c.querySelector('.nilvn-panel--saves')!.classList.contains('on')
const modalButton = (c: HTMLElement, id: 'ok' | 'cancel'): HTMLButtonElement => c.querySelector<HTMLButtonElement>(`.nilvn-modal [data-id="${id}"]`)!

describe('save slots', () => {
  it('migrates the menu plugin\'s localStorage saves into the store (a bare legacy state gets wrapped)', async () => {
    localStorage.setItem('nilvn:save:game:0', '{"v":2,"at":{"label":"start","offset":0},"legacy":true}')
    localStorage.setItem('nilvn:save:game:3', JSON.stringify({ v: 1, savedAt: 5, preview: 'old', state: { v: 2, at: { label: 'start', offset: 0 } } }))
    const { engine, container } = await playedEngine()
    expect(localStorage.getItem('nilvn:save:game:0')).toBeNull()
    expect(JSON.parse(localStorage.getItem(slotKey(0))!)).toMatchObject({ v: 1, state: { legacy: true } })
    expect(JSON.parse(localStorage.getItem(slotKey(3))!)).toMatchObject({ v: 1, preview: 'old' })
    item(container, 'ui.menu.load', engine).click()
    await until(() => slots(container).length > 0)
    const cells = slots(container).filter((s) => !s.classList.contains('nilvn-saves__slot--special'))
    expect(cells.length).toBe(10)
    expect(cells[0]!.classList.contains('has-data')).toBe(true)
    expect(cells[1]!.classList.contains('has-data')).toBe(false)
    expect(cells[3]!.classList.contains('has-data')).toBe(true)
    engine.destroy()
  })

  it('saving into a slot writes metadata + state; overwrite asks through the engine\'s own confirm', async () => {
    const { engine, container } = await playedEngine()
    item(container, 'ui.menu.save', engine).click()
    await until(() => panelOpen(container) && slots(container).length === 10)
    expect(slots(container).some((s) => s.classList.contains('nilvn-saves__slot--special'))).toBe(false) // save mode: no auto / quick cells
    slots(container)[2]!.click()
    await until(() => localStorage.getItem(slotKey(2)) !== null)
    const raw = localStorage.getItem(slotKey(2))!
    const payload = JSON.parse(raw) as { v: number; savedAt: number; preview: string; state: { v: number } }
    expect(payload.v).toBe(1)
    expect(payload.preview).toContain('Hello line one')
    expect(payload.state.v).toBe(2)
    await until(() => slots(container)[2]!.classList.contains('has-data'))
    // Overwrite: the in-engine modal — declined leaves the slot; accepted rewrites.
    slots(container)[2]!.click()
    await until(() => container.querySelector('.nilvn-modal') !== null)
    modalButton(container, 'cancel').click()
    await tick()
    expect(localStorage.getItem(slotKey(2))).toBe(raw)
    expect(container.querySelector('.nilvn-modal')).toBeNull()
    await tick()
    slots(container)[2]!.click()
    await until(() => container.querySelector('.nilvn-modal') !== null)
    modalButton(container, 'ok').click()
    await until(() => localStorage.getItem(slotKey(2)) !== raw)
    engine.destroy()
  })

  it('page tabs address later slots (page 2 slot 1 = slot 10)', async () => {
    const { engine, container } = await playedEngine()
    item(container, 'ui.menu.save', engine).click()
    await until(() => slots(container).length === 10)
    container.querySelectorAll<HTMLButtonElement>('.nilvn-saves__page')[1]!.click()
    await until(() => slots(container)[0]?.querySelector('.nilvn-saves__no')?.textContent === '2-1')
    slots(container)[0]!.click()
    await until(() => localStorage.getItem(slotKey(10)) !== null)
    expect(localStorage.getItem(slotKey(0))).toBeNull()
    engine.destroy()
  })

  it('loading an occupied slot restores that session; deleting asks and clears it', async () => {
    const { engine, container } = await playedEngine()
    item(container, 'ui.menu.save', engine).click()
    await until(() => slots(container).length === 10)
    slots(container)[0]!.click()
    await until(() => localStorage.getItem(slotKey(0)) !== null)
    container.querySelector<HTMLButtonElement>('.nilvn-panel--saves .nilvn-backlog__close')!.click()
    engine.vars.progress = 'later'
    item(container, 'ui.menu.load', engine).click()
    await until(() => slots(container).length === 12) // auto + quick + 10
    const cell = slots(container).find((s) => s.querySelector('.nilvn-saves__no')?.textContent === '1-1')!
    expect(cell.classList.contains('has-data')).toBe(true)
    cell.click()
    await until(() => engine.vars.progress === undefined)
    await until(() => !panelOpen(container))
    // Delete: ✕ on the occupied cell → confirm → gone.
    item(container, 'ui.menu.load', engine).click()
    await until(() => slots(container).length === 12)
    slots(container).find((s) => s.querySelector('.nilvn-saves__no')?.textContent === '1-1')!.querySelector<HTMLButtonElement>('.nilvn-saves__del')!.click()
    await until(() => container.querySelector('.nilvn-modal') !== null)
    modalButton(container, 'ok').click()
    await until(() => localStorage.getItem(slotKey(0)) === null)
    engine.destroy()
  })

  it('clicking an empty slot in load mode is inert; the auto and quick cells show what the engine wrote', async () => {
    const { engine, container } = await playedEngine()
    expect(await engine.quickSave()).toBe(true)
    item(container, 'ui.menu.load', engine).click()
    await until(() => slots(container).length === 12)
    const specials = slots(container).filter((s) => s.classList.contains('nilvn-saves__slot--special'))
    expect(specials.map((s) => s.classList.contains('has-data'))).toEqual([false, true]) // autosave off, quick written
    slots(container)[7]!.click()
    await tick()
    expect(panelOpen(container)).toBe(true)
    expect(engine.getBacklog().length).toBe(1)
    engine.destroy()
  })
})
