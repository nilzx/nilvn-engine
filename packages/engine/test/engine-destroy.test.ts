// @vitest-environment jsdom
// Engine.destroy() releases everything: plugins
// deactivate in reverse activation order, every window listener the engine or a
// plugin added is removed, audio is paused, and two engines on one page keep
// their own chrome language (no module-level state leaks between instances).
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, type EnginePlugin, type Engine, type PluginManifest } from '../src/index'

const paused = new Set<HTMLMediaElement>()
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: function (this: HTMLMediaElement) {
      paused.add(this)
    },
  })
})

/** Track window listeners by (type, fn) identity between two points in time. */
function watchWindowListeners(): () => { leaked: string[] } {
  const live = new Map<object, string>()
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    live.set(fn, type)
    add(type, fn, opts as AddEventListenerOptions)
  }) as typeof window.addEventListener
  window.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    live.delete(fn)
    remove(type, fn, opts as EventListenerOptions)
  }) as typeof window.removeEventListener
  return () => {
    window.addEventListener = add
    window.removeEventListener = remove
    return { leaked: [...live.values()] }
  }
}

function engineWith(plugins: EnginePlugin[], use: string[] = [], lang?: string, registry: EnginePlugin[] = [], manifests: PluginManifest[] = []): Engine {
  const container = document.createElement('div')
  document.body.append(container)
  return createEngine({ container, plugins, registry, manifests, use, textSpeed: 0, ...(lang ? { lang, defaultLang: lang, languages: [lang] } : {}) })
}

/** A plugin that acquires everything a shell does — window listeners, timers, a
 *  UI layer, a style — all through ctx, so deactivate must release all of it. */
const greedy: EnginePlugin = {
  id: 'app.nilvn.greedy',
  permissions: ['ui.layer', 'timer'],
  styles: '.greedy{color:red}',
  activate(ctx) {
    ctx.listen(window, 'keydown', () => {})
    ctx.listen(window, 'wheel', () => {})
    ctx.ui!.layer('greedy')
    ctx.timer!.setInterval(() => {}, 1000)
  },
}

/** A plugin rendering chrome through its own manifest messages (ctx.t). */
const chrome: EnginePlugin = {
  id: 'app.nilvn.chrome',
  permissions: ['ui.layer'],
  activate(ctx) {
    const b = document.createElement('button')
    b.className = 'chrome-btn'
    b.textContent = ctx.t('plugin.chrome.load')
    ctx.ui!.layer('chrome').append(b)
  },
}
const chromeManifest: PluginManifest = {
  id: 'app.nilvn.chrome',
  name: 'plugin.chrome.name',
  version: '1.0.0',
  permissions: ['ui.layer'],
  messages: { en: { 'plugin.chrome.name': 'Chrome', 'plugin.chrome.load': 'Load' }, zh: { 'plugin.chrome.name': '外壳', 'plugin.chrome.load': '读取进度' } },
}

describe('Engine.destroy', () => {
  it('deactivates every installed plugin, last activated first, and reports a throwing one', () => {
    const order: string[] = []
    const a: EnginePlugin = { id: 'test.a', deactivate: () => order.push('a') }
    const b: EnginePlugin = {
      id: 'test.b',
      deactivate: () => {
        order.push('b')
        throw new Error('b boom')
      },
    }
    const c: EnginePlugin = { id: 'test.c', deactivate: () => order.push('c') }
    const e = engineWith([a, b, c])
    e.destroy()
    expect(order).toEqual(['c', 'b', 'a'])
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'plugin', plugin: 'test.b', message: expect.stringContaining('deactivate') }))
    e.destroy() // idempotent
    expect(order).toHaveLength(3)
  })

  it('leaves no window listener behind after a run with a plugin that acquires listeners, timers and layers', async () => {
    const done = watchWindowListeners()
    const e = engineWith([], ['greedy'], undefined, [greedy])
    e.loadSource('[label s1]\n[bgm music.mp3]\n[se ding.mp3]\nyuki: Hello\n')
    void e.start()
    for (let i = 0; i < 50 && !e.stage.textEl.textContent; i++) await new Promise((r) => setTimeout(r, 5))
    e.destroy()
    const { leaked } = done()
    expect(leaked).toEqual([])
  })

  it('pauses playing audio on destroy', () => {
    paused.clear()
    const e = engineWith([])
    e.playBgm('music.mp3')
    e.playTrack('rain', 'rain.mp3')
    e.playSe('ding.mp3')
    e.destroy()
    expect(paused.size).toBe(3)
  })
})

describe('per-engine chrome language', () => {
  it('two engines with different work languages resolve a plugin\'s chrome independently', async () => {
    const zh = engineWith([], ['chrome'], 'zh', [chrome], [chromeManifest])
    const en = engineWith([], ['chrome'], 'en', [chrome], [chromeManifest])
    zh.loadSource('yuki: a')
    en.loadSource('yuki: a')
    await zh.usePlugins(['chrome'])
    await en.usePlugins(['chrome'])
    const label = (e: Engine): string => e.stage.root.querySelector<HTMLElement>('.chrome-btn')!.textContent ?? ''
    expect(label(zh)).toBe('读取进度')
    expect(label(en)).toBe('Load')
    expect(label(zh)).not.toBe(label(en))
    zh.destroy()
    en.destroy()
  })
})
