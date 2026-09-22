// @vitest-environment jsdom
// Script package (.nvs) — Engine.load()'s one entry over three physical forms
//. Inline + directory forms drive the
// real engine here; the zip form's byte layer is pinned in package-zip.test.ts
// (node env — it needs no DOM and the DecompressionStream global).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { fxFixtures, newEngine, view } from './helpers'
import { inlinePackage, openPackage, PackageFormatError, WebContentLoader, type InlinePackageData } from '../src/index'
import { makePackage } from './package-fixture'
import type { PackageManifest } from '@nilvn/core'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('inline package', () => {
  it('load() adopts the manifest, warms every base slice, fills the asset table, then plays chunked', async () => {
    const e = newEngine({ textSpeed: 0, registry: [fxFixtures().fx] })
    await e.load(inlinePackage(makePackage()))
    expect(e.lang).toBe('zh')
    expect(e.languages).toEqual(['zh', 'en'])
    expect(e.textSpeed).toBe(55)
    expect(e.saveKey).toBe('pack-1')
    expect(e.buildInfo).toBe('0.15.0')
    expect(e.actors.yuki).toMatchObject({ name: '由纪', nameKey: 'actor.yuki' })
    expect(view(e).catalogs.zh!['actor.yuki']).toBe('由纪')
    expect(view(e).catalogs.en!['actor.yuki']).toBe('Yuki')
    expect(e.resolve('bg/room.png')).toBe('data:image/png;base64,AAA=')
    await e.start()
    expect(e.vars.x).toBe(2) // s1 → fall-through → s2
    expect(view(e).residentChunks.has('s2')).toBe(true)
    expect(e.diagnostics).toEqual([])
  })

  it('auto-loads the package\'s enabled plugins at start() from the host registry', async () => {
    const e = newEngine({ textSpeed: 0, registry: [fxFixtures().fx] })
    await e.load(inlinePackage(makePackage()))
    await e.start()
    expect(e.getTextEffect('wave')).toBeTypeOf('function') // `fx` activated via nilvn.json plugins (short name → app.nilvn.fx)
  })

  it('a missing chunk file inside the package is a load diagnostic, not a rejection', async () => {
    const data = makePackage()
    delete data.files['chunks/scene/s2.json']
    const e = newEngine({ textSpeed: 0, registry: [fxFixtures().fx] })
    await e.load(inlinePackage(data))
    await e.start()
    expect(e.vars.x).toBe(1)
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ phase: 'load' }))
  })

  it('rejects a foreign or incompatible manifest with PackageFormatError', () => {
    const data = makePackage()
    expect(() => inlinePackage({ ...data, manifest: { hello: 1 } as unknown as PackageManifest })).toThrow(PackageFormatError)
    expect(() => inlinePackage({ ...data, manifest: { ...data.manifest, format: 99 } })).toThrow(/format 99/)
  })
})

describe('directory package (fetch)', () => {
  /** Serve the inline fixture over a fake fetch rooted at `https://host/game/`. */
  function serve(data: InlinePackageData): string[] {
    const hits: string[] = []
    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = String(input)
      hits.push(url)
      const path = url.replace('https://host/game/', '')
      const body = path === 'nilvn.json' ? JSON.stringify(data.manifest) : data.files[path]
      if (body === undefined) return Promise.resolve(new Response(null, { status: 404 }))
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    return hits
  }

  it('openPackage(dirUrl) reads nilvn.json and serves chunks relative to it', async () => {
    const hits = serve(makePackage())
    const pkg = await openPackage('https://host/game/')
    expect(hits[0]).toBe('https://host/game/nilvn.json')
    expect(pkg.loader).toBeInstanceOf(WebContentLoader)
    const e = newEngine({ textSpeed: 0 })
    await e.load(pkg)
    expect(e.resolve('bg/room.png')).toBe('https://host/game/assets/bg/room.png')
    await e.start()
    expect(e.vars.x).toBe(2)
    expect(hits).toContain('https://host/game/chunks/scene/s2.json')
  })

  it('accepts the nilvn.json URL itself and a directory without a trailing slash', async () => {
    serve(makePackage())
    expect((await openPackage('https://host/game/nilvn.json')).manifest.title).toBe('Pack')
    expect((await openPackage('https://host/game')).manifest.title).toBe('Pack')
  })

  it('load(url ending in .nvn) still fetches a plain script', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('[label s1]\n[set y = 7]\n', { status: 200 })))
    const e = newEngine({ textSpeed: 0 })
    await e.load('https://host/story.nvn')
    await e.start()
    expect(e.vars.y).toBe(7)
  })

  it('an unreachable directory rejects (a host-level error, not a diagnostic)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })))
    await expect(openPackage('https://host/nowhere/')).rejects.toThrow(/404/)
  })
})

describe('the work configuration in a package', () => {
  it('applies `config` after the asset table is filled, with nilvn.json keeping what it carries', async () => {
    const e = newEngine({ textSpeed: 0, registry: [fxFixtures().fx] })
    const data = makePackage()
    data.manifest.config = {
      game: { title: 'Not this one', entry: 'other.nvn', scripts: ['a.nvn'] },
      path: { '@bg': 'bg' },
      actors: { rin: { name: 'Rin' } },
      plugins: { use: ['other'], fx: { level: 2 } },
      title: { heading: 'Pack, the game', background: 'bg/room.png' },
      theme: { 'name-bg': '#123456' },
      saves: { autosave: 'line' },
    }
    await e.load(inlinePackage(data))
    expect(e.config.game?.title).toBe('Pack') // the manifest's title is the work's
    expect(e.titleConfig.heading).toBe('Pack, the game')
    expect(e.theme['name-bg']).toBe('#123456')
    expect(e.autosave).toBe('line')
    expect(e.actors.rin).toBeUndefined() // the manifest names the actors
    expect(e.pluginConfigValue('app.nilvn.fx', 'level')).toBe(2)
    expect(e.diagnostics.map((d) => d.message).sort()).toEqual([
      'config: actors: a script package carries this in nilvn.json — ignored',
      'config: game.entry: a script package carries this in nilvn.json — ignored',
      'config: game.scripts: a script package carries this in nilvn.json — ignored',
      'config: path: a script package carries this in nilvn.json — ignored',
      'config: plugins.use: a script package carries this in nilvn.json — ignored',
    ])
    await e.start()
    expect(e.vars.x).toBe(2)
    e.destroy()
  })

  it('reports a misspelled section the same way a config file would, and plays on', async () => {
    const e = newEngine({ textSpeed: 0, registry: [fxFixtures().fx] })
    const data = makePackage()
    data.manifest.config = { titel: { heading: 'x' }, saves: { autosave: 'sometimes' } }
    await e.load(inlinePackage(data))
    expect(e.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('config: titel:'), expect.stringContaining('config: saves.autosave:')])
    await e.start()
    expect(e.vars.x).toBe(2)
    e.destroy()
  })
})

