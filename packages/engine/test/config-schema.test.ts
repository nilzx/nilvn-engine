// @vitest-environment jsdom
// Batch I inc 6 — the config schema: `checkConfig` reports unknown sections and
// keys, wrong types and values off their lists; `applyConfig` surfaces them as
// diagnostics; the kitchen-sink sample's config passes clean.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'smol-toml'
import { createEngine, MemorySaveStore, applyConfig, checkConfig, CONFIG_SCHEMA } from '../src/index'

const problems = (cfg: unknown): string[] => checkConfig(cfg).map((p) => `${p.path}: ${p.message}`)

describe('checkConfig', () => {
  it('accepts every documented section and flags what is not in the schema', () => {
    expect(problems({ game: { title: 'x', scripts: ['a.nvn'] }, preload: { auto: true }, ui: { hud: { kind: 'hud', widgets: [{ type: 'bar', var: 'v', max: 3 }] } } })).toEqual([])
    expect(problems({ gaem: {}, game: { titel: 'x' } })).toEqual(['gaem: unknown key', 'game.titel: unknown key'])
    expect(problems({ choices: { layout: 'row' }, saves: { autosave: 'always' }, window: { overflow: 'huge' } })).toEqual([
      'choices.layout: must be one of "column", "grid"',
      'saves.autosave: must be one of "label", "line", false',
      'window.overflow: must be one of "grow", "page", "shrink"',
    ])
    expect(problems({ game: { textSpeed: 'fast' }, keys: { auto: 3 }, settings: { textSpeedRange: ['a'] } })).toEqual([
      'game.textSpeed: expected number, got string',
      'keys.auto: expected string or array or boolean, got number',
      'settings.textSpeedRange[0]: expected number, got string',
    ])
  })

  it('checks each widget against its own shape and keeps plugin actor fields', () => {
    expect(problems({ ui: { p: { widgets: [{ type: 'text', text: 'a' }, { type: 'button', label: 'b', onclick: 'ui hide p' }, { type: 'bar', var: 'v', bogus: 1 }] } } })).toEqual(['ui.p.widgets[2].bogus: unknown key'])
    expect(problems({ ui: { p: { widgets: [{ type: 'dial', var: 'v' }] } } })).toEqual(['ui.p.widgets[0].type: must be one of "text"'])
    expect(problems({ actors: { yuki: { name: 'Y', voice: 360, layers: { face: { src: 'x', default: 'a' } } } } })).toEqual([])
    expect(problems({ actors: { yuki: { layers: { face: { src: 'x', optional: 'yes' } } } } })).toEqual(['actors.yuki.layers.face.optional: expected boolean, got string'])
    expect(problems({ plugins: { use: ['textfx'], voicefx: { level: 0.7 } }, strings: { zh: { 'ui.menu.save': 'x' } } })).toEqual([])
    expect(checkConfig({ window: { bogus: 1 } }, { skip: ['window'] })).toEqual([])
  })

  it('applyConfig reports the problems as load diagnostics (its token mappers keep their own sections)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const e = createEngine({ container, saveStore: new MemorySaveStore() })
    applyConfig(e, { gmae: { title: 'x' }, menu: { entry: 'middle' }, window: { bogus: 1 } } as never)
    const msgs = e.diagnostics.map((d) => d.message)
    expect(msgs).toContain('config: gmae: unknown key')
    expect(msgs).toContain('config: menu.entry: must be one of "top-right", "top-left", "bottom-right", "bottom-left", "hidden"')
    expect(msgs.filter((m) => m.includes('bogus'))).toEqual(['[window] unknown key "bogus" — ignored'])
    e.destroy()
  })

  // The kitchen-sink sample lives in the private monorepo only (vitest runs
  // from its root); the public engine repository has no apps/ and skips it.
  const sample = resolve(process.cwd(), 'apps/e2e-game/public/nilvn.config.toml')
  it.skipIf(!existsSync(sample))('the kitchen-sink sample config passes clean', () => {
    expect(problems(parse(readFileSync(sample, 'utf8')))).toEqual([])
  })

  it('the schema is plain data', () => {
    expect(JSON.parse(JSON.stringify(CONFIG_SCHEMA))).toEqual(CONFIG_SCHEMA)
    expect(Object.keys(CONFIG_SCHEMA.properties ?? {})).toContain('ui')
  })
})
