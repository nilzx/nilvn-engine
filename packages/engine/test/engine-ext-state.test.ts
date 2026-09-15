// @vitest-environment jsdom
// SaveState.ext — the per-plugin state slot (keyed by plugin id). The contract worth pinning is fourfold: new saves write the
// slot under the plugin id, an older save keyed by a first-party SHORT name
// still restores (the host aliases `app.nilvn.<x>` ↔ `<x>`), a slice whose plugin
// isn't active survives a load→save round trip untouched, and a restart drops
// carried slices. The plugin here is a fixture with `save.slice`; the real
// animstudio loop slice is pinned in @nilvn/plugins' own tests.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, type Engine, type EnginePlugin, type SaveState } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const SCRIPT = `[label s1]
yuki: First line
yuki: Second line
`

/** A first-party-shaped plugin owning one slice: a counter it bumps on demand. */
function slicePlugin(): { plugin: EnginePlugin; count: () => number; bump: () => void } {
  let n = 0
  const plugin: EnginePlugin = {
    id: 'app.nilvn.slice',
    permissions: ['save.slice'],
    saveState: () => (n ? { n } : undefined),
    restoreState: (_ctx, data) => {
      n = (data as { n?: number } | undefined)?.n ?? 0
    },
  }
  return { plugin, count: () => n, bump: () => void n++ }
}

function freshEngine(plugins: EnginePlugin[] = []): Engine {
  const container = document.createElement('div')
  document.body.append(container)
  const engine = createEngine({ container, textSpeed: 0, plugins })
  engine.loadSource(SCRIPT)
  return engine
}

describe('SaveState.ext', () => {
  it('is absent entirely when no plugin has state — saves stay byte-identical', () => {
    const { plugin } = slicePlugin()
    const engine = freshEngine([plugin])
    expect(engine.saveState().ext).toBeUndefined()
    engine.destroy()
  })

  it('carries a slice under the plugin ID, never the short name', () => {
    const s = slicePlugin()
    const engine = freshEngine([s.plugin])
    s.bump()
    expect(engine.saveState().ext).toEqual({ 'app.nilvn.slice': { n: 1 } })
    engine.destroy()
  })

  it('restores a pre-batch-B slice keyed by the first-party short name and re-saves it under the id', async () => {
    const donor = freshEngine()
    const base = donor.saveState()
    const legacy: SaveState = { ...structuredClone(base), ext: { slice: { n: 7 } } }
    const s = slicePlugin()
    const engine = freshEngine([s.plugin])
    expect(await engine.restoreState(legacy)).toBe(true)
    expect(s.count()).toBe(7)
    expect(Object.keys(engine.saveState().ext ?? {})).toEqual(['app.nilvn.slice'])
    donor.destroy()
    engine.destroy()
  })

  it('round-trips: a save with a slice restores it, and re-saves it identically', async () => {
    const a = slicePlugin()
    const ea = freshEngine([a.plugin])
    a.bump()
    a.bump()
    const state = ea.saveState()
    const b = slicePlugin()
    const eb = freshEngine([b.plugin])
    expect(await eb.restoreState(structuredClone(state))).toBe(true)
    expect(b.count()).toBe(2)
    expect(eb.saveState().ext).toEqual(state.ext)
    ea.destroy()
    eb.destroy()
  })

  it('a slice whose plugin is not installed rides through load→save untouched', async () => {
    const donor = freshEngine()
    const state = donor.saveState()
    state.ext = { futureplugin: { treasure: 42 } }
    const engine = freshEngine()
    expect(await engine.restoreState(structuredClone(state))).toBe(true)
    expect(engine.saveState().ext).toEqual({ futureplugin: { treasure: 42 } })
    // A clean-slate restart is a NEW session — the carried slice belongs to the
    // restored one and must not leak into it.
    await engine.restart()
    expect(engine.saveState().ext).toBeUndefined()
    donor.destroy()
    engine.destroy()
  })

  it('a plugin command nobody provides is an inert no-op on the wire', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const engine = createEngine({ container, textSpeed: 0 })
    engine.loadSource(`[loopstart obj=camera dur=2 entry=scale=1 body=0:scale=1;2:scale=1]
yuki: hello
`)
    void engine.start()
    await new Promise((r) => setTimeout(r, 30))
    expect(engine.runningLoops()).toEqual([])
    expect(engine.saveState().ext).toBeUndefined()
    engine.destroy()
  })
})
