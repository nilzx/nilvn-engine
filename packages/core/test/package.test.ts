import { describe, it, expect } from 'vitest'
import { buildScriptPackage, configAssetRefs, fillPackageAssets, isPackageManifest, PACKAGE_FORMAT, packageActors, packageLanguages } from '../src/index'
import { makeProject } from './fixtures'
import { commandRegistry } from '../src/plugins'
import type { PluginManifest } from '../src/plugin-manifest'

// The script package (.nvs) producer — nilvn.json over the chunked script side.
describe('buildScriptPackage', () => {
  it('embeds the chunk manifest and fills the shell fields from the project', () => {
    const { manifest, files, assetRefs } = buildScriptPackage(makeProject(), { engine: '0.15.0' })
    expect(manifest.format).toBe(PACKAGE_FORMAT)
    expect(manifest.title).toBe('Test Project')
    expect(manifest.engine).toBe('0.15.0')
    expect(manifest.lang).toBe('zh')
    expect(manifest.languages).toEqual(['zh', 'en'])
    expect(manifest.actors.yuki).toEqual({ name: '由纪', nameKey: 'actor.yuki', color: undefined, sprites: 'char/yuki/{face}.png', defaultFace: undefined, voice: undefined })
    expect(manifest.plugins).toEqual([])
    expect(manifest.textSpeed).toBe(40)
    expect(manifest.saveKey).toBe('p1')
    expect(manifest.chunks.chunks.map((c) => c.id)).toEqual(['s1', 's2'])
    expect(manifest.chunks.entry).toEqual({ label: 's1' })
    expect(manifest.chunks.assets).toEqual({})
    expect(files.map((f) => f.path)).toContain('chunks/scene/s1.json')
    expect(assetRefs).toContain('bg/room.png')
    expect(isPackageManifest(manifest)).toBe(true)
  })

  it('forwards the command registry so plugin commands keep their positional args', () => {
    const p = makeProject()
    p.scenes[0]!.nodes.push({ id: 'mv', kind: 'command', cmd: 'move', params: { id: 'yuki', to: 'left' } })
    const charfx: PluginManifest = {
      id: 'app.nilvn.charfx',
      name: 'charfx',
      version: '1.0.0',
      contributes: {
        commands: [
          {
            name: 'move',
            label: 'move',
            category: 'stage',
            params: [
              { key: 'id', label: 'id', type: 'actor', required: true, positional: 0 },
              { key: 'to', label: 'to', type: 'enum', default: 'center', options: [] },
            ],
          },
        ],
      },
    }
    const { files } = buildScriptPackage(p, { engine: '0.16.2', commands: commandRegistry([charfx]) })
    const scene = JSON.parse(files.find((f) => f.path === 'chunks/scene/s1.json')!.text) as { body: string }
    expect(scene.body).toContain('[move yuki to=left]')
    // Without the registry the positional degrades to a named arg (the bug this guards).
    const bare = buildScriptPackage(p, { engine: '0.16.2' })
    expect((JSON.parse(bare.files.find((f) => f.path === 'chunks/scene/s1.json')!.text) as { body: string }).body).toContain('[move id=yuki to=left]')
  })

  it('merges every scene into one chunk when asked (single-file / asset-ZIP shape)', () => {
    const p = makeProject()
    const { manifest } = buildScriptPackage(p, { engine: '0.15.0', groups: [p.scenes.map((s) => s.id)] })
    expect(manifest.chunks.chunks.map((c) => c.id)).toEqual(['s1'])
    expect(manifest.chunks.chunks[0]!.scenes).toEqual(['s1', 's2'])
    expect(manifest.chunks.labelIndex).toEqual({ s1: 's1', s2: 's1' })
  })

  it('takes explicit shell fields over the project defaults', () => {
    const { manifest } = buildScriptPackage(makeProject(), {
      engine: '0.15.0',
      title: 'T',
      plugins: [{ id: 'textfx' }, { id: 'menu' }],
      textSpeed: 60,
      saveKey: 'k',
      languages: ['zh'],
      actors: { me: { name: '我' } },
    })
    expect(manifest).toMatchObject({ title: 'T', plugins: [{ id: 'textfx' }, { id: 'menu' }], textSpeed: 60, saveKey: 'k', languages: ['zh'], actors: { me: { name: '我' } } })
  })

  it('fillPackageAssets returns a new manifest with the by-ref table', () => {
    const { manifest } = buildScriptPackage(makeProject(), { engine: '0.15.0' })
    const filled = fillPackageAssets(manifest, { 'bg/room.png': { url: 'assets/bg/room.png', bytes: 3, kind: 'bg' } })
    expect(filled.chunks.assets['bg/room.png']).toEqual({ url: 'assets/bg/room.png', bytes: 3, kind: 'bg' })
    expect(manifest.chunks.assets).toEqual({}) // input untouched
    expect(isPackageManifest(filled)).toBe(true)
  })

  it('rejects foreign / truncated manifests', () => {
    expect(isPackageManifest(null)).toBe(false)
    expect(isPackageManifest({ format: 1, title: 'x' })).toBe(false)
    const { manifest } = buildScriptPackage(makeProject(), { engine: '0.15.0' })
    expect(isPackageManifest({ ...manifest, chunks: {} })).toBe(false)
  })

  it('packageLanguages keeps only languages with a non-empty catalog; packageActors reads the default-language name', () => {
    const p = makeProject()
    p.meta.languages = ['zh', 'en', 'ja']
    expect(packageLanguages(p)).toEqual(['zh', 'en'])
    expect(packageActors(p).yuki?.name).toBe('由纪')
  })
})

describe('the work configuration in the package', () => {
  it('ships project.config as nilvn.json `config`, or an explicit one; nothing when empty', () => {
    const p = makeProject()
    expect(buildScriptPackage(p, { engine: '0.17.0' }).manifest.config).toBeUndefined()
    p.config = { title: { heading: 'Test' }, theme: { 'name-bg': '#123456' } }
    expect(buildScriptPackage(p, { engine: '0.17.0' }).manifest.config).toEqual({ title: { heading: 'Test' }, theme: { 'name-bg': '#123456' } })
    expect(buildScriptPackage(p, { engine: '0.17.0', config: { saves: { autosave: 'line' } } }).manifest.config).toEqual({ saves: { autosave: 'line' } })
    expect(buildScriptPackage(p, { engine: '0.17.0', config: {} }).manifest.config).toBeUndefined()
    expect(isPackageManifest(buildScriptPackage(p, { engine: '0.17.0' }).manifest)).toBe(true)
  })

  it('collects the asset refs a configuration names, skipping layer templates', () => {
    expect(
      configAssetRefs({
        window: { skin: 'ui/box.png', position: 'top' },
        title: { logo: './ui/logo.svg', background: 'bg/title.webp', music: 'audio/title.mp3', buttons: ['new', 'load'] },
        preload: { assets: ['ui/btn.png', 'bg/title.webp'] },
        actors: { vera: { layers: { face: { src: 'char/vera/face-{face}.png' } } } },
        ui: { hud: { widgets: [{ type: 'image', src: 'ui/icon.svg' }] } },
      }),
    ).toEqual(['ui/box.png', './ui/logo.svg', 'bg/title.webp', 'audio/title.mp3', 'ui/btn.png', 'ui/icon.svg'])
    expect(configAssetRefs(undefined)).toEqual([])
  })
})

describe('a scoped plan (the studio preview)', () => {
  it('holds only the scoped scene as one chunk, routes jumps out of it to the unset landing, and injects the anchor', () => {
    const p = makeProject()
    const s1 = p.scenes[0]!
    const { manifest, files } = buildScriptPackage(p, { engine: '0.17.0', scenes: ['s1'], anchorNodeId: s1.nodes[1]!.id, anchorLabel: '__nilvn_here__' })
    expect(manifest.chunks.chunks.map((c) => c.id)).toEqual(['s1'])
    expect(manifest.chunks.entry).toEqual({ label: 's1' })
    expect(manifest.chunks.sceneOrder).toEqual(['s1'])
    expect(manifest.chunks.chunks[0]!.next).toEqual([]) // nothing to fall through to inside the scope
    const body = (JSON.parse(files.find((f) => f.path === 'chunks/scene/s1.json')!.text) as { body: string }).body
    expect(body).toContain('[label __nilvn_here__]')
    expect(body).not.toContain('-> s2') // the fixture's jump to s2 is out of scope → the unset landing
    expect(body).toContain('__nilvn_unset__')
    expect(files.some((f) => f.path === 'chunks/scene/s2.json')).toBe(false)
  })
})

