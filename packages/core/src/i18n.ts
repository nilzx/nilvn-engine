// Shared UI-chrome i18n runtime for the studio (editor + engine).
//
// Unlike the authored-story text i18n (see catalog.ts / project.catalogs), this
// localizes the *tool/game chrome*: buttons, labels, menus, toasts. It replaces
// the old "key-as-default" scheme (where the Chinese source string was the lookup
// key) with STABLE DOTTED IDs — e.g. `topBar.home`, `cmd.bg.label`,
// `plugin.charfx.name`, `engine.menu.save`. Lookup falls back active → base(en) →
// the raw id, so a missing translation surfaces a visible id rather than silently
// showing another language.
//
// Zero-dependency and pure: no fetch/fs. Catalogs are plain data injected via
// registerCatalog / applyCatalogs; the fetching/globbing/override lives in the
// host packages' LocaleLoader implementations (which produce a LoadedCatalogs and
// hand it here). The editor and engine each own their own instance — they can't
// share memory across the engine's IIFE boundary, but they share this code and the
// same JSON catalog files, which is what removes the old duplicated-key problem.

export type Catalog = Record<string, string>
export type Params = Record<string, string | number>

/** Namespaced, per-language catalogs as produced by a LocaleLoader.
 *  Shape: `{ [namespace]: { [lang]: { [id]: text } } }`. Namespaces (`editor`,
 *  `core`, `engine`, `plugin:<id>`) are an authoring/override grouping — the
 *  runtime merges them flat because ids are already globally unique. */
export interface LoadedCatalogs {
  [namespace: string]: { [lang: string]: Catalog }
}

/** Loads the catalogs for a host (web glob, Tauri resources + user overrides, or
 *  an inline injected blob for the engine's offline single-file export). */
export interface LocaleLoader {
  load(): Promise<LoadedCatalogs>
}

export interface I18n {
  /** Switch the active language (unknown languages just miss into the base). */
  setLocale(lang: string): void
  getLocale(): string
  /** Merge one language's catalog. `namespace` is advisory (kept for override
   *  composition at the loader layer); lookup is flat since ids are unique.
   *  Idempotent, last-write-wins per id. */
  registerCatalog(namespace: string, lang: string, catalog: Catalog): void
  /** Resolve `id` for the active language: active → base → id. `{name}`
   *  placeholders are filled from `params` (in every language). */
  t(id: string, params?: Params): string
  /** Whether `id` resolves to a real string (in the active or base language). */
  has(id: string): boolean
}

const PLACEHOLDER = /\{(\w+)\}/g

function fill(tpl: string, params: Params): string {
  return tpl.replace(PLACEHOLDER, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`))
}

/** Create an i18n instance. `base` (default `en`) is the guaranteed-complete
 *  fallback language; `active` defaults to `base`. */
export function createI18n(opts?: { base?: string; active?: string }): I18n {
  const base = opts?.base ?? 'en'
  let active = opts?.active ?? base
  // Flat merged catalog per language; ids are globally unique so namespace need
  // not be a lookup dimension.
  const merged: Record<string, Catalog> = {}

  return {
    setLocale(lang: string): void {
      active = lang
    },
    getLocale(): string {
      return active
    },
    registerCatalog(_namespace: string, lang: string, catalog: Catalog): void {
      Object.assign((merged[lang] ??= {}), catalog)
    },
    t(id: string, params?: Params): string {
      const tpl = merged[active]?.[id] ?? merged[base]?.[id] ?? id
      return params ? fill(tpl, params) : tpl
    },
    has(id: string): boolean {
      return merged[active]?.[id] !== undefined || merged[base]?.[id] !== undefined
    },
  }
}

/** Register every namespace/language of a LoadedCatalogs into an instance. */
export function applyCatalogs(i18n: I18n, loaded: LoadedCatalogs): void {
  for (const namespace in loaded) {
    const byLang = loaded[namespace]!
    for (const lang in byLang) i18n.registerCatalog(namespace, lang, byLang[lang]!)
  }
}

/** The minimal shape `registerEnabledPluginCatalogs` needs from a plugin: its
 *  id (→ `plugin:<id>` namespace) and an optional baked message fallback for
 *  when no JSON catalog was loaded (e.g. zero-dep core tooling). PluginManifest
 *  satisfies this. */
export interface PluginI18nSource {
  id: string
  messages?: Partial<Record<string, Catalog>>
}

/** Merge each enabled plugin's catalog under its `plugin:<id>` namespace: prefer
 *  the loaded JSON catalog, else fall back to the manifest's baked `messages`.
 *  Called by BOTH the editor and the engine so plugin chrome localizes uniformly. */
export function registerEnabledPluginCatalogs(
  i18n: I18n,
  plugins: PluginI18nSource[],
  loaded: LoadedCatalogs,
): void {
  for (const p of plugins) {
    const ns = `plugin:${p.id}`
    const fromJson = loaded[ns]
    if (fromJson) {
      for (const lang in fromJson) i18n.registerCatalog(ns, lang, fromJson[lang]!)
      continue
    }
    const baked = p.messages
    if (baked) {
      for (const lang in baked) {
        const cat = baked[lang]
        if (cat) i18n.registerCatalog(ns, lang, cat)
      }
    }
  }
}
