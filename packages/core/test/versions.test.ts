import { describe, it, expect } from 'vitest'
import { FORMAT_VERSIONS, CURRENT_SCHEMA_VERSION, CHUNK_MANIFEST_FORMAT, PACKAGE_FORMAT, PLUGIN_API_VERSION } from '../src/index'

// The compatibility table is the one place every format number is listed;
// each entry must mirror the constant the gating code actually reads.
describe('FORMAT_VERSIONS', () => {
  it('mirrors the live constants', () => {
    expect(FORMAT_VERSIONS.irSchema).toBe(CURRENT_SCHEMA_VERSION)
    expect(FORMAT_VERSIONS.chunkManifest).toBe(CHUNK_MANIFEST_FORMAT)
    expect(FORMAT_VERSIONS.package).toBe(PACKAGE_FORMAT)
    expect(FORMAT_VERSIONS.saveState).toBe(2)
    expect(FORMAT_VERSIONS.saveSlot).toBe(1)
    expect(FORMAT_VERSIONS.pluginApi).toBe(PLUGIN_API_VERSION)
    expect(Object.isFrozen(FORMAT_VERSIONS)).toBe(true)
  })
})
