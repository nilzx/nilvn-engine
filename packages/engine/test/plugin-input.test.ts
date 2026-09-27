// @vitest-environment jsdom
// Plugin platform v3 batch H2: plugin key bindings in the engine's one key table
// (§2.6) — declaration, conflicts, author / player overrides, the settings
// screen's rebinding — and per-plugin variable namespaces (§2.10).
import { describe, it, expect, beforeAll } from 'vitest'
import type { PluginManifest } from '@nilvn/core'
import { newEngine } from './helpers'
import { LocalStorageSaveStore, type EngineOptions, type EnginePlugin, type PluginContext, type SaveStore } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {}, cancel() {} })
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const press = (key: string, init: KeyboardEventInit = {}, type: 'keydown' | 'keyup' = 'keydown'): void => void window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init }))

const ID = 'app.nilvn.weather'
const manifest = (bindings: NonNullable<PluginManifest['contributes']>['keybindings'], over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: ID,
  name: 'plugin.weather.name',
  version: '1.0.0',
  permissions: ['input.keys', 'vars.write'],
  contributes: { keybindings: bindings },
  messages: { en: { 'plugin.weather.key.toggle': 'Toggle rain' } },
  ...over,
})

/** A weather plugin counting its `toggle` presses in its own `weather.toggles`. */
function weather(): { plugin: EnginePlugin; ctx: () => PluginContext } {
  let ctx: PluginContext | undefined
  const plugin: EnginePlugin = {
    id: ID,
    activate(c) {
      ctx = c
      c.input?.on('toggle', () => c.vars!.set('toggles', ((c.vars!.get('toggles') as number | undefined) ?? 0) + 1))
    },
  }
  return { plugin, ctx: () => ctx! }
}

async function playing(opts: Partial<EngineOptions>) {
  const e = newEngine({ textSpeed: 0, ...opts })
  e.loadSource('[label s]\nyuki: hi\nyuki: there\n')
  void e.start()
  await tick()
  return e
}

const TOGGLE = { id: 'toggle', default: 'w', label: 'plugin.weather.key.toggle' }

describe('plugin key bindings', () => {
  it('runs the handler while playing, not while the menu is open, and never on auto-repeat', async () => {
    const w = weather()
    const e = await playing({ registry: [w.plugin], manifests: [manifest([TOGGLE])], use: [ID] })
    press('w')
    press('W', { shiftKey: true })
    press('w', { repeat: true })
    expect(e.getVar('weather.toggles')).toBe(2)
    e.openMenu('settings')
    press('w')
    expect(e.getVar('weather.toggles')).toBe(2)
    e.destroy()
  })

  it('an "always" binding also works before play starts; a "playing" one does not', async () => {
    const seen: string[] = []
    const plugin: EnginePlugin = {
      id: ID,
      activate(c) {
        c.input!.on('any', () => void seen.push('any'))
        c.input!.on('play', () => void seen.push('play'))
      },
    }
    const e = newEngine({ registry: [plugin], manifests: [manifest([{ id: 'any', default: 'q', when: 'always' }, { id: 'play', default: 'p' }])], use: [ID] })
    e.loadSource('yuki: hi\n')
    await e.enablePlugin(ID)
    press('q')
    press('p')
    expect(seen).toEqual(['any'])
    e.destroy()
  })

  it('a default already taken stays unbound with a diagnostic; the author can move it with [keys.<name>]', async () => {
    const taken = await playing({ registry: [weather().plugin], manifests: [manifest([{ ...TOGGLE, default: 'a' }])], use: [ID] })
    expect(taken.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('"app.nilvn.weather:toggle": A is already bound to "auto"'))
    expect(taken.keyTable.binding(`${ID}:toggle`)).toBeUndefined()
    taken.destroy()

    const w = weather()
    const moved = await playing({ registry: [w.plugin], manifests: [manifest([{ ...TOGGLE, default: 'a' }])], use: [ID], keys: { weather: { toggle: 'r' } } })
    expect(moved.diagnostics).toEqual([])
    press('r')
    expect(moved.getVar('weather.toggles')).toBe(1)
    moved.destroy()
  })

  it('without input.keys the bindings are not entered and ctx.input is absent', async () => {
    const w = weather()
    const e = await playing({ registry: [w.plugin], manifests: [manifest([TOGGLE], { permissions: ['vars.write'] })], use: [ID] })
    expect(w.ctx().input).toBeUndefined()
    expect(e.keyTable.rows((id) => id).some((r) => r.id === `${ID}:toggle`)).toBe(false)
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('"input.keys" was not granted'))
    e.destroy()
  })

  it('an undeclared id warns; disabling the plugin releases its bindings', async () => {
    const plugin: EnginePlugin = { id: ID, activate: (c) => void c.input!.on('nope', () => {}) }
    const e = await playing({ registry: [plugin], manifests: [manifest([TOGGLE])], use: [ID] })
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('input.on("nope"): no such binding'))
    expect(e.keyTable.binding(`${ID}:toggle`)).toBe('w')
    e.disablePlugin(ID)
    expect(e.keyTable.binding(`${ID}:toggle`)).toBeUndefined()
    e.destroy()
  })

  it('the player rebinds in the settings: the key leaves its old holder, persists, and resets', async () => {
    const store: SaveStore = new LocalStorageSaveStore('keys-test')
    const w = weather()
    const e = await playing({ registry: [w.plugin], manifests: [manifest([TOGGLE])], use: [ID], saveStore: store })
    e.openMenu('settings')
    const row = (label: string): HTMLButtonElement => {
      const rows = [...e.stage.root.querySelectorAll('.nilvn-panel--settings .nilvn-menu__row')]
      return rows.find((r) => r.firstElementChild?.textContent === label)!.querySelector('button')!
    }
    expect(row('Toggle rain').textContent).toBe('W')
    row('Toggle rain').click()
    press('a') // auto's key
    expect(e.keyTable.binding(`${ID}:toggle`)).toBe('A')
    expect(e.keyTable.binding('auto')).toBe(false)
    expect(row('Auto').textContent).toBe('—')

    row('Skip while held').click()
    press('Control')
    press('Control', {}, 'keyup')
    expect(e.keyTable.binding('skipHold')).toBe('Control')

    row('Quick save').click()
    press('s', { ctrlKey: true })
    expect(e.keyTable.binding('quicksave')).toBe('Ctrl+S')

    row('Quick load').click()
    press('Backspace')
    expect(e.keyTable.binding('quickload')).toBe(false)

    row('Backlog').click()
    press('Escape') // cancels without closing anything
    expect(e.keyTable.binding('backlog')).toBeUndefined()
    expect(e.stage.root.querySelector('.nilvn-panel--settings.on')).not.toBeNull()

    await new Promise((r) => setTimeout(r, 350)) // the settings write is debounced
    expect(((await store.get('settings')) as { keys?: Record<string, unknown> }).keys).toMatchObject({ [`${ID}:toggle`]: 'A', auto: false, quickload: false })

    const [reset] = [...e.stage.root.querySelectorAll<HTMLButtonElement>('.nilvn-panel--settings button')].filter((b) => b.textContent === 'Reset keys')
    reset!.click()
    expect(e.keyTable.binding('auto')).toBe('a')
    expect(e.keyTable.binding(`${ID}:toggle`)).toBe('w')
    e.destroy()
  })
})

describe('variable namespaces', () => {
  const writer = (id: string, perms: string[] = ['vars.write']): { plugin: EnginePlugin; ctx: () => PluginContext } => {
    let ctx: PluginContext | undefined
    return { plugin: { id, permissions: perms as never, activate: (c) => void (ctx = c) }, ctx: () => ctx! }
  }

  it('stores under the full id; the short name is an alias only while no other active plugin shares it', async () => {
    const a = writer('com.example.rain-fx')
    const b = writer('com.other.rain-fx')
    const s = writer('com.example.sys')
    const solo = writer('com.example.mist')
    // Either activation order gives the same prefixes.
    for (const order of [[a, b, s, solo], [solo, s, b, a]]) {
      const e = await playing({ plugins: order.map((w) => w.plugin) })
      expect(a.ctx().vars!.namespace).toBe('com.example.rain_fx')
      expect(b.ctx().vars!.namespace).toBe('com.other.rain_fx')
      a.ctx().vars!.set('n', 1)
      b.ctx().vars!.set('n', 2)
      s.ctx().vars!.set('n', 3)
      solo.ctx().vars!.set('n', 4)
      expect(e.vars).toEqual({ 'com.example.rain_fx.n': 1, 'com.other.rain_fx.n': 2, 'com.example.sys.n': 3, 'com.example.mist.n': 4 })
      expect(e.getVar('mist.n')).toBe(4) // unique → alias
      expect(e.getVar('rain_fx.n')).toBeUndefined() // shared → neither gets it
      expect(e.getVar('sys.n')).toBeUndefined() // the engine's prefix is never an alias
      const msgs = e.diagnostics.map((d) => d.message)
      expect(msgs).toContainEqual(expect.stringContaining('"rain_fx" is shared by'))
      expect(msgs.filter((m) => m.includes('"rain_fx" is shared by')).length).toBe(2) // both plugins hear it
      expect(msgs).toContainEqual(expect.stringContaining('"sys" is the engine\'s'))
      e.destroy()
    }
  })

  it('an alias follows the active set, and a short-prefixed name written before activation moves under the full id', async () => {
    const a = writer('com.example.mist')
    const b = writer('com.other.mist')
    const e = newEngine({ textSpeed: 0, registry: [a.plugin, b.plugin] })
    e.loadSource('[label s]\nyuki: hi\nyuki: there\n')
    e.setVar('mist.early', 1)
    void e.start()
    await tick()
    await e.enablePlugin('com.example.mist')
    expect(e.vars).toEqual({ 'com.example.mist.early': 1 })
    e.setVar('mist.late', 2) // a script's [set] through the alias
    expect(a.ctx().vars!.get('late')).toBe(2)
    await e.enablePlugin('com.other.mist')
    expect(e.getVar('mist.late')).toBeUndefined() // now ambiguous
    expect(e.getVar('com.example.mist.late')).toBe(2) // the full prefix always works
    e.disablePlugin('com.other.mist')
    expect(e.getVar('mist.late')).toBe(2)
    e.destroy()
  })

  it('a script reads a plugin variable by its prefixed name', async () => {
    const w = writer('app.nilvn.weather')
    const e = newEngine({ textSpeed: 0, plugins: [w.plugin] })
    e.loadSource('[set seen = weather.intensity > 0.5]')
    w.ctx().vars!.set('intensity', 0.8)
    await e.start()
    expect(e.vars.seen).toBe(true)
    e.destroy()
  })

  it('warns once when get() misses its namespace but an author variable has the name', async () => {
    const w = writer('app.nilvn.weather')
    const e = await playing({ plugins: [w.plugin] })
    e.setVar('mood', 'calm')
    expect(w.ctx().vars!.get('mood')).toBeUndefined()
    expect(w.ctx().vars!.global('mood')).toBe('calm')
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('use vars.global("mood")'))
    e.destroy()
  })
})
