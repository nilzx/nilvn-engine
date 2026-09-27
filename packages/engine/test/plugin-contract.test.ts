// @vitest-environment jsdom
// Contract points pinned by batch H3's acceptance (two third-party example
// plugins written from the public docs alone): every session entry is announced
// (restart and load included, before a load's slices come back), `ui.layer`
// placement, the author's strings over a plugin's messages, and `screen.isOpen`.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PluginManifest } from '@nilvn/core'
import { newEngine } from './helpers'
import type { EnginePlugin, PluginContext } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {}, cancel() {} })
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const ID = 'com.example.probe'

async function playing(plugin: EnginePlugin, extra: Parameters<typeof newEngine>[0] = {}) {
  const e = newEngine({ textSpeed: 0, plugins: [plugin], ...extra })
  e.loadSource('[label s]\nline one\nline two\n')
  void e.start()
  await tick()
  return e
}

describe('session entries', () => {
  it('announces restart and load, and a load before its slices come back', async () => {
    const log: string[] = []
    const plugin: EnginePlugin = {
      id: ID,
      permissions: ['save.slice'],
      hooks: {
        onSessionChange: (state, prev) => void log.push(`session ${prev}→${state}`),
        onRestored: () => void log.push('onRestored'),
      },
      saveState: () => ({ n: 1 }),
      restoreState: () => void log.push('restoreState'),
    }
    const e = await playing(plugin)
    const save = e.saveState()
    log.length = 0
    await e.restart()
    await tick()
    expect(log).toEqual(['session playing→playing'])
    log.length = 0
    await e.restoreState(save)
    await tick()
    expect(log).toEqual(['session playing→playing', 'restoreState', 'onRestored'])
    e.destroy()
  })
})

describe('ctx.session', () => {
  it('reads where the session is, in step with onSessionChange', async () => {
    const seen: string[] = []
    let ctx: PluginContext | undefined
    const plugin: EnginePlugin = {
      id: ID,
      activate: (c) => void (ctx = c),
      hooks: { onSessionChange: (state, _prev, c) => void seen.push(`${state}:${c.session}`) },
    }
    const e = newEngine({ textSpeed: 0, plugins: [plugin] })
    e.loadSource('[label s]\nline one\n')
    await e.enablePlugin(ID)
    expect(ctx!.session).toBe('idle')
    await e.showTitle()
    expect(ctx!.session).toBe('title')
    void e.start()
    await tick()
    expect(ctx!.session).toBe('playing')
    expect(seen).toEqual(['title:title', 'playing:playing'])
    e.destroy()
  })
})

describe('ui.layer placement', () => {
  it('puts a scene layer under the dialogue box and an overlay under the fade cover and screens', async () => {
    let ctx: PluginContext | undefined
    const e = await playing({ id: ID, permissions: ['ui.layer'], activate: (c) => void (ctx = c) })
    const scene = ctx!.ui!.layer('p-scene', { over: 'scene' })
    const overlay = ctx!.ui!.layer('p-overlay')
    const order = [...e.stage.root.children].map((el) => el.className.split(' ')[0])
    expect(order.indexOf('p-scene')).toBe(order.indexOf('nilvn-dialog') - 1)
    expect(order.indexOf('p-overlay')).toBe(order.indexOf('nilvn-fader') - 1)
    expect(scene.dataset.plugin).toBe(ID)
    expect(overlay.dataset.plugin).toBe(ID)
    e.destroy()
  })
})

describe('ctx.t', () => {
  it("prefers the author's [strings] over the plugin's own messages", async () => {
    let ctx: PluginContext | undefined
    const manifest: PluginManifest = { id: ID, name: 'x', version: '1.0.0', messages: { en: { 'plugin.probe.a': 'Plugin A', 'plugin.probe.b': 'Plugin {n}' } } }
    const e = newEngine({ textSpeed: 0, registry: [{ id: ID, activate: (c) => void (ctx = c) }], manifests: [manifest], use: [ID] })
    e.messages.en = { ...e.messages.en, 'plugin.probe.a': 'Author A' }
    e.loadSource('line\n')
    void e.start()
    await tick()
    expect(ctx!.t('plugin.probe.a')).toBe('Author A')
    expect(ctx!.t('plugin.probe.b', { n: 2 })).toBe('Plugin 2')
    expect(ctx!.t('plugin.probe.none')).toBe('plugin.probe.none')
    e.destroy()
  })
})

describe('ctx.screen', () => {
  it('isOpen / close act on the plugin’s own screen only', async () => {
    const ctxs: Record<string, PluginContext> = {}
    const mk = (id: string): EnginePlugin => ({ id, permissions: ['ui.screen'], activate: (c) => void (ctxs[id] = c) })
    const e = await playing(mk('com.example.one'), { plugins: [mk('com.example.one'), mk('com.example.two')] })
    const one = ctxs['com.example.one']!.screen!
    const two = ctxs['com.example.two']!.screen!
    one.open('list', 'One', (body) => void body.append('x'))
    expect(one.isOpen()).toBe(true)
    expect(one.isOpen('list')).toBe(true)
    expect(one.isOpen('other')).toBe(false)
    expect(two.isOpen('list')).toBe(false)
    two.close('list') // not two's screen
    expect(one.isOpen('list')).toBe(true)
    one.close('list')
    expect(one.isOpen()).toBe(false)
    e.destroy()
  })
})
