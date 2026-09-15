// The SDK surface: the helpers are identities, the catalogs come through, and the
// package stays engine-free at runtime (type-only re-exports — the module graph
// must load in a plain Node environment).
import { describe, expect, it } from 'vitest'
import * as sdk from '../src/index'

describe('@nilvn/plugin-sdk', () => {
  it('definePlugin / defineManifest return their argument unchanged', () => {
    const plugin = { id: 'com.example.t', permissions: ['stage.write' as const], commands: {} }
    expect(sdk.definePlugin(plugin)).toBe(plugin)
    const manifest = sdk.defineManifest({ id: 'com.example.t', name: 'plugin.t.name', version: '1.0.0' })
    expect(manifest.id).toBe('com.example.t')
    expect(sdk.validatePluginManifest(manifest).errors).toEqual([])
  })

  it('re-exports the manifest catalogs and validator from core', () => {
    expect(sdk.PLUGIN_API_VERSION).toBe(2)
    expect(sdk.PERMISSIONS.some((p) => p.id === 'stage.write')).toBe(true)
    expect(sdk.EXTENSION_POINTS.some((p) => p.key === 'commands')).toBe(true)
    expect(sdk.resolvePluginId('textfx')).toBe(sdk.FIRST_PARTY_ID_PREFIX + 'textfx')
    expect(sdk.resolvePluginId('com.example.neon')).toBe('com.example.neon')
    expect(sdk.isPluginId('com.example.neon')).toBe(true)
    expect(sdk.satisfiesRange('0.14.2', '>=0.14 <1')).toBe(true)
  })

  it('loads without the engine (no DOM globals touched at import time)', () => {
    // vitest's default environment here is node: reaching this line means the
    // index evaluated without `document` / `window`.
    expect(typeof document).toBe('undefined')
    expect(typeof sdk.buildPluginSpec).toBe('function')
  })
})
