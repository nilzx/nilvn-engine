// Catalog localization round-trip: export the authored text as a plain-text
// translation file, hand it to a human or an LLM, then import the translations
// back into the project's per-language catalogs. Logic and text stay separate
// (see ir.ts): only the TextCatalog values move, never the scene/node structure.
//
// The file format is line-based and language-neutral so any editor / LLM can fill
// it in without special tooling:
//
//   # nilvn-i18n source=en target=ja
//   # <human instructions, trilingual>
//
//   @scene.intro
//   en: Prologue
//   ja: プロローグ
//
//   @t_a1b2c3d4
//   en: Hello, nice to meet you.
//   ja:
//
// `@<key>` opens an entry; `<sourceLang>:` is the read-only reference; the line
// prefixed with the target language code is what the translator fills in. Catalog
// values are single-line by construction (the DSL puts each line of dialogue on
// one line; breaks are `{br}` markers, not real newlines), so a line-based format
// round-trips losslessly.

import type { Lang, Project } from './ir.js'

/** Native display names for the language switcher / translation UI. Unknown codes
 *  fall back to the code itself. Shared by the editor (engine keeps its own copy
 *  to stay dependency-free). */
export const LANG_NATIVE_NAMES: Record<string, string> = { zh: '中文', ja: '日本語', en: 'English' }

export function nativeLangName(code: Lang): string {
  return LANG_NATIVE_NAMES[code] ?? code
}

/** One translatable string: its key, the source-language text (reference), and
 *  the target-language text ('' when not yet translated). */
export interface CatalogEntry {
  key: string
  source: string
  target: string
}

export interface CatalogExport {
  sourceLang: Lang
  targetLang: Lang
  entries: CatalogEntry[]
}

/** Per-language translation coverage against the authored (source) catalog. */
export interface LangCompleteness {
  lang: Lang
  total: number
  translated: number
  /** Authored keys with no (or empty) translation in this language. */
  missing: string[]
}

export interface ImportResult {
  /** Keys written with a non-empty translation. */
  applied: number
  /** Entries left blank in the file (existing translations are kept untouched). */
  skipped: number
  /** Keys in the file that aren't authored in the source catalog (ignored). */
  unknown: string[]
}

/** Keys that carry authored text: non-empty entries in the source catalog. Actor
 *  names (`actor.*`) and scene titles (`scene.*`) live here too, so they localize
 *  alongside dialogue. Empty placeholders (seeded by the editor for new nodes) are
 *  skipped — there's nothing to translate yet. */
export function authoredKeys(project: Project, sourceLang: Lang): string[] {
  const src = project.catalogs[sourceLang] ?? {}
  return Object.keys(src)
    .filter((k) => src[k]?.trim())
    .sort()
}

/** Pair every authored key with its source text and current target text, ready to
 *  serialize for a translator. `sourceLang` defaults to the work's default lang. */
export function exportCatalog(project: Project, targetLang: Lang, sourceLang?: Lang): CatalogExport {
  const sLang = sourceLang ?? project.meta.defaultLang
  const src = project.catalogs[sLang] ?? {}
  const tgt = project.catalogs[targetLang] ?? {}
  const entries = authoredKeys(project, sLang).map((key) => ({
    key,
    source: src[key] ?? '',
    target: tgt[key] ?? '',
  }))
  return { sourceLang: sLang, targetLang, entries }
}

/** Merge a translated export back into project.catalogs[targetLang] (in place).
 *  Only authored keys are written; blank targets leave any existing translation
 *  alone. Registers the target language in meta.languages so it ships. */
export function importCatalog(project: Project, data: CatalogExport): ImportResult {
  const authored = new Set(authoredKeys(project, data.sourceLang))
  const catalog = (project.catalogs[data.targetLang] ??= {})
  const result: ImportResult = { applied: 0, skipped: 0, unknown: [] }
  for (const { key, target } of data.entries) {
    if (!authored.has(key)) {
      result.unknown.push(key)
      continue
    }
    const value = target.trim()
    if (!value) {
      result.skipped++
      continue
    }
    catalog[key] = value
    result.applied++
  }
  if (result.applied > 0 && !project.meta.languages.includes(data.targetLang)) {
    project.meta.languages.push(data.targetLang)
  }
  return result
}

/** How completely `lang` translates the authored source. The source language is
 *  trivially 100%. */
export function catalogCompleteness(project: Project, lang: Lang, sourceLang?: Lang): LangCompleteness {
  const sLang = sourceLang ?? project.meta.defaultLang
  const keys = authoredKeys(project, sLang)
  if (lang === sLang) return { lang, total: keys.length, translated: keys.length, missing: [] }
  const cat = project.catalogs[lang] ?? {}
  const missing = keys.filter((k) => !cat[k]?.trim())
  return { lang, total: keys.length, translated: keys.length - missing.length, missing }
}

// ---------- plain-text serialization ----------

const HEADER = '# nilvn-i18n'

/** Serialize an export to the line-based translation file (see file header). */
export function catalogToText(data: CatalogExport): string {
  const { sourceLang: s, targetLang: t } = data
  const out: string[] = [
    `${HEADER} source=${s} target=${t}`,
    `# Fill each「${t}:」line with the ${nativeLangName(t)} translation of the「${s}:」line above it.`,
    `# 在每个「${t}:」行后填写上面「${s}:」行的译文；请勿改动「@」开头的 key 行与「${s}:」行。`,
    `# 各「${t}:」行に、上の「${s}:」行の訳を記入してください（「@」の key 行と「${s}:」行は変更しない）。`,
    '',
  ]
  for (const e of data.entries) {
    out.push(`@${e.key}`, `${s}: ${e.source}`, `${t}: ${e.target}`, '')
  }
  return out.join('\n').trimEnd() + '\n'
}

/** Parse a translation file back into an export. Throws on a missing/garbled
 *  header so the caller can surface a clear error rather than importing nothing. */
export function catalogFromText(text: string): CatalogExport {
  const lines = text.split(/\r?\n/)
  const head = lines.find((l) => l.startsWith(HEADER))
  const sourceLang = head?.match(/\bsource=(\S+)/)?.[1]
  const targetLang = head?.match(/\btarget=(\S+)/)?.[1]
  if (!sourceLang || !targetLang) {
    throw new Error('Not a NilVN translation file (missing "# nilvn-i18n source=… target=…" header).')
  }
  const srcPrefix = sourceLang + ':'
  const tgtPrefix = targetLang + ':'
  const entries: CatalogEntry[] = []
  let cur: CatalogEntry | null = null
  for (const line of lines) {
    if (line.startsWith('@')) {
      cur = { key: line.slice(1).trim(), source: '', target: '' }
      if (cur.key) entries.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith(srcPrefix)) cur.source = line.slice(srcPrefix.length).trim()
    else if (line.startsWith(tgtPrefix)) cur.target = line.slice(tgtPrefix.length).trim()
  }
  return { sourceLang, targetLang, entries }
}
