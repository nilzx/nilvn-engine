// @vitest-environment jsdom
// The generated plugin-spec: shape sanity, the catalog invariants a plugin author
// (human or AI) relies on, and freshness of the committed artifacts — the spec
// JSON and the template package derived from its example must equal what the
// source generates right now (the same gate `pnpm spec:check` runs).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_VERSION, createEngine, type EnginePlugin, type PluginContext, type StageObjectHandle } from '@nilvn/engine'
import { buildPluginSpec, PLUGIN_SPEC_VERSION, signaturesMarkdown } from '../src/spec'
import { validatePluginManifest, type PluginManifest } from '../src/index'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string): string => readFileSync(join(pkg, rel), 'utf8')

describe('plugin-spec', () => {
  const spec = buildPluginSpec()

  it('emits a well-formed platform contract', () => {
    expect(spec.specVersion).toBe(PLUGIN_SPEC_VERSION)
    expect(spec.pluginApiVersion).toBe(2)
    expect(spec.irSchemaVersion).toBeGreaterThanOrEqual(11)
    expect(spec.manifest.file).toBe('plugin.json')
    const idRe = new RegExp(spec.manifest.idPattern)
    expect(idRe.test('app.nilvn.textfx')).toBe(true)
    expect(idRe.test('textfx')).toBe(false)
    // Every permission id unique; active engine-side ones list their capability verbs.
    const ids = spec.permissions.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of spec.permissions) {
      if (p.status === 'active' && p.side === 'engine') expect(spec.runtime.capabilities[p.id], p.id).toBeDefined()
    }
    const points = spec.extensionPoints.map((p) => p.key)
    for (const k of ['commands', 'textEffects', 'objectKinds', 'effects', 'panels', 'nodeKinds', 'config', 'menuItems', 'titleItems', 'hud', 'actorFields']) expect(points).toContain(k)
    // The first-party inventory lives with @nilvn/plugins; the spec names the convention only.
    expect(spec.firstParty).toEqual({ idPrefix: 'app.nilvn.', package: '@nilvn/plugins', repository: expect.stringContaining('nilvn-plugins') })
    expect(spec.specVersion).toBe(3)
    expect(spec.runtime.proxyRules.length).toBeGreaterThanOrEqual(3)
    expect(spec.runtime.lifecycle.length).toBeGreaterThanOrEqual(5)
  })

  it('example package validates against the current engine with no errors', () => {
    const report = validatePluginManifest(spec.example.manifest, { engineVersion: ENGINE_VERSION })
    expect(report.errors).toEqual([])
    expect(spec.example.engineModule).toContain(`id: '${spec.example.manifest.id}'`)
    expect(spec.example.use[0]).toMatch(/plugin\.json/)
  })

  it('committed artifacts are fresh (plugin-spec.json + template)', () => {
    expect(JSON.parse(read('plugin-spec.json'))).toEqual(JSON.parse(JSON.stringify(spec)))
    expect(JSON.parse(read('template/plugin.json')) as PluginManifest).toEqual(JSON.parse(JSON.stringify(spec.example.manifest)))
    expect(read('template/engine.js')).toBe(spec.example.engineModule)
    // The template's stylesheet exists under the name the manifest lists.
    for (const s of spec.example.manifest.styles ?? []) expect(read(join('template', s)).length).toBeGreaterThan(0)
  })

  it("the README's Signatures section is the generated one", () => {
    const readme = read('README.md')
    const body = readme.slice(readme.indexOf('\n', readme.indexOf('<!-- signatures:start')) + 1, readme.indexOf('<!-- signatures:end -->'))
    expect(body).toBe(signaturesMarkdown() + '\n')
  })

  it('every stage verb has a signature, and the engine grants exactly the listed verbs', async () => {
    const documented = new Set(spec.runtime.signatures.filter((f) => f.name.startsWith('stage.')).flatMap((f) => f.name.slice('stage.'.length).split(' / ')))
    const listed = [...spec.runtime.capabilities['stage.write']!, ...spec.runtime.capabilities['stage.read']!]
    for (const verb of listed) expect(documented, verb).toContain(verb)
    // …and the live engine hands a plugin exactly those verbs, and an effect those handle members.
    let stage: object | undefined
    let handle: StageObjectHandle | undefined
    const probe: EnginePlugin = {
      id: 'com.x.probe',
      permissions: ['stage.write', 'stage.read'],
      activate: (ctx: PluginContext) => void (stage = ctx.stage),
      effects: { peek: { appliesToKinds: ['camera'], apply: (h: StageObjectHandle) => void (handle = h) } },
    }
    const container = document.createElement('div')
    document.body.append(container)
    const engine = createEngine({ container, plugins: [probe] })
    engine.loadSource('narr: x\n')
    await engine.prepare()
    await engine.applyEffect('peek', 'camera', {})
    expect(new Set(Object.keys(stage!))).toEqual(new Set(listed))
    const members = spec.runtime.signatures.find((f) => f.name === 'effect handle')!.type.replace(/\([^)]*\)/g, '').split(', ')
    const actual = [...Object.getOwnPropertyNames(handle!), ...Object.getOwnPropertyNames(Object.getPrototypeOf(handle!))].filter((k) => k !== 'constructor')
    expect(new Set(actual)).toEqual(new Set(members))
    engine.destroy()
  })
})
