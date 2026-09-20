// @vitest-environment jsdom
// The session lifecycle (batch G inc 2): `prepare()` / `ready` before play, the
// idle → title → playing → ending state machine, `[ending id]` / `[title]`, and
// the hooks that let a plugin follow the session (labels, saves, settings,
// variables). The chrome screens themselves land in inc 3; here the renderer
// only records which screen the engine asked for.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine } from '../src/index'
import type { EnginePlugin, PluginContext, SessionState } from '../src/types'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

const tick = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms))
const container = (): HTMLElement => document.createElement('div')

/** A recording plugin: every hook it subscribes to appends to `log`. */
function recorder(log: string[], hooks: string[]): EnginePlugin {
  return {
    id: 'test.recorder',
    permissions: ['vars.write', 'session.settings', 'session.save'],
    activate(ctx) {
      for (const h of hooks) ctx.on(h as never, ((...args: unknown[]) => log.push(`${h}:${args.slice(0, -1).map(fmt).join(',')}`)) as never)
    },
  }
}
const fmt = (v: unknown): string => (typeof v === 'object' && v ? '{…}' : String(v))

describe('prepare and ready', () => {
  it('ready resolves after prepare(); onReady fires once, before any play', async () => {
    const log: string[] = []
    let readyCb = 0
    const engine = createEngine({ container: container(), plugins: [recorder(log, ['onReady'])], onReady: () => readyCb++ })
    engine.loadSource('[label s]\n[set x = 1]\n')
    let resolved = false
    void engine.ready.then(() => (resolved = true))
    expect(engine.session).toBe('idle')
    expect(await engine.prepare()).toBe(true)
    await tick(0)
    expect(resolved).toBe(true)
    expect(engine.session).toBe('idle') // prepare does not play
    await engine.start()
    await engine.start()
    expect(log.filter((l) => l === 'onReady:')).toHaveLength(1)
    expect(readyCb).toBe(1)
  })

  it('start() alone still resolves ready (the pre-inc-2 host path)', async () => {
    const engine = createEngine({ container: container() })
    engine.loadSource('[label s]\n')
    await engine.start()
    let resolved = false
    void engine.ready.then(() => (resolved = true))
    await tick(0)
    expect(resolved).toBe(true)
  })

  it('prepare() still throws the programming error of nothing loaded', async () => {
    const engine = createEngine({ container: container() })
    await expect(engine.prepare()).rejects.toThrow(/No script loaded/)
  })
})

describe('session state machine', () => {
  it('idle → playing → ending on a plain run; running off the end is the default ending', async () => {
    const seen: string[] = []
    const engine = createEngine({ container: container(), onSessionChange: (s, p) => seen.push(`${p}>${s}`) })
    engine.loadSource('[label s]\n[set x = 1]\n')
    await engine.start()
    expect(engine.session).toBe('ending')
    expect(engine.ending).toBe('default')
    expect(seen).toEqual(['idle>playing', 'playing>ending'])
    expect(engine.stage.chrome.currentScreen()).toBe('ending')
  })

  it('[ending id] names the ending; [end] is the default one', async () => {
    const engine = createEngine({ container: container() })
    engine.loadSource('[label s]\n[ending true_end sec=0]\n')
    await engine.start()
    expect(engine.ending).toBe('true_end')
    engine.loadSource('[label s]\n[end 0]\n')
    await engine.start()
    expect(engine.ending).toBe('default')
  })

  it('[title] stops the run, clears the session and enters title; start() from there is a fresh game', async () => {
    const seen: SessionState[] = []
    const engine = createEngine({ container: container() })
    engine.onSessionChange((s) => seen.push(s))
    engine.loadSource('[label s]\n[set x = 1]\n[title]\n[set y = 2]\n')
    await engine.start()
    expect(engine.session).toBe('title')
    expect(engine.vars).toEqual({}) // cleared, and [set y] never ran
    expect(engine.stage.chrome.currentScreen()).toBe('title')
    expect(seen).toEqual(['playing', 'title'])
    engine.loadSource('[label s]\n[set z = 3]\n')
    await engine.start()
    expect(engine.session).toBe('ending')
    expect(engine.vars).toEqual({ z: 3 })
    expect(engine.ending).toBe('default')
  })

  it('showTitle() from an ending hides the ending screen; the ending id is gone', async () => {
    const engine = createEngine({ container: container() })
    engine.loadSource('[label s]\n[ending bad sec=0]\n')
    await engine.start()
    await engine.showTitle()
    expect(engine.session).toBe('title')
    expect(engine.ending).toBeUndefined()
    expect(engine.stage.chrome.currentScreen()).toBe('title')
  })

  it('a restore and a restart re-enter playing; destroy ends in idle', async () => {
    const seen: string[] = []
    const engine = createEngine({ container: container(), onSessionChange: (s) => seen.push(s) })
    engine.loadSource('[label s]\nyuki: hi\n')
    void engine.start()
    await tick()
    const save = engine.saveState()
    await engine.showTitle()
    expect(await engine.restoreState(save)).toBe(true)
    expect(engine.session).toBe('playing')
    await engine.restart()
    await tick()
    expect(engine.session).toBe('playing')
    engine.destroy()
    expect(engine.session).toBe('idle')
    expect(seen).toEqual(['playing', 'title', 'playing', 'idle'])
  })

  it('the chrome seam records one screen at a time', () => {
    const { chrome } = createEngine({ container: container() }).stage
    expect(chrome.currentScreen()).toBeNull()
    chrome.showScreen('title', { buttons: [] })
    chrome.showScreen('ending', { buttons: [], endingId: 'x' })
    expect(chrome.currentScreen()).toBe('ending')
    chrome.hideScreen('title') // not the one up — no-op
    expect(chrome.currentScreen()).toBe('ending')
    chrome.hideScreen()
    expect(chrome.currentScreen()).toBeNull()
  })
})

describe('session hooks', () => {
  it('onLabel fires for a label reached by falling through, by a jump and by start(label)', async () => {
    const log: string[] = []
    const engine = createEngine({ container: container(), plugins: [recorder(log, ['onLabel'])] })
    engine.loadSource('[label a]\n[jump c]\n[label b]\n[set x = 1]\n[label c]\n[set y = 1]\n')
    await engine.start()
    expect(log).toEqual(['onLabel:a', 'onLabel:c'])
    log.length = 0
    await engine.start('b')
    expect(log).toEqual(['onLabel:b', 'onLabel:c'])
  })

  it('onVarChange fires for [set] and vars.set; a restore replaces the table silently', async () => {
    const log: string[] = []
    let ctxRef: PluginContext | undefined
    const plugin: EnginePlugin = {
      id: 'test.vars',
      permissions: ['vars.write'],
      activate(ctx) {
        ctxRef = ctx
        ctx.on('onVarChange', (n, v) => log.push(`${n}=${String(v)}`))
      },
    }
    const engine = createEngine({ container: container(), plugins: [plugin] })
    engine.loadSource('[label s]\n[set x = 1]\nyuki: hi\n')
    void engine.start()
    await tick()
    ctxRef!.vars!.set('y', 2)
    expect(log).toEqual(['x=1', 'y=2'])
    const save = engine.saveState()
    log.length = 0
    await engine.restoreState(save)
    await tick()
    expect(log).toEqual([]) // the table came back wholesale — no per-var events (play resumes at the parked line)
    expect(ctxRef!.vars!.all()).toMatchObject({ x: 1, y: 2 }) // plus the engine's own sys.* lists
    engine.destroy()
  })

  it('onSettingsChange reports text speed, channel volumes and the language', async () => {
    const log: string[] = []
    let ctxRef: PluginContext | undefined
    const plugin: EnginePlugin = {
      id: 'test.settings',
      permissions: ['session.settings'],
      activate(ctx) {
        ctxRef = ctx
        ctx.on('onSettingsChange', (k, v) => log.push(`${k}=${String(v)}`))
      },
    }
    const engine = createEngine({ container: container(), plugins: [plugin], catalogs: { en: {}, zh: {} }, lang: 'en' })
    engine.textSpeed = 80
    engine.textSpeed = 80 // unchanged: silent
    ctxRef!.settings!.textSpeed = 20
    ctxRef!.settings!.setVolume('bgm', 0.5)
    engine.setVolume('se', 2) // clamped to 1 — unchanged, silent
    engine.setVolume('se', -1) // clamped to 0
    await engine.setLanguage('zh')
    expect(log).toEqual(['textSpeed=80', 'textSpeed=20', 'volume:bgm=0.5', 'volume:se=0', 'lang=zh'])
    expect(engine.bgmVolume).toBe(0.5)
  })

  it('onSaved / onRestored bracket a save round trip', async () => {
    const log: string[] = []
    const engine = createEngine({ container: container(), plugins: [recorder(log, ['onSaved', 'onRestored'])], saves: { autosave: false } })
    engine.loadSource('[label s]\nyuki: hi\n')
    void engine.start()
    await tick()
    const save = engine.saveState()
    expect(log).toEqual(['onSaved:{…}'])
    expect(await engine.restoreState(save)).toBe(true)
    expect(log).toEqual(['onSaved:{…}', 'onRestored:{…}'])
    expect(await engine.restoreState({ ...save, v: 1 } as never)).toBe(false)
    expect(log).toHaveLength(2) // a rejected restore fires nothing
    engine.destroy()
  })

  it('onSessionChange reaches plugins with (state, prev)', async () => {
    const log: string[] = []
    const engine = createEngine({ container: container(), plugins: [recorder(log, ['onSessionChange'])] })
    engine.loadSource('[label s]\n[end 0]\n')
    await engine.start()
    expect(log).toEqual(['onSessionChange:playing,idle', 'onSessionChange:ending,playing'])
  })
})
