// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { newChunkedEngine, view, isHole } from './helpers'

// Opt-in window eviction + memory ceiling. With a ceiling, chunks
// outside the warm set (current + its next/branchTargets) are evicted LRU-first; the
// array length / indices / labels stay valid (only node OBJECTS freed), and a revisit
// re-parses in place. The playhead (pos) stays at 0 here, so its owner s1 + fall-through
// s2 are the protected warm set.
describe('eviction under a memory ceiling', () => {
  it('evicts the least-recently-used non-warm chunk once the ceiling is exceeded', async () => {
    const { e } = newChunkedEngine(2)
    const v = view(e)
    for (const id of ['s1', 's2', 's3', 's4']) await v.ensureLoaded(id)
    // pos=0 → owned by s1; warm = {s1, s1.next=s2}. Load order s1,s2,s3,s4 ⇒ s3 is the
    // oldest evictable when s4 arrives.
    expect(v.residentChunks.has('s3')).toBe(false)
    expect(v.residentChunks.has('s1')).toBe(true)
    expect(v.residentChunks.has('s2')).toBe(true)
    expect(v.residentChunks.has('s4')).toBe(true)
  })

  it('an evicted chunk keeps its base/labels; its slots become holes', async () => {
    const { e } = newChunkedEngine(2)
    const v = view(e)
    for (const id of ['s1', 's2', 's3', 's4']) await v.ensureLoaded(id)
    const base = v.chunkBase.get('s3')!
    expect(base).toBeDefined()
    expect(v.labels.s3).toBe(base) // addressing survives eviction
    expect(isHole(v.nodes[base]!)).toBe(true) // node object freed to the sentinel
  })

  it('re-materializes an evicted chunk in place on revisit (same base, no growth)', async () => {
    const { e, loader } = newChunkedEngine(2)
    const v = view(e)
    for (const id of ['s1', 's2', 's3', 's4']) await v.ensureLoaded(id)
    const base = v.chunkBase.get('s3')!
    const lenBefore = v.nodes.length
    const fetchesBefore = loader.loadCalls.length
    await v.ensureLoaded('s3') // revisit the evicted chunk
    expect(v.residentChunks.has('s3')).toBe(true)
    expect(v.chunkBase.get('s3')).toBe(base) // re-parsed into the SAME slots
    expect(v.nodes.length).toBe(lenBefore) // in place — array did not grow
    expect(isHole(v.nodes[base]!)).toBe(false) // real node again
    expect(loader.loadCalls.length).toBeGreaterThan(fetchesBefore) // was re-fetched
  })
})

describe('release notifications to the loader', () => {
  it('notifies the loader when a chunk is evicted, exactly once', async () => {
    const { e, loader } = newChunkedEngine(2)
    const v = view(e)
    for (const id of ['s1', 's2', 's3', 's4']) await v.ensureLoaded(id)
    // s3 was the only eviction (see the ceiling test above): the loader can
    // reclaim its bytes; a revisit re-fetches, so nothing is lost.
    expect(loader.releaseCalls).toEqual(['s3'])
  })

  it('destroy() releases every still-resident chunk', async () => {
    const { e, loader } = newChunkedEngine()
    const v = view(e)
    for (const id of ['s1', 's2', 's3']) await v.ensureLoaded(id)
    expect(loader.releaseCalls).toEqual([]) // no ceiling — nothing evicted mid-play
    e.destroy()
    expect([...loader.releaseCalls].sort()).toEqual(['s1', 's2', 's3'])
    expect(v.residentChunks.size).toBe(0)
  })
})

describe('save / restore across chunk residency', () => {
  it('restores a save whose address lands in a not-yet-resident chunk', async () => {
    // Build a save pointing into s3, then restore it into a FRESH engine where nothing
    // is resident — restoreState must load s3's chunk before resolving the address.
    const src = newChunkedEngine()
    const sv = view(src.e)
    await sv.ensureLoaded('s3')
    sv.resumeIndex = sv.chunkBase.get('s3')! // playhead at s3's first node
    const st = src.e.saveState()
    expect(st.at).toEqual({ label: 's3', offset: 0 })

    const dst = newChunkedEngine()
    const ok = await dst.e.restoreState(st)
    expect(ok).toBe(true)
    expect(view(dst.e).residentChunks.has('s3')).toBe(true)
  })
})
