// @vitest-environment jsdom
// `[fonts]` (0.20.0): a work's font files register with the document by family,
// are shared between engines on one page, follow reconfigure() and go on destroy;
// the title page waits a moment for them.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, checkConfig, type Engine } from '../src/index'
import type { AdvConfig } from '../src/types'

class FakeFace {
  static made: FakeFace[] = []
  status = 'unloaded'
  resolveLoad!: () => void
  rejectLoad!: (e: Error) => void
  private readonly done: Promise<FakeFace>
  constructor(readonly family: string, readonly source: string, readonly descriptors: FontFaceDescriptors) {
    this.done = new Promise((res, rej) => {
      this.resolveLoad = () => res(this)
      this.rejectLoad = rej
    })
    FakeFace.made.push(this)
  }
  load(): Promise<FakeFace> {
    return this.done
  }
}
const added = new Set<FakeFace>()

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {} })
  ;(globalThis as Record<string, unknown>).FontFace = FakeFace
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: FakeFace) => added.add(f), delete: (f: FakeFace) => added.delete(f) },
  })
})
beforeEach(() => {
  FakeFace.made = []
  added.clear()
})

function engine(): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, baseUrl: 'http://g.test/' })
}
const families = (): string[] => [...added].map((f) => f.family).sort()

describe('[fonts]', () => {
  it('registers each family with its resolved file, swapping in once loaded', () => {
    const e = engine()
    applyConfig(e, { fonts: { 'Zcool KuaiLe': 'fonts/zcool.woff2' } } as AdvConfig)
    expect(families()).toEqual(['Zcool KuaiLe'])
    const f = FakeFace.made[0]!
    expect(f.source).toBe('url("http://g.test/fonts/zcool.woff2")')
    expect(f.descriptors.display).toBe('swap')
    e.destroy()
    expect(added.size).toBe(0)
  })

  it('reconfigure adds, keeps and drops families; engines on one page share a file', () => {
    const a = engine(), b = engine()
    applyConfig(a, { fonts: { A: 'a.woff2', B: 'b.ttf' } } as AdvConfig)
    applyConfig(b, { fonts: { A: 'a.woff2' } } as AdvConfig)
    expect(FakeFace.made.length).toBe(2) // A is registered once
    a.reconfigure({ fonts: { A: 'a.woff2', C: 'c.otf' } } as AdvConfig)
    expect(families()).toEqual(['A', 'C'])
    a.reconfigure({})
    expect(families()).toEqual(['A']) // b still holds it
    b.destroy()
    expect(added.size).toBe(0)
    a.destroy()
  })

  it('a file that fails reports and leaves the fallback; a bad entry reports', async () => {
    const e = engine()
    applyConfig(e, { fonts: { Broken: 'gone.woff2', Empty: '' } } as AdvConfig)
    FakeFace.made[0]!.rejectLoad(new Error('404'))
    await e.fonts.ready(50)
    const msgs = e.diagnostics.map((d) => d.message)
    expect(msgs.some((m) => m.includes('"Broken" could not load'))).toBe(true)
    expect(msgs.some((m) => m.includes('"Empty" needs a font file path'))).toBe(true)
    e.destroy()
  })

  it('the title page waits for the fonts, but not past the cap', async () => {
    const e = engine()
    applyConfig(e, { fonts: { Slow: 'slow.woff2' }, title: { heading: 'Hi' } } as AdvConfig)
    let shown = false
    void e.showTitle().then(() => (shown = true))
    await new Promise((r) => setTimeout(r, 30))
    expect(shown).toBe(false)
    FakeFace.made[0]!.resolveLoad()
    await new Promise((r) => setTimeout(r, 30))
    expect(shown).toBe(true)
    e.destroy()
  })

  it('is part of the config schema', () => {
    expect(checkConfig({ fonts: { A: 'a.woff2' } })).toEqual([])
    expect(checkConfig({ fonts: { A: 3 } }).length).toBe(1)
  })
})
