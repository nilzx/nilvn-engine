// Batch J inc 4: the actor grows a layered sprite and plugin fields — the v13
// migration moves the voicefx pitch under `ext`, and the package's actor table
// carries the layers (minus the editor's picker lists).
import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, migrateProject, packageActors, packageLayers, type Actor, type Project } from '../src/index'
import { makeProject } from './fixtures'

describe('v13: Actor.voice → ext', () => {
  it('moves the pitch under the voicefx plugin id and drops the field', () => {
    const p = makeProject()
    p.meta.schemaVersion = 12
    const yuki = p.actors.yuki as Actor & { voice?: number }
    yuki.voice = 360
    migrateProject(p)
    expect(p.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(yuki.voice).toBeUndefined()
    expect(yuki.ext).toEqual({ 'app.nilvn.voicefx': { voice: 360 } })
  })

  it('keeps other ext tables and an actor without a pitch untouched', () => {
    const p = makeProject()
    p.meta.schemaVersion = 12
    const yuki = p.actors.yuki as Actor & { voice?: number }
    yuki.voice = 200
    yuki.ext = { 'com.x.mood': { base: 'calm' } }
    migrateProject(p)
    expect(yuki.ext).toEqual({ 'com.x.mood': { base: 'calm' }, 'app.nilvn.voicefx': { voice: 200 } })
    expect((p.actors as Record<string, Actor>).me?.ext).toBeUndefined()
  })
})

describe('packageActors', () => {
  it('carries textColor / canvas / layers / ext, stripping the picker lists', () => {
    const p: Project = makeProject()
    p.actors.mira = {
      id: 'mira',
      nameKey: 'actor.mira',
      color: '#8a3b5c',
      textColor: '#ffe6ee',
      sprites: '',
      faces: ['calm', 'smile'],
      defaultFace: 'calm',
      canvas: [600, 1100],
      layers: {
        body: { src: 'char/mira/body-{body}.webp', default: 'uniform', values: ['uniform', 'casual'] },
        face: { src: 'char/mira/face-{face}.webp', default: 'calm', offset: [150, 280] },
        extra: { src: 'char/mira/extra-{extra}.webp', optional: true, offset: [80, 120], values: ['blush'] },
      },
      ext: { 'app.nilvn.voicefx': { voice: 300 } },
    }
    const a = packageActors(p).mira!
    expect(a).toMatchObject({ textColor: '#ffe6ee', canvas: [600, 1100], ext: { 'app.nilvn.voicefx': { voice: 300 } } })
    expect(a.layers).toEqual({
      body: { src: 'char/mira/body-{body}.webp', default: 'uniform' },
      face: { src: 'char/mira/face-{face}.webp', default: 'calm', offset: [150, 280] },
      extra: { src: 'char/mira/extra-{extra}.webp', optional: true, offset: [80, 120] },
    })
    expect('voice' in a).toBe(false)
    expect(packageLayers({ x: { src: 's', values: ['a'] } })).toEqual({ x: { src: 's' } })
  })
})
