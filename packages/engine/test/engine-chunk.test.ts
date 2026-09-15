// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { newChunkedEngine, newEngine, makeFixture, view, isHole } from './helpers'

/** Let queued background work (prefetch staging) settle. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// The chunked-streaming runtime, driving the real engine
// source through the in-memory InlineLoader. These pin the addressing / residency /
// eviction invariants the batch-5 browser assertions verified against the shipped IIFE.
describe('chunked residency (ensureLoaded / mergeChunk)', () => {
  it('merges a chunk on demand: nodes appended, label at base, resident', async () => {
    const { e, loader } = newChunkedEngine()
    const v = view(e)
    await v.ensureLoaded('s1')
    expect(v.residentChunks.has('s1')).toBe(true)
    expect(v.chunkBase.get('s1')).toBe(0)
    expect(v.labels.s1).toBe(0)
    expect(v.nodes.length).toBeGreaterThan(0)
    expect(loader.loadCalls).toEqual(['s1', 's2']) // s2 = tail-① prefetch of s1's fall-through
  })

  it('is idempotent — a resident chunk is not re-fetched', async () => {
    const { e, loader } = newChunkedEngine()
    await view(e).ensureLoaded('s1')
    await view(e).ensureLoaded('s1')
    expect(loader.loadCalls).toEqual(['s1', 's2']) // prefetch deduped too — no repeats
  })

  it('does not fetch for an unknown label', async () => {
    const { e, loader } = newChunkedEngine()
    await view(e).ensureLoaded('nope')
    expect(loader.loadCalls).toEqual([])
  })

  it('dedupes concurrent loads of the same chunk', async () => {
    const { e, loader } = newChunkedEngine()
    const v = view(e)
    await Promise.all([v.ensureLoaded('s2'), v.ensureLoaded('s2')])
    expect(loader.loadCalls.filter((x) => x === 's2')).toHaveLength(1)
  })

  it('lazily loads the chunk\'s locale slice and merges it into the catalog', async () => {
    const { e, loader } = newChunkedEngine()
    await view(e).ensureLoaded('s1')
    expect(loader.localeCalls).toContain('zh/s1')
    expect(view(e).catalogs.zh!['k.s1']).toBe('text s1')
  })
})

describe('async jump across chunks', () => {
  it('loads the target chunk then lands the playhead on its label', async () => {
    const { e, loader } = newChunkedEngine()
    const v = view(e)
    await v.ensureLoaded('s1')
    await e.jump('s3') // s3 not yet resident
    expect(v.residentChunks.has('s3')).toBe(true)
    expect(v.pos).toBe(v.labels.s3)
    expect(loader.loadCalls).toContain('s3')
  })
})

describe('start() fall-through streaming (append-only, no ceiling)', () => {
  it('streams every chunk in fall-through order, each loaded exactly once', async () => {
    const { e, loader } = newChunkedEngine()
    await e.start()
    expect(view(e).residentChunks.size).toBe(5)
    expect([...loader.loadCalls].sort()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })

  it('leaves no eviction holes when no ceiling is set (byte-identical to today)', async () => {
    const { e } = newChunkedEngine() // no maxResidentChunks
    await e.start()
    expect(view(e).nodes.some(isHole)).toBe(false)
  })
})

describe('background prefetch', () => {
  it('stages successors without merging — physical order stays demand-driven', async () => {
    const { manifest, loader } = makeFixture([
      { id: 'a', next: ['b'], branchTargets: ['c'] },
      { id: 'b' },
      { id: 'c' },
    ])
    const e = newEngine({ manifest, loader, lang: 'zh', defaultLang: 'zh' })
    const v = view(e)
    await v.ensureLoaded('a')
    await tick()
    // Both hinted successors were fetched ahead…
    expect([...loader.loadCalls].sort()).toEqual(['a', 'b', 'c'])
    expect([...v.prefetched.keys()].sort()).toEqual(['b', 'c'])
    // …but neither entered the script: no residency, no nodes, no base.
    expect(v.residentChunks.has('b')).toBe(false)
    expect(v.residentChunks.has('c')).toBe(false)
    expect(v.chunkBase.has('b')).toBe(false)
    expect(v.nodes.length).toBe(v.chunkLen.get('a'))
  })

  it('demand consumes the staged decode without a second fetch', async () => {
    const { e, loader } = newChunkedEngine()
    const v = view(e)
    await v.ensureLoaded('s1')
    await tick() // let the s2 prefetch stage
    await v.ensureLoaded('s2')
    expect(loader.loadCalls.filter((x) => x === 's2')).toHaveLength(1)
    expect(v.residentChunks.has('s2')).toBe(true)
    expect(v.prefetched.has('s2')).toBe(false) // consumed
  })

  it('warms the current language slice of a hinted successor', async () => {
    const { e, loader } = newChunkedEngine()
    await view(e).ensureLoaded('s1')
    await tick()
    expect(loader.localeCalls).toContain('zh/s2')
    expect(view(e).catalogs.zh!['k.s2']).toBe('text s2') // catalog merge may land fully
  })

  it('retires staged entries the play moved away from', async () => {
    const { e } = newChunkedEngine()
    const v = view(e)
    await v.ensureLoaded('s1') // hints {s2}
    await tick()
    expect(v.prefetched.has('s2')).toBe(true)
    await v.ensureLoaded('s4') // hints {s5} — s2 is no longer where play is going
    await tick()
    expect(v.prefetched.has('s2')).toBe(false)
    expect(v.prefetched.has('s5')).toBe(true)
  })
})

describe('empty-chunk fall-through', () => {
  it('skips through a zero-node chunk to its successor instead of ending', async () => {
    const { manifest, loader } = makeFixture([
      { id: 'a', next: ['gap'] },
      { id: 'gap', body: '', next: ['c'] }, // parses to zero nodes
      { id: 'c', body: '[label c]\n[set y = 7]\n' },
    ])
    const e = newEngine({ manifest, loader, lang: 'zh', defaultLang: 'zh' })
    await e.start()
    const v = view(e)
    expect(v.residentChunks.has('gap')).toBe(true) // visited (and empty)
    expect(v.chunkLen.get('gap')).toBe(0)
    expect(v.residentChunks.has('c')).toBe(true) // play continued past the gap
    expect((e as unknown as { vars: Record<string, unknown> }).vars.y).toBe(7)
  })

  it('a trailing empty chunk still ends the script cleanly', async () => {
    const { manifest, loader } = makeFixture([
      { id: 'a', next: ['gap'] },
      { id: 'gap', body: '', next: [] },
    ])
    let ended = false
    const e = newEngine({ manifest, loader, lang: 'zh', defaultLang: 'zh', onEnd: () => (ended = true) })
    await e.start()
    expect(ended).toBe(true)
  })
})

describe('language switch fills resident slices', () => {
  const bilingual = () =>
    makeFixture(
      [{ id: 's1', next: ['s2'] }, { id: 's2' }],
      {
        zh: { base: {}, s1: { 'k.s1': 'zh s1' }, s2: { 'k.s2': 'zh s2' } },
        ja: { base: {}, s1: { 'k.s1': 'ja s1' }, s2: { 'k.s2': 'ja s2' } },
      },
    )

  it('setLanguage fetches every resident chunk\'s slice for the new language', async () => {
    const { manifest, loader } = bilingual()
    const e = newEngine({ manifest, loader, lang: 'zh', defaultLang: 'zh', languages: ['zh', 'ja'], catalogs: { zh: {}, ja: {} } })
    const v = view(e)
    await v.ensureLoaded('s1')
    await v.ensureLoaded('s2')
    expect(loader.localeCalls).not.toContain('ja/s1') // nothing fetched ahead of the switch
    await e.setLanguage('ja')
    expect(loader.localeCalls).toContain('ja/s1')
    expect(loader.localeCalls).toContain('ja/s2')
    expect(v.catalogs.ja!['k.s1']).toBe('ja s1')
    expect(e.resolveText('k.s2')).toBe('ja s2')
  })

  it('repaints the parked line once the new slice lands (the T6 repro)', async () => {
    const { manifest, loader } = bilingual()
    const e = newEngine({ manifest, loader, lang: 'zh', defaultLang: 'zh', languages: ['zh', 'ja'], catalogs: { zh: {}, ja: {} } })
    const v = view(e)
    await v.ensureLoaded('s1')
    // Park a keyed dialogue line the way execDialogue does, then paint it in zh.
    v.shown = { kind: 'dialogue', node: { type: 'dialogue', segments: [], textKey: 'k.s1', line: 1 } }
    const done = e.setLanguage('ja')
    // Synchronous half: chrome/lang flip at once, but the ja slice isn't merged
    // yet, so the repaint falls back to the default language — the T6 symptom.
    expect(e.lang).toBe('ja')
    expect(v.stage.textEl.textContent).toBe('zh s1')
    await done
    expect(v.stage.textEl.textContent).toBe('ja s1') // slice landed → repainted
  })

  it('restoring a save carrying another language fills its slices before resuming', async () => {
    const src = bilingual()
    const srcEngine = newEngine({ manifest: src.manifest, loader: src.loader, lang: 'zh', defaultLang: 'zh', languages: ['zh', 'ja'], catalogs: { zh: {}, ja: {} } })
    await view(srcEngine).ensureLoaded('s2')
    view(srcEngine).resumeIndex = view(srcEngine).chunkBase.get('s2')!
    await srcEngine.setLanguage('ja')
    const st = srcEngine.saveState()
    expect(st.lang).toBe('ja')

    const dst = bilingual()
    const dstEngine = newEngine({ manifest: dst.manifest, loader: dst.loader, lang: 'zh', defaultLang: 'zh', languages: ['zh', 'ja'], catalogs: { zh: {}, ja: {} } })
    expect(await dstEngine.restoreState(st)).toBe(true)
    expect(dstEngine.lang).toBe('ja')
    expect(dst.loader.localeCalls).toContain('ja/s2') // resumed chunk's ja slice fetched
    expect(dstEngine.resolveText('k.s2')).toBe('ja s2')
  })
})
