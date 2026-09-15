// @vitest-environment jsdom
// core ↔ engine contract.
// The two packages live in one repository but are consumed apart; these pin the
// seams they share so a drift on either side fails here, not in a player's game:
// the built-in command vocabulary, the object kinds, the format numbers, the
// plugin-platform mirrors, and the DSL / keyframe wire the editor writes and the
// engine parses. (The first-party plugins' own parity — manifest ↔ runtime module
// — is pinned in @nilvn/plugins' contract test.)
import { describe, it, expect } from 'vitest'
import {
  BUILTIN_COMMAND_MAP,
  BUILTIN_OBJECT_KINDS,
  CHUNK_MANIFEST_FORMAT,
  PACKAGE_FORMAT as CORE_PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILE as CORE_MANIFEST_FILE,
  FIRST_PARTY_ID_PREFIX as CORE_FIRST_PARTY_ID_PREFIX,
  FORMAT_VERSIONS,
  PERMISSIONS,
  PLUGIN_API_VERSION as CORE_PLUGIN_API_VERSION,
  buildScriptPackage,
  serializeChunk,
  serializeProject,
  type EventFrameNode,
} from '@nilvn/core'
import { builtins } from '../src/builtins'
import { BUILTIN_KINDS } from '../src/object'
import { parseScript } from '../src/parser'
import { decodeTracks } from '../src/keyframes'
import {
  checkPackageManifest,
  inlinePackage,
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILE,
  PackageFormatError,
  createEngine,
  PERMISSION_IDS,
  PLUGIN_API_VERSION,
  FIRST_PARTY_ID_PREFIX,
  ENGINE_CAPABILITIES,
  ENGINE_VERSION,
} from '../src/index'
import { makeProject } from '../../core/test/fixtures'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('command vocabulary', () => {
  it('every built-in command core describes exists in the engine builtins', () => {
    const missing = Object.keys(BUILTIN_COMMAND_MAP).filter((k) => !(k in builtins))
    expect(missing).toEqual([])
  })

  it('every engine builtin outside the flow/structure set is described by a core schema', () => {
    // Flow / declaration commands the DSL serializer emits itself (not authorable
    // command nodes) — the editor never offers them from the insert palette.
    const structural = new Set(['use', 'alias', 'actor', 'jump', 'if', 'set', 'voice'])
    const undescribed = Object.keys(builtins).filter((k) => !(k in BUILTIN_COMMAND_MAP) && !structural.has(k))
    expect(undescribed).toEqual([])
  })
})

describe('object kinds', () => {
  it('core built-in kinds and engine built-in kinds agree on ids and transformability', () => {
    const core = BUILTIN_OBJECT_KINDS.map((k) => `${k.id}:${k.transformable}`).sort()
    const eng = BUILTIN_KINDS.map((k) => `${k.id}:${k.transformable}`).sort()
    expect(eng).toEqual(core)
  })
})

describe('format numbers', () => {
  it('the engine mirrors core (type-only import ⇒ the constants are duplicated on purpose)', () => {
    expect(PACKAGE_FORMAT).toBe(CORE_PACKAGE_FORMAT)
    expect(PACKAGE_MANIFEST_FILE).toBe(CORE_MANIFEST_FILE)
    expect(FORMAT_VERSIONS.package).toBe(PACKAGE_FORMAT)
    expect(PLUGIN_API_VERSION).toBe(CORE_PLUGIN_API_VERSION)
    expect(FORMAT_VERSIONS.pluginApi).toBe(PLUGIN_API_VERSION)
    const { manifest } = buildScriptPackage(makeProject(), { engine: 'x' })
    expect(checkPackageManifest(manifest)).toBe(manifest) // chunk format accepted as-is
    expect(() => checkPackageManifest({ ...manifest, chunks: { ...manifest.chunks, format: CHUNK_MANIFEST_FORMAT + 1 } })).toThrow(PackageFormatError)
  })
})

describe('plugin platform mirrors', () => {
  it('the first-party id namespace is one constant in core and the engine', () => {
    expect(FIRST_PARTY_ID_PREFIX).toBe(CORE_FIRST_PARTY_ID_PREFIX)
  })

  it('the engine permission catalog mirrors core (id / status / pattern / side)', () => {
    const core = PERMISSIONS.map((p) => `${p.id}|${p.status}|${!!p.pattern}|${p.side}`)
    const eng = PERMISSION_IDS.map((p) => `${p.id}|${p.status}|${!!p.pattern}|${p.side}`)
    expect(eng).toEqual(core)
  })

  it('every engine capability object corresponds to an active engine-side permission', () => {
    for (const cap of ENGINE_CAPABILITIES) {
      const def = PERMISSIONS.find((p) => p.id === cap)
      expect(def, cap).toMatchObject({ status: 'active', side: 'engine' })
    }
    // …and every active engine-side permission has an object.
    for (const p of PERMISSIONS) if (p.status === 'active' && p.side === 'engine') expect(ENGINE_CAPABILITIES).toContain(p.id)
  })

  it('the engine semver subset is a byte-for-byte copy of core (below the header)', () => {
    const strip = (src: string): string => src.replace(/^(?:\/\/[^\n]*\n)+/, '')
    const core = readFileSync(join(here, '..', '..', 'core', 'src', 'semver.ts'), 'utf8')
    const eng = readFileSync(join(here, '..', 'src', 'semver.ts'), 'utf8')
    expect(strip(eng)).toBe(strip(core))
  })

  it('ENGINE_VERSION equals package.json (version:set rewrites both)', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string }
    expect(ENGINE_VERSION).toBe(pkg.version)
  })
})

describe('DSL wire: serializeChunk → parseScript', () => {
  it('parses clean, defines every label the chunk declares, and keeps @key text references', () => {
    const p = makeProject()
    for (const ids of [['s1'], ['s2'], ['s1', 's2']]) {
      const chunk = serializeChunk(p, { scenes: ids, keepKeys: true, crossChunk: true })
      const parsed = parseScript(chunk.body)
      expect(parsed.diagnostics).toEqual([])
      for (const label of chunk.labels) expect(parsed.labels).toHaveProperty(label)
      const dialogue = parsed.nodes.find((n) => n.type === 'dialogue')
      if (ids.includes('s1')) expect(dialogue).toMatchObject({ textKey: 's1.hello' })
    }
    expect(parseScript(serializeProject(p, { keepKeys: true })).diagnostics).toEqual([])
  })

  it('carries asset refs through to command params', () => {
    const chunk = serializeChunk(makeProject(), { scenes: ['s1'], keepKeys: true, crossChunk: true })
    const bg = parseScript(chunk.body).nodes.find((n) => n.type === 'command' && n.name === 'bg')
    expect(bg).toMatchObject({ params: expect.objectContaining({ image: 'bg/room.png' }) })
    expect(chunk.assetRefs).toContain('bg/room.png')
  })
})

describe('keyframe wire: core encodeTracks → engine decodeTracks', () => {
  it('round-trips channels, times, easings and value types', () => {
    const p = makeProject()
    const node: EventFrameNode = {
      kind: 'eventframe',
      id: 'ef1',
      duration: 1.5,
      tracks: [
        { objId: 'character:yuki', keys: [{ t: 0, ch: { x: 0, scale: 1 }, ease: 'io' }, { t: 1.5, ch: { x: 120.5, scale: 1.25, visible: false, face: 'happy' } }] },
        { objId: 'camera', keys: [{ t: 0.25, ch: { rotation: -3 } }] },
      ],
    }
    p.scenes[0]!.nodes.push(node)
    const body = serializeChunk(p, { scenes: ['s1'], keepKeys: true, crossChunk: true }).body
    const ef = parseScript(body).nodes.find((n) => n.type === 'command' && n.name === 'eventframe')
    expect(ef).toBeTruthy()
    const tracks = decodeTracks((ef as { params: Record<string, string> }).params.kf!)
    expect(tracks.map((t) => t.objId)).toEqual(['character:yuki', 'camera'])
    const yuki = tracks[0]!
    expect(yuki.keys.map((k) => k.t)).toEqual([0, 1.5])
    expect(yuki.keys[0]!.ease).toBe('io')
    expect(yuki.keys[0]!.ch).toEqual({ x: '0', scale: '1' })
    expect(yuki.keys[1]!.ch).toEqual({ x: '120.5', scale: '1.25', visible: '0', face: 'happy' })
    expect(tracks[1]!.keys[0]!.ch).toEqual({ rotation: '-3' })
  })
})

describe('command defaults', () => {
  const pick = (cmd: string, param: string): unknown => BUILTIN_COMMAND_MAP[cmd]?.params?.find((p) => p.key === param)?.default

  it('core advertises the defaults the engine builtins fall back to', () => {
    // The engine hard-codes these in its builtins (`ctx.num('fade', 0)` …); core
    // describes them for the editor's palette. Pin the pairs so a change on either
    // side is a visible contract change.
    expect(pick('bg', 'fade')).toBe(0)
    expect(pick('wait', 'sec')).toBe(0.5)
    expect(pick('fadeout', 'sec')).toBe(0.6)
    expect(pick('fadeout', 'color')).toBe('#000')
    expect(pick('bgm', 'volume')).toBe(1)
    expect(pick('bgm', 'fade')).toBe(0)
    expect(pick('bgm', 'track')).toBe('music')
  })

  it('a bare [wait] / [fadeout] run with exactly those defaults', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const e = createEngine({ container, textSpeed: 0 })
    let waited = -1
    e.wait = (sec: number): Promise<void> => {
      waited = sec
      return Promise.resolve()
    }
    const fades: unknown[][] = []
    e.stage.fadeScreen = (...args: unknown[]): Promise<void> => {
      fades.push(args)
      return Promise.resolve()
    }
    e.loadSource('[wait]\n[fadeout]')
    await e.start()
    expect(waited).toBe(pick('wait', 'sec'))
    expect(fades).toEqual([[1, pick('fadeout', 'sec'), pick('fadeout', 'color')]])
    e.destroy()
  })
})

describe('package round trip: core builder → engine load', () => {
  it('a package built from the core fixture plays its first line from the shipped catalog', async () => {
    const p = makeProject()
    const plan = buildScriptPackage(p, { engine: 'x', plugins: [] })
    const files = Object.fromEntries(plan.files.map((f) => [f.path, f.text]))
    const container = document.createElement('div')
    document.body.append(container)
    const e = createEngine({ container, textSpeed: 0 })
    await e.load(inlinePackage({ manifest: plan.manifest, files }))
    expect(e.actors.yuki).toMatchObject({ name: '由纪', nameKey: 'actor.yuki' })
    void e.start()
    // The package's own text speed (40 cps) applies, so wait for the line to be
    // fully typed and parked (it enters the backlog then), not merely laid out.
    for (let i = 0; i < 200 && e.getBacklog().length < 1; i++) await new Promise((r) => setTimeout(r, 5))
    expect(e.textSpeed).toBe(40)
    expect(e.stage.textEl.textContent).toBe('你好') // s1.hello resolved from the zh slice
    expect(e.stage.nameTag.textContent).toBe('由纪')
    expect(e.diagnostics.filter((d) => d.phase !== 'load')).toEqual([]) // (voice/hi.webm is not a real file)
    await e.setLanguage('en')
    expect(e.stage.textEl.textContent).toBe('Hi')
    e.destroy()
  })
})
