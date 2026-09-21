import { describe, it, expect } from 'vitest'
import { buildScriptPackage, fillPackageAssets, isPackageManifest, PACKAGE_FORMAT, packageActors, packageLanguages } from '../src/index'
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
