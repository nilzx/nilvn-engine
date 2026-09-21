// @vitest-environment jsdom
// The robustness contract: the engine
// never throws to the host over CONTENT. Bad lines are skipped, a missing plugin
// degrades to no-ops, an unknown jump target stays put, a plugin that keeps
// failing is quarantined, and a chunk that cannot be fetched ends the script
// cleanly — every case leaving a diagnostic behind instead of an exception.
import { describe, it, expect, beforeAll } from 'vitest'
import { newEngine, makeFixture, InlineLoader, view } from './helpers'
import { parseScript } from '../src/parser'
import type { EnginePlugin, EngineDiagnostic } from '../src/index'
import type { ContentLoader, ScriptChunk } from '@nilvn/core'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}

/** Run a pure-flow script (no dialogue, so start() resolves) and hand back the engine. */
async function run(script: string, opts: Parameters<typeof newEngine>[0] = {}) {
  const e = newEngine({ textSpeed: 0, ...opts })
  e.loadSource(script)
  await e.start()
  return e
}

describe('clickable regions', () => {
  // jsdom has no layout, so the probe's two inputs are stubbed: a rect to measure
  // and an answer for "what is drawn at this point". The logic under test is what
  // the engine does with that answer.
  const withStubs = async (answer: () => Element | null, fn: () => Promise<void>): Promise<void> => {
    const proto = Element.prototype as unknown as { getBoundingClientRect: () => DOMRect }
    const realRect = proto.getBoundingClientRect
    const realFrom = document.elementFromPoint // jsdom may not define it at all
    proto.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 100, height: 100, right: 110, bottom: 110, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
    document.elementFromPoint = answer as typeof document.elementFromPoint
    try {
      await fn()
    } finally {
      proto.getBoundingClientRect = realRect
      if (realFrom) document.elementFromPoint = realFrom
      else delete (document as Partial<Document>).elementFromPoint
    }
  }

  it('reports a hotspot the dialogue box covers — the coordinates read fine, the click never lands', async () => {
    const box = document.createElement('div')
    box.className = 'nilvn-text'
    document.body.append(box)
    await withStubs(
      () => box,
      async () => {
        const e = await run('[hotspot door x=40 y=88 w=20 h=12 onclick="jump club_after"]\n[set a = 1]')
        expect(e.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('hotspot "door": "nilvn-text" covers its centre')])
        e.destroy()
      },
    )
    box.remove()
  })

  it('stays quiet when the region itself answers at its centre', async () => {
    await withStubs(
      () => [...document.querySelectorAll('.nilvn-hotspot')].pop() ?? null,
      async () => {
        const e = await run('[hotspot door x=40 y=10 w=20 h=12 onclick="jump club_after"]\n[set a = 1]')
        expect(e.diagnostics).toEqual([])
        e.destroy()
      },
    )
  })
})

describe('asset paths', () => {
  it('names an @prefix no [path] entry or [alias] declares, instead of letting it travel on as a URL segment', async () => {
    const e = await run('[bg @nope/room.png]\n[set a = 1]', { baseUrl: 'http://g.test/' })
    expect(e.diagnostics).toEqual([
      { phase: 'load', message: expect.stringContaining('unknown path alias "@nope"') as unknown as string },
    ])
    expect(e.resolve('@nope/room.png')).toBe('http://g.test/@nope/room.png') // still degrades, never throws
    e.destroy()
  })

  it('stays quiet once the prefix is declared', async () => {
    const e = await run('[alias @ok art]\n[bg @ok/room.png]\n[set a = 1]', { baseUrl: 'http://g.test/' })
    expect(e.diagnostics).toEqual([])
    expect(e.resolve('@ok/room.png')).toBe('http://g.test/art/room.png')
    e.destroy()
  })
})

describe('parser leniency', () => {
  it('skips a malformed [choice] line with a diagnostic and keeps parsing', () => {
    const { nodes, labels, diagnostics } = parseScript('[label a]\n[choice no arrow here]\n[set x = 1]')
    expect(nodes.map((n) => n.type)).toEqual(['label', 'command'])
    expect(labels).toEqual({ a: 0 })
    expect(diagnostics).toEqual([{ line: 2, message: expect.stringContaining('choice syntax') }])
  })

  it('reports no diagnostics for a clean script', () => {
    expect(parseScript('[label a]\nyuki: hi').diagnostics).toEqual([])
  })
})

describe('content problems never throw', () => {
  it('[use unknown] registers a missing plugin and play continues', async () => {
    const e = await run('[use nope]\n[set x = 1]')
    expect(e.vars.x).toBe(1)
    expect(e.missingPlugins).toEqual(['nope'])
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'plugin', plugin: 'nope' }))
  })

  it('a plugin module path that fails to import is a missing plugin, not a crash', async () => {
    const e = await run('[use ./does-not-exist.js]\n[set x = 1]')
    expect(e.vars.x).toBe(1)
    expect(e.missingPlugins).toEqual(['./does-not-exist.js'])
  })

  it('[jump unknown] stays in place and continues with the next node', async () => {
    const e = await run('[jump nowhere]\n[set x = 2]')
    expect(e.vars.x).toBe(2)
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'jump', line: 1, message: expect.stringContaining('nowhere') }))
  })

  it('[if … -> unknown] degrades to a no-op jump', async () => {
    const e = await run('[set x = 1]\n[if x == 1 -> nowhere]\n[set x = 3]')
    expect(e.vars.x).toBe(3)
    expect(e.diagnostics.filter((d) => d.phase === 'jump')).toHaveLength(1)
  })

  it('start(unknown label) plays from the top with a diagnostic', async () => {
    const e = newEngine({ textSpeed: 0 })
    e.loadSource('[set x = 5]')
    await e.start('missing')
    expect(e.vars.x).toBe(5)
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'jump', message: expect.stringContaining('missing') }))
  })

  it('a throwing builtin is an exec diagnostic pointing at its line; play continues', async () => {
    const e = await run('[set x = 1]\n[bg]\n[set x = 2]')
    expect(e.vars.x).toBe(2)
    const d = e.diagnostics.find((x) => x.phase === 'exec')!
    expect(d.line).toBe(2)
    expect(d.node).toMatchObject({ type: 'command', name: 'bg' })
    expect(d.error).toBeInstanceOf(Error)
  })

  it('unknown commands are reported once per line, not per execution', async () => {
    const e = await run('[set n = 0]\n[label top]\n[set n = n + 1]\n[frobnicate]\n[if n < 3 -> top]')
    expect(e.diagnostics.filter((d) => d.message.includes('frobnicate'))).toHaveLength(1)
  })

  it('a bad line in loadSource surfaces as a parse diagnostic', () => {
    const e = newEngine()
    e.loadSource('[choice broken]\nyuki: hi')
    expect(e.diagnostics).toEqual([expect.objectContaining({ phase: 'parse', line: 1 })])
  })

  it('notifies both the onError plugin hook and EngineOptions.onError', async () => {
    const seen: string[] = []
    const spy: EnginePlugin = { id: 'test.spy', hooks: { onError: (info) => seen.push(`hook:${info.phase}`) } }
    const e = await run('[jump nowhere]', { plugins: [spy], onError: (info: EngineDiagnostic) => seen.push(`opt:${info.phase}`) })
    expect(seen).toEqual(['hook:jump', 'opt:jump'])
    expect(e.diagnostics).toHaveLength(1)
  })

  it('caps the diagnostics list, dropping the oldest', async () => {
    const lines: string[] = []
    for (let i = 0; i < 520; i++) lines.push(`[jump nowhere${i}]`)
    const e = await run(lines.join('\n'))
    expect(e.diagnostics).toHaveLength(500)
    expect(e.diagnostics[0]!.message).toContain('nowhere20')
  })
})

describe('plugin isolation', () => {
  const boomPlugin = (): EnginePlugin => ({
    id: 'test.boom',
    permissions: ['vars.write'],
    commands: {
      boom() {
        throw new Error('kaboom')
      },
      fine({ plugin }) {
        plugin.vars!.set('ok', ((plugin.vars!.get('ok') as number | undefined) ?? 0) + 1)
      },
    },
  })

  it('quarantines a plugin after 3 consecutive command failures; its commands become no-ops', async () => {
    const e = await run('[boom]\n[boom]\n[boom]\n[boom]\n[fine]', { plugins: [boomPlugin()] })
    expect(e.isolatedPlugins).toEqual(['test.boom'])
    expect(e.vars.ok).toBeUndefined() // [fine] ran after isolation → no-op
    const execs = e.diagnostics.filter((d) => d.phase === 'exec' && d.plugin === 'test.boom')
    expect(execs).toHaveLength(3) // the 4th [boom] was silent
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'plugin', plugin: 'test.boom', message: expect.stringContaining('isolated') }))
  })

  it('a successful command resets the consecutive count', async () => {
    const e = await run('[boom]\n[boom]\n[fine]\n[boom]\n[boom]\n[fine]', { plugins: [boomPlugin()] })
    expect(e.isolatedPlugins).toEqual([])
    expect(e.vars.ok).toBe(2)
  })

  it('honors pluginFailureLimit and leaves other plugins untouched', async () => {
    const other: EnginePlugin = { id: 'test.other', permissions: ['vars.write'], commands: { touch({ plugin }) { plugin.vars!.set('touched', true) } } }
    const e = await run('[boom]\n[touch]', { plugins: [boomPlugin(), other], pluginFailureLimit: 1 })
    expect(e.isolatedPlugins).toEqual(['test.boom'])
    expect(e.vars.touched).toBe(true)
  })

  it('a throwing activate() quarantines the plugin instead of failing install', async () => {
    const bad: EnginePlugin = {
      id: 'test.bad',
      permissions: ['vars.write'],
      commands: { mark({ plugin }) { plugin.vars!.set('mark', true) } },
      activate() {
        throw new Error('activate exploded')
      },
    }
    const e = await run('[mark]', { plugins: [bad] })
    expect(e.isolatedPlugins).toEqual(['test.bad'])
    expect(e.vars.mark).toBeUndefined()
    expect(e.diagnostics[0]).toMatchObject({ phase: 'plugin', plugin: 'test.bad', message: expect.stringContaining('activate') })
  })

  it('a throwing hook is reported against its plugin and does not abort the line', async () => {
    const hooky: EnginePlugin = {
      id: 'test.hooky',
      hooks: {
        onDialogue() {
          throw new Error('hook boom')
        },
      },
    }
    const e = newEngine({ textSpeed: 0, plugins: [hooky] })
    e.loadSource('yuki: hello there')
    void e.start()
    await until(() => view(e).stage.textEl.textContent === 'hello there')
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'plugin', plugin: 'test.hooky', message: expect.stringContaining('onDialogue') }))
    e.destroy()
  })

  it('a throwing text effect leaves the character revealed', async () => {
    const fx: EnginePlugin = {
      id: 'test.fx',
      textEffects: {
        bad() {
          throw new Error('effect boom')
        },
      },
    }
    const e = newEngine({ textSpeed: 0, plugins: [fx] })
    e.loadSource('yuki: {bad:hi} there')
    void e.start()
    await until(() => view(e).stage.textEl.textContent === 'hi there')
    expect(e.diagnostics.filter((d) => d.plugin === 'test.fx')).toHaveLength(1) // once, not per character
    e.destroy()
  })
})

describe('chunk load failures', () => {
  /** A ContentLoader that fails on demand for named chunks / locale slices. */
  class FlakyLoader implements ContentLoader {
    failChunks = new Set<string>()
    failLocales = new Set<string>()
    loadCalls: string[] = []
    localeCalls: string[] = []
    assetCalls: string[] = []
    releaseCalls: string[] = []
    constructor(private readonly inner: InlineLoader) {}
    loadChunk(id: string): Promise<ScriptChunk> {
      if (this.failChunks.has(id)) return Promise.reject(new Error(`network down for ${id}`))
      return this.inner.loadChunk(id)
    }
    loadLocale(lang: string, sliceId: string) {
      if (this.failLocales.has(`${lang}/${sliceId}`)) return Promise.reject(new Error('slice down'))
      return this.inner.loadLocale(lang, sliceId)
    }
    assetUrl(ref: string) {
      return this.inner.assetUrl(ref)
    }
    releaseChunk(id: string) {
      this.inner.releaseChunk(id)
    }
  }
  const flaky = (defs: Parameters<typeof makeFixture>[0], locales?: Parameters<typeof makeFixture>[1]) => {
    const { manifest, loader } = makeFixture(defs, locales)
    return { manifest, loader: new FlakyLoader(loader) }
  }
  const zh = { lang: 'zh', defaultLang: 'zh', languages: ['zh'] }

  it('a fall-through successor that cannot be fetched ends the script cleanly (onEnd fires)', async () => {
    const { manifest, loader } = flaky([{ id: 's1', next: ['s2'] }, { id: 's2' }])
    loader.failChunks.add('s2')
    let ended = false
    const e = newEngine({ manifest, loader, ...zh, onEnd: () => (ended = true) })
    await e.start()
    expect(ended).toBe(true)
    expect(e.vars.x).toBe(0) // s1 ran
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'load', message: expect.stringContaining('s2') }))
  })

  it('a jump whose target chunk cannot be fetched is skipped with a load diagnostic', async () => {
    const { manifest, loader } = flaky([
      { id: 's1', body: '[label s1]\n[jump s3]\n[set x = 9]\n', branchTargets: ['s3'] },
      { id: 's3', body: '[label s3]\n[set x = 3]\n' },
    ])
    loader.failChunks.add('s3')
    const e = newEngine({ manifest, loader, ...zh })
    await e.start()
    expect(e.vars.x).toBe(9)
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'load', chunk: 's3', line: 2 }))
  })

  it('a text slice that fails to load does not block the chunk', async () => {
    const { manifest, loader } = flaky([{ id: 's1' }], { zh: { base: {}, s1: { k: 'v' } } })
    loader.failLocales.add('zh/s1')
    const e = newEngine({ manifest, loader, ...zh })
    await e.start()
    expect(e.vars.x).toBe(0)
    expect(e.diagnostics.filter((d) => d.phase === 'load')).toHaveLength(1)
  })

  it('an entry chunk that cannot be fetched leaves start() resolved with a diagnostic', async () => {
    const { manifest, loader } = flaky([{ id: 's1' }])
    loader.failChunks.add('s1')
    const e = newEngine({ manifest, loader, ...zh })
    await expect(e.start()).resolves.toBeUndefined()
    expect(e.diagnostics[0]).toMatchObject({ phase: 'load', chunk: 's1' })
  })

  it('restoreState returns false (not a rejection) when the saved chunk cannot load', async () => {
    const { manifest, loader } = flaky([{ id: 's1', next: ['s2'] }, { id: 's2' }])
    const e = newEngine({ manifest, loader, ...zh })
    await e.start()
    const save = e.saveState()
    save.at = { label: 's2', offset: 0 }
    const again = flaky([{ id: 's1', next: ['s2'] }, { id: 's2' }])
    again.loader.failChunks.add('s2')
    const e2 = newEngine({ manifest: again.manifest, loader: again.loader, ...zh })
    await expect(e2.restoreState(save)).resolves.toBe(false)
    expect(e2.diagnostics[0]).toMatchObject({ phase: 'load', chunk: 's2' })
  })
})
