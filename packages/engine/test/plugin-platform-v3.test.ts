// @vitest-environment jsdom
// Plugin platform v3 (batch G inc 4b): plugin settings (contributes.config /
// [plugins.<id>] / ctx.config, player rows in the settings panel), per-plugin
// storage, chrome contributions (menu / title items, HUD, plugin screens),
// in-engine dialogs, and actor fields (voice leaves the engine's actor type).
import { describe, it, expect, beforeAll } from 'vitest'
import type { PluginManifest } from '@nilvn/core'
import { createEngine, MemorySaveStore, PLUGIN_SETTINGS_KEY, type Engine } from '../src/index'
import { applyConfig } from '../src/config'
import type { EnginePlugin, PluginContext } from '../src/types'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

const ID = 'com.example.weather'
const manifest: PluginManifest = {
  id: ID,
  name: 'plugin.weather.name',
  version: '1.0.0',
  entries: { engine: 'bundled' },
  permissions: ['storage.local', 'ui.screen', 'ui.dialog', 'vars.write'],
  contributes: {
    config: [
      { key: 'intensity', type: 'number', default: 0.5, min: 0, max: 1, step: 0.1, label: 'plugin.weather.cfg.intensity', scope: 'player' },
      { key: 'kind', type: 'enum', default: 'rain', options: [{ value: 'rain', label: 'plugin.weather.rain' }, { value: 'snow', label: 'plugin.weather.snow' }], label: 'plugin.weather.cfg.kind' },
      { key: 'on', type: 'boolean', default: true, label: 'plugin.weather.cfg.on', scope: 'player' },
    ],
    menuItems: [{ id: 'gallery', label: 'plugin.weather.gallery' }],
    titleItems: [{ id: 'extras', label: 'plugin.weather.extras' }],
    hud: [{ id: 'clock', slot: 'bottom-right' }],
    actorFields: [{ key: 'mood', type: 'string' }],
  },
  messages: { en: { 'plugin.weather.name': 'Weather', 'plugin.weather.gallery': 'Gallery', 'plugin.weather.extras': 'Extras', 'plugin.weather.cfg.intensity': 'Intensity', 'plugin.weather.cfg.on': 'Weather on', 'plugin.weather.cfg.kind': 'Kind', 'plugin.weather.rain': 'Rain', 'plugin.weather.snow': 'Snow' } },
}
function plugin(onActivate: (ctx: PluginContext) => void): EnginePlugin {
  return { id: ID, permissions: ['storage.local', 'ui.screen', 'ui.dialog', 'vars.write'], activate: onActivate }
}
function make(onActivate: (ctx: PluginContext) => void, extra: Record<string, unknown> = {}): Engine {
  return createEngine({ container: document.createElement('div'), textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, registry: [plugin(onActivate)], manifests: [manifest], use: [ID], ...extra })
}

describe('plugin settings', () => {
  it('resolve schema default ← author ([plugins.<id>] / option) ← player, coerced to the field type', async () => {
    let ctx!: PluginContext
    const e = make((c) => (ctx = c), { pluginConfig: { [ID]: { kind: 'snow' } } })
    applyConfig(e, { plugins: { use: [], [ID]: { intensity: '0.8' } } as never })
    e.loadSource('[label s]\n')
    await e.prepare()
    expect(ctx.config.get('kind')).toBe('snow')
    expect(ctx.config.get('intensity')).toBe(0.8) // coerced from the string
    expect(ctx.config.get('on')).toBe(true) // schema default
    const seen: string[] = []
    ctx.config.onChange((k, v) => seen.push(`${k}=${String(v)}`))
    e.setPluginConfig(ID, { intensity: 2 }, { player: true }) // clamped to max
    expect(ctx.config.get('intensity')).toBe(1)
    e.setPluginConfig(ID, { kind: 'hail' }) // not an option → default
    expect(ctx.config.get('kind')).toBe('rain')
    expect(seen).toEqual(['intensity=1', 'kind=rain'])
    expect(ctx.config.all()).toEqual({ intensity: 1, kind: 'rain', on: true })
    e.destroy()
  })

  it('short first-party names map to the app.nilvn. id; unknown author keys are one diagnostic', async () => {
    const e = make(() => {})
    applyConfig(e, { plugins: { use: [], weather: { x: 1 } } as never })
    expect(e.pluginConfigAll('app.nilvn.weather')).toEqual({ x: 1 })
    e.setPluginConfig(ID, { bogus: 1 })
    e.loadSource('[label s]\n')
    await e.prepare()
    expect(e.diagnostics.filter((d) => d.message.includes('unknown setting "bogus"'))).toHaveLength(1)
    e.destroy()
  })

  it('player values persist through the store and show up as rows in the settings panel', async () => {
    const store = new MemorySaveStore()
    const a = make(() => {}, { saveStore: store })
    a.loadSource('[label s]\nyuki: hi\n')
    await a.prepare()
    a.setPluginConfig(ID, { intensity: 0.3, on: false }, { player: true })
    await tick(400)
    expect(await store.get(PLUGIN_SETTINGS_KEY)).toEqual({ [ID]: { intensity: 0.3, on: false } })
    a.destroy()
    const b = make(() => {}, { saveStore: store })
    b.loadSource('[label s]\nyuki: hi\n')
    void b.start()
    await tick()
    expect(b.pluginConfigValue(ID, 'intensity')).toBe(0.3)
    b.openMenu('settings')
    const grid = b.stage.root.querySelector('.nilvn-panel--settings .nilvn-menu__grid')!
    expect(grid.querySelector('.nilvn-menu__head')!.textContent).toBe('Weather')
    const labels = [...grid.querySelectorAll('.nilvn-menu__row > span:first-child')].map((s) => s.textContent)
    expect(labels).toContain('Intensity')
    expect(labels).toContain('Weather on')
    expect(labels).not.toContain('Kind') // author-only field stays out
    const onSeg = [...grid.querySelectorAll('.nilvn-menu__seg')].at(-1)!
    ;(onSeg.firstElementChild as HTMLButtonElement).click() // On
    expect(b.pluginConfigValue(ID, 'on')).toBe(true)
    b.destroy()
  })
})

describe('plugin storage', () => {
  it('is namespaced per plugin inside the work store and survives the plugin', async () => {
    const store = new MemorySaveStore()
    let ctx!: PluginContext
    const e = make((c) => (ctx = c), { saveStore: store })
    e.loadSource('[label s]\n')
    await e.prepare()
    await ctx.storage!.set('seen', ['a', 'b'])
    await ctx.storage!.set('n', 1)
    expect(await ctx.storage!.get('seen')).toEqual(['a', 'b'])
    expect((await ctx.storage!.keys()).sort()).toEqual(['n', 'seen'])
    expect(await store.get(`plugin:${ID}:n`)).toBe(1)
    await store.set('slot:1', { v: 1 }) // the engine's own keys stay invisible
    expect((await ctx.storage!.keys()).sort()).toEqual(['n', 'seen'])
    await ctx.storage!.remove('n')
    expect(await ctx.storage!.get('n')).toBeUndefined()
    e.destroy()
  })
})

describe('chrome contributions', () => {
  it('a menu item joins the system menu with the manifest label and fires; released on disable', async () => {
    let fired = 0
    let ctx!: PluginContext
    const e = make((c) => {
      ctx = c
      c.screen!.menuItem('gallery', () => fired++)
    })
    e.loadSource('[label s]\nyuki: hi\n')
    void e.start()
    await tick()
    const item = e.stage.root.querySelector<HTMLButtonElement>(`.nilvn-menu__item--plugin[data-id="${ID}:gallery"]`)!
    expect(item.textContent).toBe('Gallery')
    item.click()
    expect(fired).toBe(1)
    expect(ctx.permissions).toContain('ui.screen')
    e.disablePlugin(ID)
    expect(e.stage.root.querySelector(`.nilvn-menu__item--plugin[data-id="${ID}:gallery"]`)).toBeNull()
    e.destroy()
  })

  it('a title item is a button on the title page; a HUD widget sits in its corner only while playing', async () => {
    let picked = 0
    const e = make((c) => {
      c.screen!.titleItem('extras', () => picked++)
      const hud = c.screen!.hud('clock')
      hud.textContent = '12:00'
    })
    e.loadSource('[label s]\nyuki: hi\n')
    await e.showTitle()
    const btn = e.stage.root.querySelector<HTMLButtonElement>(`.nilvn-screen__button[data-id="${ID}:extras"]`)!
    expect(btn.textContent).toBe('Extras')
    btn.click()
    expect(picked).toBe(1)
    const hud = e.stage.root.querySelector<HTMLElement>('.nilvn-hud--bottom-right')!
    expect(hud.textContent).toBe('12:00')
    expect(hud.style.display).toBe('none')
    void e.start()
    await tick()
    expect(hud.style.display).toBe('')
    e.destroy()
  })

  it('a plugin screen opens over the story in the panel chrome and closes on Esc; dialogs are the engine\'s own', async () => {
    let ctx!: PluginContext
    const e = make((c) => (ctx = c))
    e.loadSource('[label s]\nyuki: hi\n')
    void e.start()
    await tick()
    ctx.screen!.open('gallery', 'My gallery', (body) => {
      body.textContent = 'content'
    })
    const screen = e.stage.root.querySelector<HTMLElement>('.nilvn-screen-plugin')!
    expect(screen.querySelector('.nilvn-saves__title')!.textContent).toBe('My gallery')
    expect(screen.querySelector('.nilvn-backlog__list')!.textContent).toBe('content')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(e.stage.root.querySelector('.nilvn-screen-plugin')).toBeNull()
    const p = ctx.dialog!.confirm('ok?')
    e.stage.root.querySelector<HTMLButtonElement>('.nilvn-modal [data-id="ok"]')!.click()
    expect(await p).toBe(true)
    const a = ctx.dialog!.alert('note')
    expect(e.stage.root.querySelector('.nilvn-modal [data-id="cancel"]')).toBeNull()
    e.stage.root.querySelector<HTMLButtonElement>('.nilvn-modal [data-id="ok"]')!.click()
    await a
    ctx.dialog!.toast('hello')
    expect(e.stage.root.querySelector('.nilvn-toast.on')!.textContent).toBe('hello')
    e.destroy()
  })
})

describe('actor fields', () => {
  it('a declared field moves from the actor declaration into ext[pluginId]; the plugin reads actorField()', async () => {
    let ctx!: PluginContext
    const e = make((c) => (ctx = c), { actors: { yuki: { name: 'Yuki', mood: 'calm' } as never } })
    applyConfig(e, { actors: { rin: { name: 'Rin', mood: 'wild' } as never } })
    e.loadSource('[label s]\n[actor kai name=Kai mood=sad]\n')
    await e.start()
    expect(e.actors.yuki).toEqual({ name: 'Yuki', ext: { [ID]: { mood: 'calm' } } })
    expect(e.actors.rin).toEqual({ name: 'Rin', ext: { [ID]: { mood: 'wild' } } })
    expect(ctx.actorField('kai', 'mood')).toBe('sad')
    expect(ctx.actorField('kai', 'nope')).toBeUndefined()
    expect((e.actors.kai as Record<string, unknown>).mood).toBeUndefined() // not left at top level
    e.destroy()
  })

  it('voice: the pre-0.15 top-level field still reaches voicefx, and moves under ext once voicefx declares it', async () => {
    const voicefxManifest: PluginManifest = { id: 'app.nilvn.voicefx', name: 'x', version: '1.0.0', entries: { engine: 'bundled' }, contributes: { actorFields: [{ key: 'voice', type: 'number' }] } }
    let ctx!: PluginContext
    const e = createEngine({
      container: document.createElement('div'),
      saveStore: new MemorySaveStore(),
      actors: { yuki: { name: 'Yuki', voice: 360 } },
      registry: [
        {
          id: 'app.nilvn.voicefx',
          activate: (c) => {
            ctx = c
          },
        },
      ],
      manifests: [voicefxManifest],
      use: ['voicefx'],
    })
    e.loadSource('[label s]\n')
    await e.prepare()
    expect(e.actors.yuki.voice).toBeUndefined()
    expect(e.actors.yuki.ext).toEqual({ 'app.nilvn.voicefx': { voice: 360 } })
    expect(ctx.actorField('yuki', 'voice')).toBe(360)
    // A host without the manifest keeps the legacy field readable through the same call.
    const bare = createEngine({ container: document.createElement('div'), saveStore: new MemorySaveStore(), actors: { rin: { voice: 300 } } })
    expect(bare.actorField('rin', 'app.nilvn.voicefx', 'voice')).toBe(300)
    e.destroy()
    bare.destroy()
  })
})
