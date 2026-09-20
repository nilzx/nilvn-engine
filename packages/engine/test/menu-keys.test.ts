// @vitest-environment jsdom
// The shell's keyboard (`[keys]` / `createEngine({ keys })`): the defaults drive
// the menu's actions, a config rebinds or unbinds them, text fields keep their
// keys, and the actions exist only while the menu does. Plus the text-speed
// slider: linear in cps, its top notch = instant.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, matchKey, parseBinding, type Engine } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, tries = 200): Promise<void> => {
  for (let i = 0; i < tries && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}
const SCRIPT = '[label s]\n[set x = 1]\nyuki: one\n[set x = 2]\nyuki: two\nyuki: three\n'
function make(opts: Partial<Parameters<typeof createEngine>[0]> = {}): Engine {
  const container = document.createElement('div')
  document.body.append(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, ...opts })
}
async function playing(opts: Partial<Parameters<typeof createEngine>[0]> = {}): Promise<Engine> {
  const e = make(opts)
  e.loadSource(SCRIPT)
  void e.start()
  await until(() => e.getBacklog().length === 1)
  return e
}
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window): boolean =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

describe('binding format', () => {
  it('parses key names, aliases and modifier prefixes; matches events accordingly', () => {
    expect(parseBinding('Space')).toEqual([{ key: ' ', ctrl: false, shift: false, alt: false, meta: false }])
    expect(parseBinding(['Ctrl+S', 'F5'])).toHaveLength(2)
    expect(parseBinding(false)).toEqual([])
    expect(parseBinding('+')).toEqual([]) // no key
    expect(parseBinding('Ctrl+')).toEqual(parseBinding('Control')) // a trailing modifier is the key itself
    const ev = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key, ...init })
    expect(matchKey('a', ev('a'))).toBe(true)
    expect(matchKey('a', ev('A', { shiftKey: true }))).toBe(true) // shift only matters when named
    expect(matchKey('a', ev('a', { ctrlKey: true }))).toBe(false) // an unnamed Ctrl must be up
    expect(matchKey('Ctrl+a', ev('a', { ctrlKey: true }))).toBe(true)
    expect(matchKey('Shift+Space', ev(' '))).toBe(false)
    expect(matchKey('Control', ev('Control', { ctrlKey: true }))).toBe(true) // a modifier as the key itself
    expect(matchKey(['Esc', 'q'], ev('Escape'))).toBe(true)
    expect(matchKey(undefined, ev('a'))).toBe(false)
  })
})

describe('default keys', () => {
  it('a / Tab toggle auto and skip, F5 / F9 quick save and load (and are consumed), Space still advances', async () => {
    const e = await playing()
    expect(press('a')).toBe(false) // preventDefault → dispatchEvent returns false
    expect(e.auto).toBe(true)
    press('a')
    expect(e.auto).toBe(false)
    expect(press('F5')).toBe(false)
    await until(() => e.stage.root.querySelector('.nilvn-toast')?.textContent === e.t('ui.saves.msg.saved'))
    expect(await e.readSave('quick')).toBeDefined()
    press(' ')
    await until(() => e.vars.x === 2)
    expect(press('F9')).toBe(false)
    await until(() => e.vars.x === 1)
    press('Tab')
    expect(e.skip).toBe(true)
    press('Tab')
    expect(e.skip).toBe(false)
    e.destroy()
  })

  it('keys are ignored while a text field has focus', async () => {
    const e = await playing()
    const input = document.createElement('input')
    document.body.append(input)
    expect(press('a', {}, input)).toBe(true)
    expect(e.auto).toBe(false)
    input.remove()
    e.destroy()
  })

  it('the menu actions need the menu and a playing session; advance / Esc / Ctrl work regardless', async () => {
    const e = await playing({ screens: { menu: false } })
    press('a')
    expect(e.auto).toBe(false)
    press('F5')
    expect(await e.readSave('quick')).toBeUndefined()
    press(' ')
    await until(() => e.vars.x === 2)
    e.destroy()
  })
})

describe('[keys] config', () => {
  it('rebinds an action, binds an unbound one, and false unbinds a default', async () => {
    const e = await playing({ keys: { auto: 'Ctrl+A', quicksave: false, backlog: 'l' } })
    press('a')
    expect(e.auto).toBe(false)
    press('a', { ctrlKey: true })
    expect(e.auto).toBe(true)
    expect(press('F5')).toBe(true) // unbound: not consumed
    await tick(20)
    expect(await e.readSave('quick')).toBeUndefined()
    press('l')
    expect(e.stage.root.querySelector('.nilvn-panel--backlog')!.classList.contains('on')).toBe(true)
    e.destroy()
  })

  it('a config loaded after construction applies too (applyConfig)', async () => {
    const { applyConfig } = await import('../src/config')
    const e = await playing()
    applyConfig(e, { keys: { skip: 's' } })
    press('Tab')
    expect(e.skip).toBe(false)
    press('s')
    expect(e.skip).toBe(true)
    e.destroy()
  })
})

describe('text-speed slider', () => {
  const slider = (e: Engine): HTMLInputElement => e.stage.root.querySelector<HTMLInputElement>('.nilvn-panel--settings input[type=range]')!
  const readout = (e: Engine): string => e.stage.root.querySelector('.nilvn-panel--settings .nilvn-menu__pct')!.textContent ?? ''
  const drag = (input: HTMLInputElement, v: number): void => {
    input.value = String(v)
    input.dispatchEvent(new Event('input'))
  }

  it('is linear in cps over [10, 100] by default and its top notch is instant (textSpeed 0)', async () => {
    const e = await playing()
    e.textSpeed = 40
    e.openMenu('settings')
    const s = slider(e)
    expect([s.min, s.max, s.step]).toEqual(['10', '105', '5'])
    expect(s.value).toBe('40')
    expect(readout(e)).toBe('40 cps')
    drag(s, 80)
    expect(e.textSpeed).toBe(80)
    drag(s, 105)
    expect(e.textSpeed).toBe(0)
    expect(readout(e)).toBe(e.t('ui.settings.speed.instant'))
    e.destroy()
  })

  it('[settings] textSpeedRange sets the range; an instant textSpeed sits at the top', async () => {
    const e = await playing({ settings: { textSpeedRange: [20, 200] } })
    e.textSpeed = 0
    e.openMenu('settings')
    const s = slider(e)
    expect([s.min, s.max, s.step]).toEqual(['20', '205', '5']) // 180 / 5 = 36 notches
    expect(s.value).toBe('205')
    expect(readout(e)).toBe(e.t('ui.settings.speed.instant'))
    e.destroy()
  })
})
