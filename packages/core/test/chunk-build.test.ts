import { describe, it, expect } from 'vitest'
import { buildChunkedExport } from '../src/index'
import { makeProject } from './fixtures'

// The chunked-export producer. Turns a Project into the manifest +
// chunk/locale file contents. Pure, zero-I/O. These assertions are the durable form
// of the batch-5 inc-2a manual checks.
describe('buildChunkedExport', () => {
  it('emits one chunk per scene by default, keyed by scene id', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    expect(manifest.chunks.map((c) => c.id)).toEqual(['s1', 's2'])
    expect(manifest.sceneOrder).toEqual(['s1', 's2'])
    expect(manifest.entry).toEqual({ label: 's1' })
  })

  it('builds a globally-unique labelIndex mapping every label to its chunk', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    expect(manifest.labelIndex).toEqual({ s1: 's1', s2: 's2' })
  })

  it('throws on a duplicate jump label across chunks', () => {
    const p = makeProject()
    // Give both scenes an in-scene label node with the SAME name → collision.
    p.scenes[0]!.nodes.push({ kind: 'label', id: 'l1', name: 'dup' })
    p.scenes[1]!.nodes.push({ kind: 'label', id: 'l2', name: 'dup' })
    expect(() => buildChunkedExport(p, { engine: '0.10.0' })).toThrow(/Duplicate jump label "dup"/)
  })

  it('computes fall-through `next` and explicit `branchTargets`', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    const s1 = manifest.chunks.find((c) => c.id === 's1')!
    const s2 = manifest.chunks.find((c) => c.id === 's2')!
    // s1 ends in a choice (not an unconditional jump) → falls through to s2 in order,
    // and its choice targets s2 → branchTargets has s2.
    expect(s1.next).toEqual(['s2'])
    expect(s1.branchTargets).toEqual(['s2'])
    // s2 ends in an UNCONDITIONAL jump → no fall-through; the jump targets s1.
    expect(s2.next).toEqual([])
    expect(s2.branchTargets).toEqual(['s1'])
  })

  it('collects a deduped union of asset refs (voice + command param)', () => {
    const { assetRefs } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    expect(new Set(assetRefs)).toEqual(new Set(['voice/hi.webm', 'bg/room.png']))
  })

  it('leaves manifest.assets empty for the editor to fill', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    expect(manifest.assets).toEqual({})
  })

  it('slices locales into a project-level base + one slice per chunk', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    const zh = manifest.locales.zh!
    const base = zh.find((s) => s.id === 'base')!
    // The `base` slice carries keys NOT referenced by any scene body — here the actor
    // name and the scene titles — and is always warm (loaded with meta).
    expect(base.scenes).toEqual([])
    // Per-chunk slices parallel the scene chunks.
    expect(zh.map((s) => s.id)).toEqual(['base', 's1', 's2'])
    expect(zh.find((s) => s.id === 's1')!.scenes).toEqual(['s1'])
    // Every declared language gets its own slice list.
    expect(Object.keys(manifest.locales).sort()).toEqual(['en', 'zh'])
  })

  it('meta.json is the project MINUS scenes and catalogs', () => {
    const { files } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    const meta = files.find((f) => f.path === 'chunks/meta.json')!
    const parsed = JSON.parse(meta.text)
    expect(parsed.scenes).toBeUndefined()
    expect(parsed.catalogs).toBeUndefined()
    expect(parsed.actors).toBeDefined()
    expect(parsed.meta.title).toBe('Test Project')
  })

  it('every file byte count matches the UTF-8 length of its text', () => {
    const { files } = buildChunkedExport(makeProject(), { engine: '0.10.0' })
    for (const f of files) {
      expect(f.bytes, `bytes for ${f.path}`).toBe(Buffer.byteLength(f.text, 'utf8'))
    }
  })

  it('merges scenes into one chunk when groups are given', () => {
    const { manifest } = buildChunkedExport(makeProject(), { engine: '0.10.0', groups: [['s1', 's2']] })
    expect(manifest.chunks).toHaveLength(1)
    expect(manifest.chunks[0]!.scenes).toEqual(['s1', 's2'])
    // Both scene labels still resolve to the single merged chunk (its id = first scene).
    expect(manifest.labelIndex).toEqual({ s1: 's1', s2: 's1' })
  })
})
