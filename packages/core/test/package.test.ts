import { describe, it, expect } from 'vitest'
import { buildScriptPackage, fillPackageAssets, isPackageManifest, PACKAGE_FORMAT, packageActors, packageLanguages } from '../src/index'
import { makeProject } from './fixtures'

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
