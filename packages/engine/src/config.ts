import type { AdvConfig, WindowConfig } from './types.js'
import type { Engine } from './engine.js'
import type { ThemeTokens } from './theme.js'

/** Stringify and merge per-command default params into the engine table */
export function mergeDefaults(
  target: Record<string, Record<string, string>>,
  source: Record<string, Record<string, string | number | boolean>> | undefined,
): void {
  for (const [cmd, table] of Object.entries(source ?? {})) {
    const t = (target[cmd] ??= {})
    for (const [key, value] of Object.entries(table)) t[key] = String(value)
  }
}

/** Apply a parsed nilvn.config.toml onto an engine instance */
export function applyConfig(engine: Engine, cfg: AdvConfig): void {
  engine.config = cfg
  const game = cfg.game ?? {}
  if (typeof game.title === 'string') document.title = game.title
  if (typeof game.textSpeed === 'number') engine.textSpeed = game.textSpeed
  if (typeof game.entry === 'string') engine.entry = game.entry
  Object.assign(engine.alias, cfg.path)
  Object.assign(engine.actors, cfg.actors)
  Object.assign(engine.macros, cfg.macros)
  mergeDefaults(engine.defaults, cfg.defaults)
  if (cfg.theme) engine.setTheme(cfg.theme)
  if (cfg.title) Object.assign(engine.titleConfig, cfg.title)
  for (const [id, e] of Object.entries(cfg.ending ?? {})) engine.endingConfig[id] = { ...engine.endingConfig[id], ...e }
  if (cfg.saves) Object.assign(engine.savesConfig, cfg.saves)
  if (cfg.saves?.autosave !== undefined) engine.autosave = cfg.saves.autosave
  if (cfg.menu) Object.assign(engine.menuConfig, cfg.menu)
  if (cfg.settings) {
    Object.assign(engine.settingsConfig, cfg.settings)
    if (typeof cfg.settings.autoDelay === 'number') engine.setAutoDelay(cfg.settings.autoDelay, false)
    if (cfg.settings.skipMode) engine.setSkipMode(cfg.settings.skipMode, false)
  }
  for (const [lang, table] of Object.entries(cfg.strings ?? {})) engine.messages[lang] = { ...engine.messages[lang], ...table }
  if (cfg.window) {
    const { tokens, unknown } = windowTheme(cfg.window, (p) => engine.resolve(p))
    for (const k of unknown) engine.report({ phase: 'load', message: `[window] unknown key "${k}" — ignored` }, true)
    engine.setTheme(tokens)
  }
  for (const [k, v] of Object.entries(cfg.plugins ?? {})) {
    if (k === 'use' || !v || typeof v !== 'object' || Array.isArray(v)) continue
    engine.setPluginConfig(k, v as Record<string, unknown>)
  }
  engine.normalizeActors()
  if (cfg.plugins?.use) engine.queueUse(cfg.plugins.use)
}

/** `[window]` keys → theme tokens. `skin` also clears the default gradient and
 *  border unless `background` / `border` are given. Returns the keys it did not
 *  recognize so the caller can report them. */
export function windowTheme(win: WindowConfig, resolve: (path: string) => string): { tokens: ThemeTokens; unknown: string[] } {
  const t: ThemeTokens = {}
  const unknown: string[] = []
  const str = (v: string | number | undefined): string | undefined => (v === undefined ? undefined : String(v))
  const top = win.position === 'top'
  for (const key of Object.keys(win)) {
    const v = (win as Record<string, unknown>)[key] as string | number | undefined
    switch (key) {
      case 'skin':
        if (typeof v === 'string' && v && v !== 'none') {
          t['dialog-skin'] = `url("${resolve(v)}")`
          if (win.background === undefined) t['dialog-bg'] = 'transparent'
          if (win.border === undefined) t['dialog-border'] = 'none'
        }
        break
      case 'background': t['dialog-bg'] = str(v); break
      case 'border': t['dialog-border'] = str(v); break
      case 'radius': t['dialog-radius'] = str(v); break
      case 'opacity': t['dialog-opacity'] = str(v); break
      case 'position':
        if (top) { t['dialog-top'] = str(win.offset) ?? '3.5cqh'; t['dialog-bottom'] = 'auto' }
        else if (v !== 'bottom') unknown.push(`position=${String(v)}`)
        break
      case 'offset': t[top ? 'dialog-top' : 'dialog-bottom'] = str(v); break
      case 'inset': t['dialog-inset'] = str(v); break
      case 'height': t['dialog-height'] = str(v); break
      case 'padding': t['dialog-padding'] = str(v); break
      case 'font': t.font = str(v); break
      case 'textSize': t['text-size'] = str(v); break
      case 'textColor': t['text-color'] = str(v); break
      case 'lineHeight': t['text-line-height'] = str(v); break
      case 'textShadow': t['text-shadow'] = str(v); break
      case 'nameBackground': t['name-bg'] = str(v); break
      case 'nameColor': t['name-color'] = str(v); break
      case 'nameSize': t['name-size'] = str(v); break
      case 'indicatorColor': t['indicator-color'] = str(v); break
      default: unknown.push(key)
    }
  }
  return { tokens: t, unknown }
}

/** Fetch and parse a TOML config file (the parser loads lazily) */
export async function fetchConfig(url: string): Promise<AdvConfig> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load config ${url}: ${res.status}`)
  const { parse } = await import('smol-toml')
  return parse(await res.text()) as AdvConfig
}
