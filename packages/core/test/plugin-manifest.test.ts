import { describe, it, expect } from 'vitest'
import {
  EXTENSION_POINTS,
  PERMISSIONS,
  PLUGIN_API_VERSION,
  matchPermission,
  validatePluginManifest,
  type PluginManifest,
} from '../src/index'

// The v2 manifest validator is the seam that guards third-party plugins: it must
// reject what the hosts cannot run, tolerate what they can ignore (forward
// compatibility), and never complain about a bundled manifest.
const base = (): PluginManifest => ({
  id: 'com.example.myfx',
  name: 'plugin.myfx.name',
  version: '1.0.0',
  entries: { engine: './engine.js' },
})

describe('validatePluginManifest', () => {
  it('accepts a minimal well-formed manifest', () => {
    expect(validatePluginManifest(base())).toEqual({ errors: [], warnings: [] })
  })

  it('rejects a bad id, version, api version, range and unknown permission', () => {
    const bad = { ...base(), id: 'MyFx', version: '1', apiVersion: PLUGIN_API_VERSION + 1, engine: '^x', permissions: ['telepathy' as never] }
    const { errors } = validatePluginManifest(bad)
    expect(errors.some((e) => /invalid plugin id/.test(e))).toBe(true)
    expect(errors.some((e) => /invalid "version"/.test(e))).toBe(true)
    expect(errors.some((e) => /plugin API/.test(e))).toBe(true)
    expect(errors.some((e) => /invalid "engine" range/.test(e))).toBe(true)
    expect(errors.some((e) => /unknown permission "telepathy"/.test(e))).toBe(true)
  })

  it('checks host versions against the ranges when given', () => {
    const m = { ...base(), engine: '>=0.13 <1', editor: '^0.15' }
    expect(validatePluginManifest(m, { engineVersion: '0.13.1', editorVersion: '0.15.2' }).errors).toEqual([])
    const { errors } = validatePluginManifest(m, { engineVersion: '1.0.0', editorVersion: '0.16.0' })
    expect(errors).toEqual(['requires engine >=0.13 <1, host is 1.0.0', 'requires editor ^0.15, host is 0.16.0'])
    // No host version supplied = the range is only syntax-checked.
    expect(validatePluginManifest(m).errors).toEqual([])
  })

  it('tolerates unknown and reserved extension points with a warning (forward compatible)', () => {
    const m = { ...base(), contributes: { commands: [], holograms: [{ id: 'x' }], rendererLayers: ['rain'] } }
    const r = validatePluginManifest(m)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual(['unknown extension point "holograms" — ignored', 'extension point "rendererLayers" is reserved — ignored'])
  })

  it('accepts pattern permissions with a suffix and warns on reserved ones', () => {
    const m = { ...base(), permissions: ['net:https://api.example.com', 'stage.write', 'audio.bus:music'] as never }
    const r = validatePluginManifest(m)
    expect(r.errors).toEqual([])
    expect(r.warnings.length).toBe(2) // net:* and audio.bus:* are reserved
    expect(validatePluginManifest({ ...base(), permissions: ['net:' as never] }).errors).toEqual(['unknown permission "net:"']) // a bare pattern id is not a permission
  })

  it('validates dependency ids and ranges, activation and reload', () => {
    const m = { ...base(), dependencies: { 'app.nilvn.objectfx': '^1', bad: '>=1' }, activation: { engine: 'later' as never }, reload: 'warm' as never }
    const { errors } = validatePluginManifest(m)
    expect(errors).toEqual(['invalid dependency id "bad"', 'unknown activation.engine "later"', 'unknown reload policy "warm"'])
  })
})

describe('catalogs', () => {
  it('permission ids are unique; pattern ids end in a colon', () => {
    const ids = PERMISSIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PERMISSIONS) expect(p.id.endsWith(':')).toBe(!!p.pattern)
    expect(matchPermission('stage.write')?.status).toBe('active')
    expect(matchPermission('stage.layer:rain')?.pattern).toBe(true)
    expect(matchPermission('stage.layer:')).toBeUndefined()
    expect(matchPermission('nope')).toBeUndefined()
  })

  it('extension point keys are unique and carry a side + status + version', () => {
    const keys = EXTENSION_POINTS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of EXTENSION_POINTS) {
      expect(['engine', 'editor']).toContain(p.side)
      expect(['active', 'reserved']).toContain(p.status)
      expect(p.version).toBeGreaterThan(0)
    }
  })
})
