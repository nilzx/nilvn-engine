// @vitest-environment jsdom
// Plugins a script package carries (plugin platform v3 §2.8): `nilvn.json`
// `plugins[].entry` names a plugin.json inside the package, and every file of
// the plugin sits in the by-ref asset table, so each package form serves it
// through the URL its loader already minted. Plus `ctx.asset()` for a plugin's
// own files, and versioned save slices (§2.7).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { packagePluginAssets, type PluginManifest } from '@nilvn/core'
import { inlinePackage, openPackage, type EnginePlugin, type InlinePackageData, type PluginLoader, type SaveState } from '../src/index'
import { makePackage, zip } from './package-fixture'
import { newEngine } from './helpers'

const ID = 'com.example.neon'

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: ID,
  name: 'plugin.neon.name',
  version: '1.0.0',
  entries: { engine: './engine.js' },
  permissions: ['vars.write'],
  styles: ['neon.css'],
  assets: ['sfx/click.ogg'],
  ...over,
})

/** The plugin's module: `[neon]` records what `ctx.asset` hands back. */
const neon: EnginePlugin = {
  id: ID,
  commands: {
    neon: ({ plugin }) => {
      plugin.vars!.set('listed', plugin.asset('./sfx/click.ogg') ?? 'none')
      plugin.vars!.set('unlisted', plugin.asset('sfx/other.ogg') ?? 'none')
    },
  },
}

/** The fixture package plus the neon plugin, carried: its files go through
 *  `packagePluginAssets` into the asset table, with `urls` as their minted URLs. */
function carried(urls: Record<string, string>): InlinePackageData {
  const data = makePackage()
  const { plugin, assets } = packagePluginAssets(ID, Object.keys(urls).map((path) => ({ path, bytes: 1 })))
  data.manifest.plugins = [plugin]
  data.manifest.chunks.assets = { ...data.manifest.chunks.assets, ...assets }
  data.files['chunks/scene/s1.json'] = JSON.stringify({ id: 's1', body: '[label s1]\n[neon]\n', labels: ['s1'] })
  for (const [path, url] of Object.entries(urls)) data.assets![`plugins/${ID}/${path}`] = url
  return data
}

function memLoader(files: Record<string, unknown>): PluginLoader & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetchManifest: (url) => {
      calls.push(`manifest:${url}`)
      return url in files ? Promise.resolve(files[url]) : Promise.reject(new Error(`404 ${url}`))
    },
    importModule: (url) => {
      calls.push(`import:${url}`)
      return url in files ? Promise.resolve(files[url]) : Promise.reject(new Error(`404 ${url}`))
    },
    fetchText: (url) => {
      calls.push(`css:${url}`)
      return Promise.resolve(String(files[url] ?? ''))
    },
  }
}

const URLS = { 'plugin.json': 'mem:pj', 'engine.js': 'mem:js', 'neon.css': 'mem:css', 'sfx/click.ogg': 'mem:ogg' }

describe('carried plugins (inline package)', () => {
  it('loads plugin.json → engine module → styles through the package, and resolves listed assets', async () => {
    const loader = memLoader({ 'mem:pj': manifest(), 'mem:js': { default: neon }, 'mem:css': '.neon{}' })
    const e = newEngine({ pluginLoader: loader, textSpeed: 0 })
    await e.load(inlinePackage(carried(URLS)))
    await e.start()
    expect(loader.calls).toEqual(['manifest:mem:pj', 'import:mem:js', 'css:mem:css'])
    expect(e.activePlugins).toContain(ID)
    expect(document.querySelector(`style[data-plugin="${ID}"]`)?.textContent).toBe('.neon{}')
    expect(e.getVar('neon.listed')).toBe('mem:ogg')
    expect(e.getVar('neon.unlisted')).toBe('none')
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('"sfx/other.ogg" is not listed in plugin.json "assets"'))
    expect(e.missingPlugins).toEqual([])
    e.destroy()
  })

  it('reports a carried plugin whose plugin.json names another id, or whose module is not in the package', async () => {
    const other = newEngine({ pluginLoader: memLoader({ 'mem:pj': manifest({ id: 'com.example.other' }), 'mem:js': { default: neon } }), textSpeed: 0 })
    await other.load(inlinePackage(carried(URLS)))
    await other.start()
    expect(other.missingPlugins).toEqual([ID])
    expect(other.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('does not match the package entry'))
    other.destroy()

    const { 'engine.js': _, ...noModule } = URLS
    const e = newEngine({ pluginLoader: memLoader({ 'mem:pj': manifest() }), textSpeed: 0 })
    await e.load(inlinePackage(carried(noModule)))
    await e.start()
    expect(e.missingPlugins).toEqual([ID])
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('engine entry "./engine.js" is not available'))
    e.destroy()
  })

  it('reloads a carried plugin in place (no re-import)', async () => {
    const loader = memLoader({ 'mem:pj': manifest(), 'mem:js': { default: neon }, 'mem:css': '' })
    const e = newEngine({ pluginLoader: loader, textSpeed: 0 })
    await e.load(inlinePackage(carried(URLS)))
    await e.start()
    expect(await e.reloadPlugin(ID)).toBe(true)
    expect(loader.calls.filter((c) => c.startsWith('import:'))).toEqual(['import:mem:js'])
    e.destroy()
  })
})

describe('carried plugins (zip package)', () => {
  const blobs = new Map<string, Blob>()
  beforeAll(() => {
    ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      const url = `blob:mock/${blobs.size + 1}`
      blobs.set(url, b)
      return url
    }
  })
  afterAll(() => {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
  })

  it('serves every plugin file as a typed blob URL and imports the module from it', async () => {
    const enc = new TextEncoder()
    const data = carried(URLS)
    const files: Record<string, string> = {
      'plugin.json': JSON.stringify(manifest()),
      'engine.js': 'export default {}',
      'neon.css': '.neon{}',
      'sfx/click.ogg': 'OggS',
    }
    const bytes = zip([
      { name: 'nilvn.json', data: enc.encode(JSON.stringify(data.manifest)) },
      ...Object.entries(data.files).map(([name, text]) => ({ name, data: enc.encode(text) })),
      { name: 'assets/bg/room.png', data: new Uint8Array([1, 2, 3]) },
      ...Object.entries(files).map(([path, text]) => ({ name: `plugins/${ID}/${path}`, data: enc.encode(text) })),
    ])
    const types: string[] = []
    const loader: PluginLoader = {
      fetchManifest: async (url) => JSON.parse(await blobs.get(url)!.text()),
      importModule: async (url) => {
        const blob = blobs.get(url)!
        types.push(blob.type)
        expect(await blob.text()).toBe('export default {}')
        return { default: neon }
      },
      fetchText: async (url) => blobs.get(url)!.text(),
    }
    const e = newEngine({ pluginLoader: loader, textSpeed: 0 })
    await e.load(await openPackage(bytes))
    await e.start()
    expect(types).toEqual(['text/javascript'])
    expect(e.activePlugins).toContain(ID)
    expect(blobs.get(String(e.getVar('neon.listed')))?.type).toBe('audio/ogg')
    expect(document.querySelector(`style[data-plugin="${ID}"]`)?.textContent).toBe('.neon{}')
    e.destroy()
  })
})

describe('ctx.asset outside a package', () => {
  it('resolves relative to a URL-loaded plugin.json, and not at all for a host-registered module', async () => {
    const loader = memLoader({ 'https://example.test/p/plugin.json': manifest({ styles: [] }), 'https://example.test/p/engine.js': { default: neon } })
    const e = newEngine({ pluginLoader: loader, baseUrl: 'https://example.test/', textSpeed: 0 })
    e.loadSource('[use ./p/plugin.json]\n[neon]')
    await e.start()
    expect(e.getVar('neon.listed')).toBe('https://example.test/p/sfx/click.ogg')
    e.destroy()

    const r = newEngine({ registry: [neon], manifests: [manifest()], use: [ID], textSpeed: 0 })
    r.loadSource('[neon]')
    await r.start()
    expect(r.getVar('neon.listed')).toBe('none')
    expect(r.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('no location to resolve files from'))
    r.destroy()
  })
})

describe('versioned save slices', () => {
  const SLICE = 'test.slice'
  const make = (over: Partial<EnginePlugin> = {}): EnginePlugin => ({
    id: SLICE,
    permissions: ['save.slice', 'vars.write'],
    saveState: () => ({ n: 2 }),
    restoreState: (ctx, data) => ctx.vars!.set('got', JSON.stringify(data)),
    ...over,
  })
  async function started(plugin: EnginePlugin) {
    const e = newEngine({ plugins: [plugin], textSpeed: 0 })
    e.loadSource('[set x = 1]')
    await e.start()
    return e
  }
  const saved = (ext: Record<string, unknown>, extVersion?: Record<string, number>, e?: ReturnType<typeof newEngine>): SaveState => ({
    ...e!.saveState(),
    ext,
    extVersion,
  })

  it('records the version only when it is not 1', async () => {
    const v1 = await started(make())
    expect(v1.saveState().extVersion).toBeUndefined()
    v1.destroy()
    const v2 = await started(make({ stateVersion: 2 }))
    expect(v2.saveState()).toMatchObject({ ext: { [SLICE]: { n: 2 } }, extVersion: { [SLICE]: 2 } })
    v2.destroy()
  })

  it('migrates an older slice, and drops one it cannot read', async () => {
    const e = await started(make({ stateVersion: 2, migrateState: (d, from) => ({ ...(d as object), from }) }))
    await e.restoreState(saved({ [SLICE]: { n: 1 } }, undefined, e))
    expect(e.getVar('slice.got')).toBe('{"n":1,"from":1}')
    e.destroy()

    const noMigrate = await started(make({ stateVersion: 2 }))
    await noMigrate.restoreState(saved({ [SLICE]: { n: 1 } }, undefined, noMigrate))
    expect(noMigrate.getVar('slice.got')).toBeUndefined()
    expect(noMigrate.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('has no migrateState — dropped'))
    noMigrate.destroy()

    const older = await started(make())
    await older.restoreState(saved({ [SLICE]: { n: 3 } }, { [SLICE]: 3 }, older))
    expect(older.getVar('slice.got')).toBeUndefined()
    expect(older.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('version 3, this plugin reads up to 1'))
    older.destroy()
  })

  it('carries an unclaimed slice with its version to the next save', async () => {
    const e = await started(make())
    await e.restoreState(saved({ 'com.example.gone': { k: 1 } }, { 'com.example.gone': 4 }, e))
    expect(e.saveState()).toMatchObject({ ext: { 'com.example.gone': { k: 1 }, [SLICE]: { n: 2 } }, extVersion: { 'com.example.gone': 4 } })
    e.destroy()
  })

  it('warns when the module and plugin.json disagree on the version', async () => {
    const plugin = make({ stateVersion: 2 })
    const e = newEngine({ registry: [plugin], manifests: [{ id: SLICE, name: 'x', version: '1.0.0', contributes: { saveSlice: { version: 3 } } }], use: [SLICE], textSpeed: 0 })
    e.loadSource('[set x = 1]')
    await e.start()
    expect(e.saveState().extVersion).toEqual({ [SLICE]: 2 })
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('stateVersion 2 does not match plugin.json saveSlice.version 3'))
    e.destroy()
  })
})
