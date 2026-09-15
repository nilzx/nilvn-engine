import { describe, it, expect } from 'vitest'
import { buildChunkedExport, isChunkManifest, CHUNK_MANIFEST_FORMAT } from '../src/index'
import { makeProject } from './fixtures'

// The version-mismatch / garbage-manifest gate. Producer AND loader both call this
// before trusting a fetched manifest, so a truncated or foreign JSON fails cleanly
// instead of misparsing deep in playback.
describe('isChunkManifest', () => {
  const real = buildChunkedExport(makeProject(), { engine: '0.10.0' }).manifest

  it('accepts a real manifest from buildChunkedExport', () => {
    expect(isChunkManifest(real)).toBe(true)
    expect(real.format).toBe(CHUNK_MANIFEST_FORMAT)
  })

  it('rejects non-objects', () => {
    for (const x of [null, undefined, 42, 'x', true, []]) {
      expect(isChunkManifest(x)).toBe(false)
    }
  })

  it('rejects a manifest missing any required field', () => {
    // Every required key, dropped one at a time, must fail the guard.
    for (const key of Object.keys(real)) {
      const clone: Record<string, unknown> = { ...real }
      delete clone[key]
      expect(isChunkManifest(clone), `dropping "${key}" should fail the guard`).toBe(false)
    }
  })

  it('rejects a malformed entry (missing entry.label)', () => {
    expect(isChunkManifest({ ...real, entry: {} })).toBe(false)
  })
})
