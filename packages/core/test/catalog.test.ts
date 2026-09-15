import { describe, it, expect } from 'vitest'
import {
  authoredKeys,
  exportCatalog,
  importCatalog,
  catalogCompleteness,
  catalogToText,
  catalogFromText,
} from '../src/index'
import type { CatalogExport } from '../src/index'
import { makeProject } from './fixtures'

// Catalog localization round-trip (batch 2 content layer). Only TextCatalog VALUES
// move — never scene/node structure. The plain-text file must round-trip losslessly
// so any editor / LLM can fill it in.
describe('catalog', () => {
  // fixture zh authors 7 keys; en translates only 2 of them.
  const AUTHORED = ['actor.yuki', 's1.hello', 's1.opt_dead', 's1.opt_go', 's1.title', 's2.intro', 's2.title']

  it('authoredKeys returns non-empty source keys, sorted', () => {
    expect(authoredKeys(makeProject(), 'zh')).toEqual(AUTHORED)
  })

  it('exportCatalog pairs every authored key with source + current target text', () => {
    const data = exportCatalog(makeProject(), 'en') // source defaults to defaultLang zh
    expect(data.sourceLang).toBe('zh')
    expect(data.targetLang).toBe('en')
    expect(data.entries.map((e) => e.key)).toEqual(AUTHORED)
    const yuki = data.entries.find((e) => e.key === 'actor.yuki')!
    expect(yuki).toEqual({ key: 'actor.yuki', source: '由纪', target: 'Yuki' })
    // An untranslated key carries an empty target.
    expect(data.entries.find((e) => e.key === 's2.intro')!.target).toBe('')
  })

  it('catalogToText → catalogFromText round-trips losslessly', () => {
    const original = exportCatalog(makeProject(), 'en')
    const parsed = catalogFromText(catalogToText(original))
    expect(parsed.sourceLang).toBe(original.sourceLang)
    expect(parsed.targetLang).toBe(original.targetLang)
    expect(parsed.entries).toEqual(original.entries)
  })

  it('catalogFromText throws on a missing header', () => {
    expect(() => catalogFromText('just some text\n@k\nzh: x')).toThrow(/Not a NilVN translation file/)
  })

  it('importCatalog applies non-empty translations, skips blanks, flags unknown keys', () => {
    const p = makeProject()
    const data: CatalogExport = {
      sourceLang: 'zh',
      targetLang: 'ja',
      entries: [
        { key: 's1.hello', source: '你好', target: 'こんにちは' },
        { key: 's1.title', source: '开场', target: '' }, // blank → skipped, keeps existing
        { key: 'unknown.key', source: 'x', target: 'y' }, // not authored → ignored
      ],
    }
    const result = importCatalog(p, data)
    expect(result).toEqual({ applied: 1, skipped: 1, unknown: ['unknown.key'] })
    expect(p.catalogs.ja).toEqual({ 's1.hello': 'こんにちは' })
    // A newly-translated language is registered so it ships.
    expect(p.meta.languages).toContain('ja')
  })

  it('catalogCompleteness measures translated vs missing against the source', () => {
    const p = makeProject()
    const en = catalogCompleteness(p, 'en')
    expect(en.total).toBe(AUTHORED.length)
    expect(en.translated).toBe(2) // actor.yuki + s1.hello
    expect(en.missing.sort()).toEqual(['s1.opt_dead', 's1.opt_go', 's1.title', 's2.intro', 's2.title'])
    // The source language is trivially complete.
    expect(catalogCompleteness(p, 'zh')).toEqual({ lang: 'zh', total: AUTHORED.length, translated: AUTHORED.length, missing: [] })
  })
})
