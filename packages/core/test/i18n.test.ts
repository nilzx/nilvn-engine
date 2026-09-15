import { describe, it, expect } from 'vitest'
import {
  createI18n,
  applyCatalogs,
  registerEnabledPluginCatalogs,
  type LoadedCatalogs,
} from '../src/index'

// Shared UI-chrome i18n runtime. Pure, zero-I/O. These are
// the durable form of the contract: dotted-id lookup with active → en → id
// fallback, {name} placeholders, flat namespace merge, and per-plugin catalogs.
describe('createI18n', () => {
  it('resolves the active language, falling back to base(en) then the raw id', () => {
    const i18n = createI18n() // base defaults to 'en'
    i18n.registerCatalog('editor', 'en', { 'topBar.home': 'Home', 'topBar.undo': 'Undo' })
    i18n.registerCatalog('editor', 'zh', { 'topBar.home': '回主页' }) // no zh for undo

    expect(i18n.getLocale()).toBe('en')
    expect(i18n.t('topBar.home')).toBe('Home')

    i18n.setLocale('zh')
    expect(i18n.t('topBar.home')).toBe('回主页') // active hit
    expect(i18n.t('topBar.undo')).toBe('Undo') // active miss → base(en)
    expect(i18n.t('topBar.missing')).toBe('topBar.missing') // both miss → raw id
  })

  it('fills {name} placeholders from params in every language', () => {
    const i18n = createI18n({ active: 'zh' })
    i18n.registerCatalog('editor', 'zh', { 'ver.line': 'NilVN 工坊 v{ver}' })
    i18n.registerCatalog('editor', 'en', { 'ver.line': 'NilVN Studio v{ver}' })
    expect(i18n.t('ver.line', { ver: '0.10.0' })).toBe('NilVN 工坊 v0.10.0')
    i18n.setLocale('en')
    expect(i18n.t('ver.line', { ver: '0.10.0' })).toBe('NilVN Studio v0.10.0')
    // A placeholder with no matching param is left intact.
    expect(i18n.t('ver.line')).toBe('NilVN Studio v{ver}')
    expect(i18n.t('ver.line', {})).toBe('NilVN Studio v{ver}')
  })

  it('honors a non-default base language', () => {
    const i18n = createI18n({ base: 'zh', active: 'en' })
    i18n.registerCatalog('editor', 'zh', { 'x.y': '中文' })
    // en missing → falls back to the zh base, not the id.
    expect(i18n.t('x.y')).toBe('中文')
  })

  it('merges namespaces flat and is last-write-wins per id', () => {
    const i18n = createI18n()
    i18n.registerCatalog('editor', 'en', { 'a.b': 'first' })
    i18n.registerCatalog('core', 'en', { 'c.d': 'core' }) // different namespace, same lang
    i18n.registerCatalog('editor', 'en', { 'a.b': 'second' }) // overrides
    expect(i18n.t('a.b')).toBe('second')
    expect(i18n.t('c.d')).toBe('core')
  })

  it('has() reflects active-or-base membership', () => {
    const i18n = createI18n({ active: 'ja' })
    i18n.registerCatalog('editor', 'en', { 'only.en': 'x' })
    i18n.registerCatalog('editor', 'ja', { 'only.ja': 'y' })
    expect(i18n.has('only.ja')).toBe(true) // active
    expect(i18n.has('only.en')).toBe(true) // base
    expect(i18n.has('nope')).toBe(false)
  })
})

describe('applyCatalogs', () => {
  it('registers every namespace/language of a LoadedCatalogs', () => {
    const loaded: LoadedCatalogs = {
      editor: { en: { 'a.b': 'EN' }, zh: { 'a.b': 'ZH' } },
      core: { en: { 'c.d': 'C-EN' } },
    }
    const i18n = createI18n()
    applyCatalogs(i18n, loaded)
    expect(i18n.t('a.b')).toBe('EN')
    expect(i18n.t('c.d')).toBe('C-EN')
    i18n.setLocale('zh')
    expect(i18n.t('a.b')).toBe('ZH')
    expect(i18n.t('c.d')).toBe('C-EN') // zh missing → base(en)
  })
})

describe('registerEnabledPluginCatalogs', () => {
  it('prefers the loaded plugin JSON catalog under plugin:<id>', () => {
    const i18n = createI18n({ active: 'zh' })
    const loaded: LoadedCatalogs = {
      'plugin:app.nilvn.charfx': { en: { 'plugin.charfx.name': 'Character action' }, zh: { 'plugin.charfx.name': '角色动作' } },
    }
    registerEnabledPluginCatalogs(i18n, [{ id: 'app.nilvn.charfx', messages: { en: { 'plugin.charfx.name': 'IGNORED' } } }], loaded)
    expect(i18n.t('plugin.charfx.name')).toBe('角色动作') // active zh from JSON
    i18n.setLocale('en')
    expect(i18n.t('plugin.charfx.name')).toBe('Character action') // JSON wins over baked messages
  })

  it('falls back to the manifest baked messages when no JSON catalog is present', () => {
    const i18n = createI18n()
    registerEnabledPluginCatalogs(i18n, [{ id: 'app.nilvn.voicefx', messages: { en: { 'plugin.voicefx.name': 'Synth voice' } } }], {})
    expect(i18n.t('plugin.voicefx.name')).toBe('Synth voice')
  })

  it('is a no-op for a plugin with neither JSON nor baked messages', () => {
    const i18n = createI18n()
    registerEnabledPluginCatalogs(i18n, [{ id: 'app.nilvn.bare' }], {})
    expect(i18n.t('plugin.bare.name')).toBe('plugin.bare.name') // raw id
  })
})
