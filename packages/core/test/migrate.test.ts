import { describe, it, expect } from 'vitest'
import { migrateProject, CURRENT_SCHEMA_VERSION, type Project } from '../src/index'

/** The frozen pre-v2 backfill (ir.ts LEGACY_DEFAULT_PLUGINS): ten content plugins by id. */
const LEGACY_DEFAULT_COUNT = 10
import { makeProject } from './fixtures'

// migrateProject brings a loaded project up to CURRENT_SCHEMA_VERSION in place. The
// data migrations are v1→v2 (fill an empty plugin set — pre-v2 "empty" meant "all
// on"), v2→v3 (backfill resources.spritesheets) and v7→v8 (enable the abreplay
// plugin where the feature was in reach before pluginization); the other bumps are
// pure format stamps. These are the load-path invariants a corrupt migration would
// silently break.

/** The shared fixture ships a voiced line (serialize coverage), which the v9→v10
 *  backfill rightly reads as "uses per-line voice". Policy tests about OTHER
 *  steps strip it so their all-off cases stay genuinely unused. */
function voiceless() {
  const p = makeProject()
  for (const s of p.scenes)
    for (const n of s.nodes)
      if (n.kind === 'say') {
        delete n.voice
        delete n.voiceOffset
      }
  return p
}

/** Pre-v11 refs as old projects carry them (`{ name, entry }`). */
function legacyRefs(...names: string[]): Project['plugins'] {
  return names.map((name) => ({ name, entry: name })) as unknown as Project['plugins']
}

describe('migrateProject', () => {
  it('v1 with an empty plugin set fills it with all bundled plugins', () => {
    const p = makeProject()
    p.meta.schemaVersion = 1
    p.plugins = []
    delete (p.resources as unknown as Record<string, unknown>).spritesheets // pre-v3 had no field
    migrateProject(p)
    expect(p.plugins.length).toBe(LEGACY_DEFAULT_COUNT)
    expect(p.plugins.length).toBeGreaterThan(0)
    expect(p.resources.spritesheets).toEqual([]) // v2→v3 backfill
    expect(p.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('a missing schemaVersion is treated as v1 (plugins get filled)', () => {
    const p = makeProject()
    delete p.meta.schemaVersion
    p.plugins = []
    migrateProject(p)
    expect(p.plugins.length).toBeGreaterThan(0)
  })

  it('at v2+ an empty plugin set legitimately means "all off" and is left alone', () => {
    const p = voiceless()
    p.meta.schemaVersion = 2
    p.plugins = []
    migrateProject(p)
    expect(p.plugins).toEqual([]) // NOT filled — empty is authoritative at v2+
    expect(p.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  // v7→v8: A–B replay became the abreplay plugin. Observed behavior decides who
  // gets it enabled: authored segments must keep playing no matter what; an
  // untouched-but-visible feature follows the "plugins user" default; a
  // deliberate all-off stays all-off.
  it('v7 with authored replays gains abreplay even against an all-off set', () => {
    const p = voiceless()
    p.meta.schemaVersion = 7
    p.plugins = []
    p.replays = [{ id: 'r1', titleKey: 'replay.r1.title', start: { sceneId: 's1', nodeId: 'n1' }, end: { sceneId: 's1', nodeId: 'n2' } }]
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toEqual(['app.nilvn.abreplay'])
  })

  it('v7 with a non-empty set gains abreplay; an unused all-off does not', () => {
    const p = makeProject()
    p.meta.schemaVersion = 7
    p.plugins = legacyRefs('textfx')
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toContain('app.nilvn.abreplay')

    const q = voiceless()
    q.meta.schemaVersion = 7
    q.plugins = []
    migrateProject(q)
    expect(q.plugins).toEqual([])
  })

  // v8→v9 mirrors the same policy for animstudio; usage = any animation node.
  it('v8 with an eventframe node gains animstudio even against an all-off set', () => {
    const p = voiceless()
    p.meta.schemaVersion = 8
    p.plugins = []
    p.scenes[0]!.nodes.push({ kind: 'eventframe', id: 'ef1', duration: 1, tracks: [] })
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toEqual(['app.nilvn.animstudio'])
  })

  it('v8 with a non-empty set gains animstudio; an unused all-off does not', () => {
    const p = makeProject()
    p.meta.schemaVersion = 8
    p.plugins = legacyRefs('textfx')
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toContain('app.nilvn.animstudio')

    const q = voiceless()
    q.meta.schemaVersion = 8
    q.plugins = []
    migrateProject(q)
    expect(q.plugins).toEqual([])
  })

  // v9→v10 mirrors the policy for the editor-only voicerecord plugin; usage =
  // any spoken line with an attached voice clip. Only the authoring UI is
  // gated ([voice] playback is core), so the backfill keeps the voice button
  // visible where the author was using or could see it.
  it('v9 with a voiced line gains voicerecord even against an all-off set', () => {
    const p = voiceless()
    p.meta.schemaVersion = 9
    p.plugins = []
    p.scenes[0]!.nodes.push({ kind: 'say', id: 'v1', actor: 'a', textKey: 'k', voice: 'voice/a_s1_v1.webm' })
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toEqual(['app.nilvn.voicerecord'])
  })

  it('v9 with a non-empty set gains voicerecord; an unused all-off does not', () => {
    const p = makeProject()
    p.meta.schemaVersion = 9
    p.plugins = legacyRefs('textfx')
    migrateProject(p)
    expect(p.plugins.map((x) => x.id)).toContain('app.nilvn.voicerecord')

    const q = voiceless()
    q.meta.schemaVersion = 9
    q.plugins = []
    migrateProject(q)
    expect(q.plugins).toEqual([])
  })

  it('a usage-forced add in one step does not open the gate for the next (v8, anim used, no voice)', () => {
    const p = voiceless()
    p.meta.schemaVersion = 8
    p.plugins = []
    p.scenes[0]!.nodes.push({ kind: 'eventframe', id: 'ef1', duration: 1, tracks: [] })
    migrateProject(p)
    // animstudio is forced by usage; voicerecord must NOT ride in on the
    // now-non-empty set — hadPlugins was sampled before the backfills.
    expect(p.plugins.map((x) => x.id)).toEqual(['app.nilvn.animstudio'])
  })

  it('does not double-add abreplay when a v7 set already carries it', () => {
    const p = makeProject()
    p.meta.schemaVersion = 7
    p.plugins = legacyRefs('abreplay')
    migrateProject(p)
    expect(p.plugins.filter((x) => x.id === 'app.nilvn.abreplay').length).toBe(1)
  })

  it('does not disturb an already-current project beyond stamping the version', () => {
    const p = makeProject()
    const pluginsBefore = [...p.plugins]
    migrateProject(p)
    expect(p.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(p.plugins).toEqual(pluginsBefore)
  })

  // v10→v11 (plugin platform v2): refs become `{ id }` keyed by reverse-DNS id.
  it('v10 refs map dotless (short) names into the first-party namespace, keep ids verbatim, drop entry and duplicates', () => {
    const p = makeProject()
    p.meta.schemaVersion = 10
    p.plugins = [
      ...legacyRefs('textfx', 'textfx', 'my-third-party'),
      { id: 'app.nilvn.charfx', config: { k: 1 } },
      { id: 'charfx' } as never,
    ]
    migrateProject(p)
    // A dotless name can only be a first-party short name (third-party ids are
    // reverse-DNS): `my-third-party` lands under app.nilvn. as a valid id the
    // editor then reports as unknown — the data is never dropped.
    expect(p.plugins).toEqual([{ id: 'app.nilvn.textfx' }, { id: 'app.nilvn.my-third-party' }, { id: 'app.nilvn.charfx', config: { k: 1 } }])
    expect(p.plugins.some((x) => 'entry' in x || 'name' in x)).toBe(false)
  })

  it('a v1 project goes through every step to id-keyed refs', () => {
    const p = makeProject()
    p.meta.schemaVersion = 1
    p.plugins = []
    migrateProject(p)
    for (const r of p.plugins) expect(r.id.startsWith('app.nilvn.')).toBe(true)
    expect(p.plugins).toHaveLength(LEGACY_DEFAULT_COUNT)
    expect(p.plugins.map((r) => r.id)).toContain('app.nilvn.textfx')
  })

  it('mutates and returns the same object', () => {
    const p = makeProject()
    expect(migrateProject(p)).toBe(p)
  })
})
