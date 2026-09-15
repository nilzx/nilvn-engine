// @vitest-environment jsdom
// The plugin host: a plugin
// gets capability objects for exactly the permissions it declared and was
// granted; everything it registers is released on deactivate (the hot-plug
// guarantee); `[use]` resolves ids, plugin packages and modules; activation
// modes and dependencies are honored; reload carries state and rolls back.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { EnginePlugin, PluginContext, PluginLoader, PluginManifest } from '../src/index'
import { fxFixtures, newEngine } from './helpers'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const until = async (pred: () => boolean, ms = 800): Promise<void> => {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Capture the context a plugin was activated with. */
function probe(id: string, extra: Partial<EnginePlugin> = {}): { plugin: EnginePlugin; ctx: () => PluginContext } {
  let seen: PluginContext | null = null
  const plugin: EnginePlugin = { id, ...extra, activate: (ctx) => void (seen = ctx) }
  return { plugin, ctx: () => seen! }
}

describe('capability gating', () => {
  it('a plugin gets only the capability objects it declared', () => {
    const none = probe('test.none', { permissions: [] })
    const some = probe('test.some', { permissions: ['stage.read', 'vars.read', 'timer'] })
    const e = newEngine({ plugins: [none.plugin, some.plugin] })
    for (const k of ['stage', 'audio', 'vars', 'saves', 'settings', 'backlog', 'replay', 'ui', 'timer'] as const) expect(none.ctx()[k], k).toBeUndefined()
    expect(some.ctx().stage).toBeDefined()
    expect(some.ctx().vars).toBeDefined()
    expect(some.ctx().timer).toBeDefined()
    expect(some.ctx().audio).toBeUndefined()
    expect(some.ctx().saves).toBeUndefined()
    expect(some.ctx().permissions).toEqual(['stage.read', 'vars.read', 'timer'])
    expect(e.activePlugins).toEqual(['test.none', 'test.some'])
    e.destroy()
  })

  it('with only stage.read the write verbs are reporting stubs; vars.set needs vars.write', async () => {
    const p = probe('test.ro', { permissions: ['stage.read', 'vars.read'] })
    const e = newEngine({ plugins: [p.plugin] })
    e.vars.x = 1
    const ctx = p.ctx()
    expect(ctx.stage!.hasObject('camera')).toBe(true) // read works
    await ctx.stage!.setBackground({ color: '#123' }) // no throw, no effect
    await ctx.stage!.applyEffect('shake', 'camera', {})
    ctx.vars!.set('x', 2)
    expect(ctx.vars!.get('x')).toBe(1)
    const msgs = e.diagnostics.filter((d) => d.plugin === 'test.ro').map((d) => d.message)
    expect(msgs).toEqual([expect.stringContaining('stage.setBackground'), expect.stringContaining('stage.applyEffect'), expect.stringContaining('vars.set')])
    e.destroy()
  })

  it('the host can deny (EngineOptions.grant); denied and non-engine permissions yield no object', () => {
    const p = probe('test.deny', { permissions: ['vars.write', 'project.read', 'telepathy' as never] })
    const e = newEngine({ plugins: [p.plugin], grant: (_id, requested) => requested.filter((x) => x !== 'vars.write') })
    expect(p.ctx().vars).toBeUndefined()
    expect(p.ctx().permissions).toEqual(['project.read']) // editor-side: listed, no engine object
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('unknown permission "telepathy"'))
    e.destroy()
  })

  it('a manifest supplied through EngineOptions.manifests is authoritative for permissions', () => {
    const p = probe('test.mani', { permissions: ['vars.write'] })
    const manifest: PluginManifest = { id: 'test.mani', name: 'plugin.mani.name', version: '1.0.0', permissions: [] }
    const e = newEngine({ registry: [p.plugin], manifests: [manifest], use: ['test.mani'] })
    e.loadSource('[set x = 1]')
    return e.start().then(() => {
      expect(p.ctx().vars).toBeUndefined()
      expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('the manifest wins'))
      e.destroy()
    })
  })
})

describe('hot plug', () => {
  it('disable releases commands, effects, hooks, styles, listeners, timers, layers; enable restores them', async () => {
    vi.useFakeTimers()
    let ticks = 0
    let disposed = 0
    let hooked = 0
    const keyFn = vi.fn()
    const hot: EnginePlugin = {
      id: 'test.hot',
      permissions: ['ui.layer', 'timer', 'vars.write'],
      styles: '.test-hot{color:red}',
      commands: { mark: ({ plugin }) => plugin.vars!.set('mark', ((plugin.vars!.get('mark') as number) ?? 0) + 1) },
      textEffects: { glow: (span) => span.addClass('glow') },
      hooks: { onDialogue: () => void hooked++ },
      activate(ctx) {
        ctx.listen(window, 'keydown', keyFn)
        ctx.timer!.setInterval(() => void ticks++, 10)
        ctx.ui!.layer('test-layer')
        ctx.onDispose(() => void disposed++)
      },
    }
    const e = newEngine({ plugins: [hot], textSpeed: 0 })
    const style = (): Element | null => document.querySelector('style[data-plugin="test.hot"]')
    expect(style()).not.toBeNull()
    expect(e.stage.root.querySelector('.test-layer')).not.toBeNull()
    vi.advanceTimersByTime(35)
    expect(ticks).toBe(3)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
    expect(keyFn).toHaveBeenCalledTimes(1)
    expect(e.getTextEffect('glow')).toBeDefined()

    expect(e.disablePlugin('test.hot')).toBe(true)
    expect(e.pluginState('test.hot')).toBe('registered')
    expect(style()).toBeNull()
    expect(e.stage.root.querySelector('.test-layer')).toBeNull()
    expect(disposed).toBe(1)
    vi.advanceTimersByTime(50)
    expect(ticks).toBe(3) // interval cleared
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
    expect(keyFn).toHaveBeenCalledTimes(1) // listener removed
    expect(e.getTextEffect('glow')).toBeUndefined()
    vi.useRealTimers()

    e.loadSource('[mark]\nyuki: hi\n')
    void e.start()
    await until(() => e.stage.textEl.textContent === 'hi')
    expect(e.vars.mark).toBeUndefined() // unknown command now
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'exec', message: expect.stringContaining('unknown command [mark]') }))
    expect(hooked).toBe(0)

    expect(await e.enablePlugin('test.hot')).toBe(true)
    expect(style()).not.toBeNull()
    expect(e.stage.root.querySelector('.test-layer')).not.toBeNull()
    e.loadSource('[mark]\nyuki: again\n')
    void e.start()
    await until(() => e.stage.textEl.textContent === 'again')
    expect(e.vars.mark).toBe(1)
    expect(hooked).toBe(1)
    e.destroy()
    expect(disposed).toBe(2)
  })

  it('toggling a text-effect plugin re-paints the parked line: effects vanish and return without a reload (the demo)', async () => {
    // A second engine on the page (the editor's edit stage next to its preview)
    // holds the same plugin: its <style> must survive the first one's disable.
    const { fx } = fxFixtures()
    const other = newEngine({ registry: [fx], use: ['fx'], textSpeed: 0 })
    other.loadSource('[set x = 1]')
    await other.start()
    const e = newEngine({ registry: [fx], use: ['fx'], textSpeed: 0 })
    e.loadSource('yuki: {wave:hi} there')
    void e.start()
    await until(() => e.stage.textEl.textContent === 'hi there')
    const waves = (): number => e.stage.textEl.querySelectorAll('.tfx-wave').length
    // One <style> per engine holding the plugin (ids carry the host token).
    const styles = (): number => document.querySelectorAll('style[data-plugin="app.nilvn.fx"]').length
    expect(waves()).toBe(2)
    expect(styles()).toBe(2)

    expect(e.disablePlugin('app.nilvn.fx')).toBe(true)
    expect(waves()).toBe(0)
    expect(e.stage.textEl.textContent).toBe('hi there') // still parked, just plain
    expect(styles()).toBe(1) // only the other engine's survives
    expect(e.activePlugins).not.toContain('app.nilvn.fx')

    expect(await e.enablePlugin('fx')).toBe(true) // short name still works
    expect(waves()).toBe(2)
    expect(styles()).toBe(2)

    expect(await e.reloadPlugin('app.nilvn.fx')).toBe(true)
    expect(waves()).toBe(2)
    expect(styles()).toBe(2)
    e.destroy()
    other.destroy()
    expect(styles()).toBe(0)
  })

  it('setPlugins diffs the active set and never removes a host-installed plugin', async () => {
    const pinned = probe('test.pinned')
    const { fx, cmd, plain } = fxFixtures()
    const e = newEngine({ plugins: [pinned.plugin], registry: [fx, cmd, plain], use: ['fx', 'cmd'], textSpeed: 0 })
    e.loadSource('[set x = 1]')
    await e.start()
    expect(e.activePlugins).toEqual(['test.pinned', 'app.nilvn.fx', 'app.nilvn.cmd'])
    await e.setPlugins(['app.nilvn.cmd', 'plain'])
    expect(e.activePlugins).toEqual(['test.pinned', 'app.nilvn.cmd', 'app.nilvn.plain'])
    await e.setPlugins([])
    expect(e.activePlugins).toEqual(['test.pinned'])
    e.destroy()
  })

  it('reload re-imports a path plugin cache-busted, carries the save slice, and rolls back a broken module', async () => {
    const imports: string[] = []
    let version = 1
    const make = (v: number): EnginePlugin => ({
      id: 'test.reload',
      permissions: ['save.slice', 'vars.write'],
      commands: { bump: ({ plugin }) => plugin.vars!.set('v', v) },
      saveState: () => ({ carried: 'yes' }),
      restoreState: (ctx, data) => ctx.vars!.set('restored', (data as { carried: string }).carried),
      activate: v === 3 ? () => { throw new Error('v3 is broken') } : undefined,
    })
    const loader: PluginLoader = {
      fetchManifest: () => Promise.reject(new Error('no manifests here')),
      importModule: (url) => {
        imports.push(url)
        return Promise.resolve({ default: make(version) })
      },
    }
    const e = newEngine({ pluginLoader: loader, baseUrl: 'https://example.test/game/', textSpeed: 0 })
    e.loadSource('[use ./plugins/hot.js]\n[bump]')
    await e.start()
    expect(imports).toEqual(['https://example.test/game/plugins/hot.js'])
    expect(e.vars.v).toBe(1)

    version = 2
    expect(await e.reloadPlugin('test.reload')).toBe(true)
    expect(imports[1]).toMatch(/^https:\/\/example\.test\/game\/plugins\/hot\.js\?reload=\d+$/)
    expect(e.vars.restored).toBe('yes') // the slice crossed the reload
    e.loadSource('[bump]')
    await e.start()
    expect(e.vars.v).toBe(2)

    version = 3
    expect(await e.reloadPlugin('test.reload')).toBe(true) // rolled back to v2 — still active
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('rolled back'))
    e.loadSource('[bump]')
    await e.start()
    expect(e.vars.v).toBe(2)
    e.destroy()
  })
})

describe('[use] resolution', () => {
  const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
    id: 'com.example.pkg',
    name: 'plugin.pkg.name',
    version: '1.0.0',
    engine: '>=0.1 <1',
    entries: { engine: './engine.js' },
    permissions: ['vars.write'],
    styles: ['./main.css'],
    messages: { en: { 'plugin.pkg.hello': 'Hello {who}' }, zh: { 'plugin.pkg.hello': '你好 {who}' } },
    ...over,
  })
  const pkgModule: EnginePlugin = {
    id: 'com.example.pkg',
    commands: { greet: ({ plugin, str }) => plugin.vars!.set('greeting', plugin.t('plugin.pkg.hello', { who: str(0, '?') })) },
  }
  const loaderFor = (m: PluginManifest, mod: EnginePlugin = pkgModule): PluginLoader & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      fetchManifest: (url) => {
        calls.push(`manifest:${url}`)
        return Promise.resolve(m)
      },
      importModule: (url) => {
        calls.push(`import:${url}`)
        return Promise.resolve({ default: mod })
      },
      fetchText: (url) => {
        calls.push(`css:${url}`)
        return Promise.resolve('.pkg{color:red}')
      },
    }
  }

  it('loads a plugin package by its plugin.json: manifest → entry module → styles → messages', async () => {
    const loader = loaderFor(manifest())
    const e = newEngine({ pluginLoader: loader, baseUrl: 'https://example.test/game/', textSpeed: 0, lang: 'zh', defaultLang: 'zh' })
    e.loadSource('[use ./plugins/pkg/plugin.json]\n[greet 世界]')
    await e.start()
    expect(loader.calls).toEqual([
      'manifest:https://example.test/game/plugins/pkg/plugin.json',
      'import:https://example.test/game/plugins/pkg/engine.js',
      'css:https://example.test/game/plugins/pkg/main.css',
    ])
    expect(e.activePlugins).toContain('com.example.pkg')
    expect(e.vars.greeting).toBe('你好 世界') // the package's own messages, in the work language
    expect(document.querySelector('style[data-plugin="com.example.pkg"]')?.textContent).toBe('.pkg{color:red}')
    expect(e.missingPlugins).toEqual([])
    e.destroy()
  })

  it('rejects a package outside its engine range, or whose module id disagrees, as missing', async () => {
    const e = newEngine({ pluginLoader: loaderFor(manifest({ engine: '>=99' })), baseUrl: 'https://example.test/', textSpeed: 0 })
    e.loadSource('[use ./a/plugin.json]\n[greet x]')
    await e.start()
    expect(e.missingPlugins).toEqual(['./a/plugin.json'])
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('requires engine >=99'))
    expect(e.vars.greeting).toBeUndefined()
    e.destroy()

    const e2 = newEngine({ pluginLoader: loaderFor(manifest(), { ...pkgModule, id: 'com.example.other' }), baseUrl: 'https://example.test/', textSpeed: 0 })
    e2.loadSource('[use ./a/plugin.json]')
    await e2.start()
    expect(e2.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('does not match plugin.json id'))
    e2.destroy()
  })

  it('an unknown id-shaped name is missing (not fetched); a first-party-namespaced registry plugin answers to id and short name', async () => {
    const loader = loaderFor(manifest())
    const { fx } = fxFixtures()
    const e = newEngine({ pluginLoader: loader, registry: [fx], textSpeed: 0 })
    e.loadSource('[use com.example.nope app.nilvn.fx fx]\n[set x = 1]')
    await e.start()
    expect(loader.calls).toEqual([])
    expect(e.missingPlugins).toEqual(['com.example.nope'])
    expect(e.activePlugins.filter((id) => id === 'app.nilvn.fx')).toHaveLength(1)
    e.destroy()
  })
})

describe('activation modes and dependencies', () => {
  it('onCommand activation wakes a registered plugin on its first command; manual waits for enablePlugin', async () => {
    let lazyActivated = 0
    let manualActivated = 0
    const lazy: EnginePlugin = { id: 'test.lazy', activation: 'onCommand', permissions: ['vars.write'], commands: { lazy: ({ plugin }) => plugin.vars!.set('lazy', true) }, activate: () => void lazyActivated++ }
    const manual: EnginePlugin = { id: 'test.manual', activation: 'manual', activate: () => void manualActivated++ }
    const e = newEngine({ registry: [lazy, manual], use: ['test.lazy', 'test.manual'], textSpeed: 0 })
    e.loadSource('[set x = 1]\n[lazy]')
    await e.start()
    expect(lazyActivated).toBe(1)
    expect(e.vars.lazy).toBe(true)
    expect(manualActivated).toBe(0)
    expect(e.pluginState('test.manual')).toBe('registered')
    expect(await e.enablePlugin('test.manual')).toBe(true)
    expect(manualActivated).toBe(1)
    e.destroy()
  })

  it('dependencies activate first; a missing or incompatible one blocks with a diagnostic', async () => {
    const order: string[] = []
    const dep: EnginePlugin = { id: 'test.dep', version: '1.2.0', activate: () => void order.push('dep') }
    const main: EnginePlugin = { id: 'test.main', dependencies: { 'test.dep': '^1' }, activate: () => void order.push('main') }
    const tooNew: EnginePlugin = { id: 'test.toonew', dependencies: { 'test.dep': '^2' } }
    const orphan: EnginePlugin = { id: 'test.orphan', dependencies: { 'test.missing': '*' } }
    const e = newEngine({ registry: [dep, main, tooNew, orphan], use: ['test.main', 'test.toonew', 'test.orphan'], textSpeed: 0 })
    e.loadSource('[set x = 1]')
    await e.start()
    expect(order).toEqual(['dep', 'main'])
    expect(e.activePlugins).toEqual(['test.dep', 'test.main'])
    expect(e.pluginState('test.toonew')).toBe('blocked')
    expect(e.pluginState('test.orphan')).toBe('blocked')
    const msgs = e.diagnostics.map((d) => d.message)
    expect(msgs).toContainEqual(expect.stringContaining('is 1.2.0, needs ^2'))
    expect(msgs).toContainEqual(expect.stringContaining('missing dependency "test.missing"'))
    e.destroy()
  })

  it('an invalid id is refused at registration with a diagnostic', () => {
    const e = newEngine({ plugins: [{ id: 'NotReverseDns' }] })
    expect(e.activePlugins).toEqual([])
    expect(e.diagnostics[0]).toMatchObject({ phase: 'plugin', message: expect.stringContaining('invalid plugin id') })
    e.destroy()
  })
})
