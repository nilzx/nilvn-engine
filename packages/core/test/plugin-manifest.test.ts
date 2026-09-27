import { describe, it, expect } from 'vitest'
import {
  EXTENSION_POINTS,
  PERMISSIONS,
  PLUGIN_API_VERSION,
  matchPermission,
  validatePluginManifest,
  isPluginRelPath,
  normalizePluginPath,
  type PluginManifest,
} from '../src/index'

// The v2 manifest validator is the seam that guards third-party plugins: it must
// reject what the hosts cannot run, tolerate what they can ignore (forward
// compatibility), and never complain about a bundled manifest.
const base = (): PluginManifest => ({
  id: 'com.example.myfx',
  name: 'plugin.myfx.name',
  version: '1.0.0',
  entries: { engine: './engine.js' },
})

describe('validatePluginManifest', () => {
  it('accepts a minimal well-formed manifest', () => {
    expect(validatePluginManifest(base())).toEqual({ errors: [], warnings: [] })
  })

  it('rejects a bad id, version, api version, range and unknown permission', () => {
    const bad = { ...base(), id: 'MyFx', version: '1', apiVersion: PLUGIN_API_VERSION + 1, engine: '^x', permissions: ['telepathy' as never] }
    const { errors } = validatePluginManifest(bad)
    expect(errors.some((e) => /invalid plugin id/.test(e))).toBe(true)
    expect(errors.some((e) => /invalid "version"/.test(e))).toBe(true)
    expect(errors.some((e) => /plugin API/.test(e))).toBe(true)
    expect(errors.some((e) => /invalid "engine" range/.test(e))).toBe(true)
    expect(errors.some((e) => /unknown permission "telepathy"/.test(e))).toBe(true)
  })

  it('checks host versions against the ranges when given', () => {
    const m = { ...base(), engine: '>=0.13 <1', editor: '^0.15' }
    expect(validatePluginManifest(m, { engineVersion: '0.13.1', editorVersion: '0.15.2' }).errors).toEqual([])
    const { errors } = validatePluginManifest(m, { engineVersion: '1.0.0', editorVersion: '0.16.0' })
    expect(errors).toEqual(['requires engine >=0.13 <1, host is 1.0.0', 'requires editor ^0.15, host is 0.16.0'])
    // No host version supplied = the range is only syntax-checked.
    expect(validatePluginManifest(m).errors).toEqual([])
  })

  it('tolerates unknown and reserved extension points with a warning (forward compatible)', () => {
    const m = { ...base(), contributes: { commands: [], holograms: [{ id: 'x' }], rendererLayers: ['rain'] } }
    const r = validatePluginManifest(m)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual(['unknown extension point "holograms" — ignored', 'extension point "rendererLayers" is reserved — ignored'])
  })

  it('accepts pattern permissions with a suffix and warns on reserved ones', () => {
    const m = { ...base(), permissions: ['net:https://api.example.com', 'stage.write', 'audio.bus:music'] as never }
    const r = validatePluginManifest(m)
    expect(r.errors).toEqual([])
    expect(r.warnings.length).toBe(2) // net:* and audio.bus:* are reserved
    expect(validatePluginManifest({ ...base(), permissions: ['net:' as never] }).errors).toEqual(['unknown permission "net:"']) // a bare pattern id is not a permission
  })

  it('validates dependency ids and ranges, activation and reload', () => {
    const m = { ...base(), dependencies: { 'app.nilvn.objectfx': '^1', bad: '>=1' }, activation: { engine: 'later' as never }, reload: 'warm' as never }
    const { errors } = validatePluginManifest(m)
    expect(errors).toEqual(['invalid dependency id "bad"', 'unknown activation.engine "later"', 'unknown reload policy "warm"'])
  })
})

describe('catalogs', () => {
  it('permission ids are unique; pattern ids end in a colon', () => {
    const ids = PERMISSIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PERMISSIONS) expect(p.id.endsWith(':')).toBe(!!p.pattern)
    expect(matchPermission('stage.write')?.status).toBe('active')
    expect(matchPermission('stage.layer:rain')?.pattern).toBe(true)
    expect(matchPermission('stage.layer:')).toBeUndefined()
    expect(matchPermission('nope')).toBeUndefined()
  })

  it('extension point keys are unique and carry a side + status + version', () => {
    const keys = EXTENSION_POINTS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of EXTENSION_POINTS) {
      expect(['engine', 'editor']).toContain(p.side)
      expect(['active', 'reserved']).toContain(p.status)
      expect(p.version).toBeGreaterThan(0)
    }
  })
})

describe('plugin file paths', () => {
  it('accepts paths inside the plugin and rejects escapes, absolutes and schemes', () => {
    for (const p of ['engine.js', './engine.js', 'sfx/click.ogg', 'a/./b.css']) expect(isPluginRelPath(p)).toBe(true)
    for (const p of ['', '.', './', '../x.js', 'a/../../x', '/abs.js', 'sfx/', 'C:\\x.js', 'https://x.test/a.js', 'data:text/javascript,1']) expect(isPluginRelPath(p)).toBe(false)
    expect(normalizePluginPath('./sfx//./click.ogg')).toBe('sfx/click.ogg')
  })

  it('checks assets and the save-slice version', () => {
    const base: PluginManifest = { id: 'com.example.x', name: 'x', version: '1.0.0' }
    expect(validatePluginManifest({ ...base, assets: ['sfx/a.ogg', '../b.ogg'] }).errors).toEqual(['assets: "../b.ogg" is not a path inside the plugin (relative, no "..")'])
    expect(validatePluginManifest({ ...base, contributes: { saveSlice: { version: 2 } } }).errors).toEqual([])
    expect(validatePluginManifest({ ...base, contributes: { saveSlice: { version: 0 } } }).errors).toEqual(['contributes.saveSlice.version must be a positive integer'])
  })
})

describe('contribution shape checks', () => {
  const base: PluginManifest = { id: 'com.example.x', name: 'plugin.x.name', version: '1.0.0' }

  it('rejects the shapes a hand-written manifest most often gets wrong', () => {
    const { errors } = validatePluginManifest({
      ...base,
      contributes: {
        commands: [{ name: 'go', label: 'l', category: 'nope' as never, params: [
          { key: 'kind', label: 'l', type: 'enum', options: ['a', 'b'] as never, positional: true as never },
          { key: 'n', label: 'l', type: 'banana' as never },
        ] }],
        config: [{ key: 'mood', label: 'l', type: 'banana' as never }],
      },
    })
    expect(errors).toEqual([
      'contributes.commands."go": category must be one of stage, audio, fx, flow, text',
      'contributes.commands."go".params."kind": an enum needs options: [{ value, label }, …]',
      'contributes.commands."go".params."kind": positional is the argument index (0, 1, …)',
      expect.stringContaining('contributes.commands."go".params."n": unknown type "banana"'),
      expect.stringContaining('contributes.config."mood": unknown type "banana"'),
    ])
  })

  it('a list is a config-only, author-only type with an array default', () => {
    const cfg = (config: NonNullable<PluginManifest['contributes']>['config']) => validatePluginManifest({ ...base, contributes: { config } })
    expect(cfg([{ key: 'ids', label: 'l', type: 'list', default: ['a', 'b'] }, { key: 'ns', label: 'l', type: 'list', items: 'number', default: [1, 2] }])).toEqual({ errors: [], warnings: [] })
    expect(cfg([{ key: 'ids', label: 'l', type: 'list', scope: 'player' }]).errors).toEqual(['contributes.config."ids": a list is author-only (scope "player" is not supported)'])
    expect(cfg([{ key: 'ids', label: 'l', type: 'list', default: 'a, b' }]).errors).toEqual(['contributes.config."ids": a list\'s default is an array of strings'])
    expect(cfg([{ key: 'ns', label: 'l', type: 'list', items: 'number', default: ['1'] as never }]).errors).toEqual(['contributes.config."ns": a list\'s default is an array of numbers'])
    expect(cfg([{ key: 'n', label: 'l', type: 'number', items: 'number' }]).warnings).toEqual(['contributes.config."n": items only applies to type "list"'])
    const cmd = validatePluginManifest({ ...base, contributes: { commands: [{ name: 'go', label: 'l', category: 'flow', params: [{ key: 'x', label: 'l', type: 'list' as never }] }] } })
    expect(cmd.errors).toEqual([expect.stringContaining('params."x": unknown type "list"')])
  })

  it('menuItems.when is deprecated: accepted, warned, ignored', () => {
    const { errors, warnings } = validatePluginManifest({ ...base, permissions: ['ui.screen'], contributes: { menuItems: [{ id: 'm', label: 'l', when: 'always' }] } })
    expect(errors).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('contributes.menuItems."m": "when" is deprecated and ignored')])
  })

  it('warns about a contribution without its permission and a label missing from messages.en', () => {
    const { errors, warnings } = validatePluginManifest({
      ...base,
      contributes: { keybindings: [{ id: 'k', default: 'k', label: 'plugin.x.key' }], menuItems: [{ id: 'm', label: 'plugin.x.menu' }], saveSlice: true },
      messages: { en: { 'plugin.x.name': 'X', 'plugin.x.menu': 'Menu' } },
    })
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      'contributes.keybindings needs the "input.keys" permission — without it nothing is wired',
      'contributes.saveSlice needs the "save.slice" permission — without it nothing is wired',
      'contributes.menuItems needs the "ui.screen" permission — without it nothing is wired',
      'messages.en has no "plugin.x.key"',
    ])
  })

  it('checks services (id, semver version) and theme tokens (prefix, one CSS value)', () => {
    const m = {
      ...base,
      contributes: {
        services: [{ id: 'cg', version: '1.0.0' }, { id: 'cg', version: '1.0.0' }, { id: 'x', version: 'one' }],
        themeTokens: [
          { name: 'x-glow', default: 'var(--nilvn-accent)', label: 'plugin.x.glow' },
          { name: 'glow', default: '#fff' },
          { name: 'x-bad', default: 'red; top: 0' },
          { name: 'x-glow', default: '#fff' },
        ],
      },
      messages: { en: { 'plugin.x.name': 'X' } },
    }
    const { errors, warnings } = validatePluginManifest(m)
    expect(errors).toEqual([
      'contributes.services: duplicate id "cg"',
      'contributes.services."x": version must be a semver version ("1.0.0")',
      'contributes.themeTokens: "glow" must start with "x-" (the plugin\'s short name)',
      'contributes.themeTokens."x-bad": default must be one CSS value (no ";", "{" or "}")',
      'contributes.themeTokens: duplicate name "x-glow"',
    ])
    expect(warnings).toContain('messages.en has no "plugin.x.glow"')
    expect(EXTENSION_POINTS.map((p) => p.key)).toEqual(expect.arrayContaining(['services', 'themeTokens']))
  })
})
