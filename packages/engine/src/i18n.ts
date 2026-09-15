// Engine UI-chrome i18n: the lookup MECHANISM plugins and hosts render chrome
// through (`ctx.t` falls back here after a plugin's own `messages`), by STABLE
// DOTTED IDs, active → en → id. The engine itself ships no chrome strings any
// more — the in-game menu and its texts moved to the `menu` plugin
// (@nilvn/plugins), which carries them as manifest `messages`. The catalogs stay
// baked in (no @nilvn/core runtime dependency) so a future engine-owned string
// switches language fully offline in a single-file export.
//
// This localizes only chrome. The work's *content* (dialogue, character names,
// choice labels) is resolved separately from the project catalogs the engine
// receives at boot — see Engine.resolveText / setLanguage. Chrome language
// follows the work's language: set at boot from the project's defaultLang and
// switchable from the in-game menu, which keeps both in sync.

type Catalog = Record<string, string>

const BASE = 'en'

const en: Catalog = {}
const zh: Catalog = {}
const ja: Catalog = {}

const catalogs: Record<string, Catalog> = { en, zh, ja }

let current = BASE

/** Set the module-level default chrome language (used when `tUI` gets no
 *  explicit language). The engine no longer sets it — plugins pass `engine.lang`. */
export function setUILang(lang: string): void {
  current = lang
}

export function getUILang(): string {
  return current
}

/** Resolve a chrome string by its dotted id (`lang` → en → id). `{name}`
 *  placeholders are filled from `params`. Pass the engine's own language: the
 *  module-level default (`setUILang`) is a legacy convenience — two engines on
 *  one page each speak their own work's language. */
export function tUI(id: string, params?: Record<string, string | number>, lang: string = current): string {
  const tpl = catalogs[lang]?.[id] ?? catalogs[BASE]?.[id] ?? id
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`))
}

/** Display name for a language code, used by the in-game language switcher. */
const LANG_NAMES: Record<string, string> = { zh: '中文', ja: '日本語', en: 'English' } // i18n-ignore
export function uiLangName(lang: string): string {
  return LANG_NAMES[lang] ?? lang
}
