import type { ActorDef, AdvConfig, ChoicesConfig, InputConfig, MenuConfig, WindowConfig } from './types.js'
import type { Engine } from './engine.js'
import type { ThemeTokens } from './theme.js'
import { checkConfig } from './config-schema.js'

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

/** The shape of a script package's `config`: the sections `nilvn.json` carries
 *  itself are not the config's to set — the manifest names the actors, the
 *  enabled plugins, the entry and the language. `[path]` stays: its aliases
 *  expand onto the package's asset refs (`@bg/sea.svg` → `assets/bg/sea.svg`).
 *  Returns the config to apply (those keys dropped, the manifest's title in
 *  place as the title page's heading) and the paths that were dropped, for the
 *  engine to report. */
export function packageConfig(cfg: AdvConfig, title: string): { cfg: AdvConfig; ignored: string[] } {
  const ignored: string[] = []
  const { actors, ...rest } = cfg
  if (actors !== undefined) ignored.push('actors')
  const out: AdvConfig = { ...rest }
  const { entry, scripts, lang, ...game } = cfg.game ?? {}
  if (entry !== undefined) ignored.push('game.entry')
  if (lang !== undefined) ignored.push('game.lang')
  if (scripts !== undefined) ignored.push('game.scripts')
  out.game = { ...game, ...(title ? { title } : {}) }
  if (cfg.plugins) {
    const { use, ...tables } = cfg.plugins
    if (use !== undefined) ignored.push('plugins.use')
    out.plugins = tables
  }
  return { cfg: out, ignored }
}

/** Apply a parsed nilvn.config.toml onto an engine instance */
export function applyConfig(engine: Engine, cfg: AdvConfig): void {
  engine.config = cfg
  // A misspelled section or key is a diagnostic, not a silent no-op. The three
  // token-mapped sections report through their mappers (which also judge value
  // combinations such as `slice` without `skin`).
  reportConfigProblems(engine, cfg)
  const game = cfg.game ?? {}
  if (typeof game.title === 'string') document.title = game.title
  if (typeof game.lang === 'string' && game.lang) engine.applyConfigLang(game.lang)
  if (typeof game.defaultLang === 'string' && game.defaultLang) engine.defaultLang = game.defaultLang
  if (typeof game.textSpeed === 'number') engine.textSpeed = game.textSpeed
  if (typeof game.entry === 'string') engine.entry = game.entry
  if (Array.isArray(game.scripts)) engine.scripts = game.scripts.filter((s): s is string => typeof s === 'string' && s !== '')
  if (cfg.preload) Object.assign(engine.preloadConfig, cfg.preload)
  Object.assign(engine.alias, cfg.path)
  // `face` is the file's spelling of the runtime's `defaultFace`.
  for (const [id, a] of Object.entries(cfg.actors ?? {})) {
    const { face, ...def } = a as ActorDef & { face?: string }
    engine.actors[id] = face !== undefined && def.defaultFace === undefined ? { ...def, defaultFace: face } : def
  }
  Object.assign(engine.macros, cfg.macros)
  mergeDefaults(engine.defaults, cfg.defaults)
  // Queued before the theme so a plugin's own tokens in [theme] are judged
  // once its plugin is installed, not reported as unknown now.
  if (cfg.plugins?.use) engine.queueUse(cfg.plugins.use)
  if (cfg.saves?.autosave !== undefined) engine.autosave = cfg.saves.autosave
  // Before the panels: a button's `key` is checked against these bindings.
  if (cfg.keys) Object.assign(engine.keysConfig, cfg.keys)
  for (const [name, def] of Object.entries(cfg.persist ?? {})) engine.declarePersist(name, def)
  applyPresentation(engine, cfg)
  for (const [k, v] of Object.entries(cfg.plugins ?? {})) {
    if (k === 'use' || !v || typeof v !== 'object' || Array.isArray(v)) continue
    engine.setPluginConfig(k, v as Record<string, unknown>)
  }
  engine.normalizeActors()
  // The menu was built at construction from the defaults: rebuild it so a
  // config loaded afterwards (the documented order) shapes its items and strings.
  engine.refreshMenu()
}

/** The sections `engine.reconfigure()` re-applies on a live engine: how the
 *  work looks and what its chrome offers, never its content or its rules. */
export const PRESENTATION_SECTIONS = ['theme', 'window', 'choices', 'input', 'title', 'ending', 'saves', 'menu', 'settings', 'ui', 'strings', 'fonts'] as const

/** Report a config's unknown sections / keys and bad values (the token-mapped
 *  `[window]` / `[input]` / `[choices]` report through their mappers instead). */
export function reportConfigProblems(engine: Engine, cfg: AdvConfig): void {
  for (const p of checkConfig(cfg, { skip: ['window', 'input', 'choices'] })) engine.report({ phase: 'load', message: `config: ${p.path}: ${p.message}` }, true)
}

/** Merge the presentation sections of `cfg` onto the engine: the base theme
 *  layer (`[theme]` and the token-mapped `[window]` / `[input]` / `[choices]` /
 *  `[menu]` looks), the pages' and the menu's config, the player-setting
 *  defaults, the panels and the chrome strings. `[saves] autosave` is not one of
 *  them (applyConfig sets it). @internal — applyConfig and Engine.reconfigure. */
export function applyPresentation(engine: Engine, cfg: AdvConfig): void {
  const resolve = (p: string): string => engine.resolve(p)
  if (cfg.fonts) engine.fonts.define(cfg.fonts, resolve)
  if (cfg.ui) engine.ui.define(cfg.ui)
  if (cfg.theme) engine.setTheme(cfg.theme)
  if (cfg.title) Object.assign(engine.titleConfig, cfg.title)
  for (const [id, e] of Object.entries(cfg.ending ?? {})) engine.endingConfig[id] = { ...engine.endingConfig[id], ...e }
  if (cfg.saves) {
    const { autosave: _autosave, ...saves } = cfg.saves
    Object.assign(engine.savesConfig, saves)
  }
  if (cfg.menu) {
    Object.assign(engine.menuConfig, cfg.menu)
    const { tokens, unknown } = menuTheme(cfg.menu, resolve)
    for (const k of unknown) engine.report({ phase: 'load', message: `[menu] unknown key "${k}" — ignored` }, true)
    engine.setTheme(tokens)
  }
  if (cfg.settings) {
    Object.assign(engine.settingsConfig, cfg.settings)
    if (typeof cfg.settings.autoDelay === 'number') engine.setAutoDelay(cfg.settings.autoDelay, false)
    if (cfg.settings.skipMode) engine.setSkipMode(cfg.settings.skipMode, false)
  }
  if (cfg.input) {
    Object.assign(engine.inputConfig, cfg.input)
    const { tokens, unknown } = inputTheme(cfg.input, resolve)
    for (const k of unknown) engine.report({ phase: 'load', message: `[input] unknown key "${k}" — ignored` }, true)
    engine.setTheme(tokens)
  }
  for (const [lang, table] of Object.entries(cfg.strings ?? {})) engine.messages[lang] = { ...engine.messages[lang], ...table }
  if (cfg.window) {
    const { tokens, unknown } = windowTheme(cfg.window, resolve)
    for (const k of unknown) engine.report({ phase: 'load', message: `[window] unknown key "${k}" — ignored` }, true)
    engine.setTheme(tokens)
    const o = cfg.window.overflow
    if (o === 'grow' || o === 'page' || o === 'shrink') engine.stage.setOverflow(o)
  }
  if (cfg.choices) {
    Object.assign(engine.choicesConfig, cfg.choices)
    const { tokens, unknown } = choicesTheme(cfg.choices, resolve)
    for (const k of unknown) engine.report({ phase: 'load', message: `[choices] unknown key "${k}" — ignored` }, true)
    engine.setTheme(tokens)
    engine.stage.setChoicesLayout({ position: cfg.choices.position, layout: cfg.choices.layout, columns: cfg.choices.columns })
  }
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
          // Nine-slice: the image goes to `border-image`, the stretch layer is cleared.
          Object.assign(t, skinTokens('dialog', `url("${resolve(v)}")`, win.slice, win.sliceWidth))
          if (win.background === undefined) t['dialog-bg'] = 'transparent'
          if (win.border === undefined) t['dialog-border'] = 'none'
          // The artwork is the box: no drop shadow around its rectangle.
          t['dialog-shadow'] = 'none'
        }
        break
      case 'slice':
      case 'sliceWidth':
        if (!win.skin) unknown.push(`${key} (needs skin)`)
        break
      case 'background': t['dialog-bg'] = str(v); break
      case 'border': t['dialog-border'] = str(v); break
      case 'radius': t['dialog-radius'] = str(v); break
      case 'opacity': t['dialog-opacity'] = str(v); break
      case 'position':
        // A box at the top leaves the bottom free: bottom HUDs, the toast and
        // bottom choices sit at the stage's edge instead of above the box.
        if (top) { t['dialog-top'] = str(win.offset) ?? '3.5cqh'; t['dialog-bottom'] = 'auto'; t['dialog-clearance'] = 'var(--nilvn-space-m)' }
        else if (v !== 'bottom') unknown.push(`position=${String(v)}`)
        break
      case 'overflow':
        // Behaviour, not a token (applyConfig hands it to the stage); validated here.
        if (v !== 'grow' && v !== 'page' && v !== 'shrink') unknown.push(`overflow=${String(v)}`)
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
      case 'nameRadius': t['name-radius'] = str(v); break
      case 'nameSkin':
        if (typeof v === 'string' && v && v !== 'none') {
          Object.assign(t, skinTokens('name', `url("${resolve(v)}")`, win.nameSlice, win.nameSliceWidth))
          // The artwork is the tag: no colour pill, rounding or drop shadow around it.
          if (win.nameBackground === undefined) t['name-bg'] = 'transparent'
          if (win.nameRadius === undefined) t['name-radius'] = '0'
          t['name-shadow'] = 'none'
        }
        break
      case 'nameSlice':
      case 'nameSliceWidth':
        if (!win.nameSkin) unknown.push(`${key} (needs nameSkin)`)
        break
      case 'indicatorColor': t['indicator-color'] = str(v); break
      default: unknown.push(key)
    }
  }
  return { tokens: t, unknown }
}

/** A skin image as theme tokens: `<prefix>-skin` for a stretched image, or
 *  `<prefix>-skin-slice` (a CSS `border-image` value) when `slice` is given. */
function skinTokens(prefix: string, url: string, slice: number | string | undefined, sliceWidth: string | number | undefined): ThemeTokens {
  const s = skinLayers(url, slice, sliceWidth)
  return s.slice ? { [`${prefix}-skin-slice`]: s.slice, [`${prefix}-skin`]: 'none' } : { [`${prefix}-skin`]: s.skin }
}

/** The CSS of a skin: a stretched background image (`skin`), or — with `slice` —
 *  a nine-slice `border-image` value (`slice`, the stretch layer then `none`).
 *  `url` is a CSS `url("…")`. Shared by the token mappers and the `[ui]` panels. */
export function skinLayers(url: string, slice: number | string | undefined, sliceWidth: string | number | undefined): { skin: string; slice?: string } {
  if (slice !== undefined && slice !== '' && slice !== 0) {
    const s = String(slice).trim()
    const width = sliceWidth !== undefined ? String(sliceWidth) : s.split(/\s+/).map((n) => `${n}px`).join(' ')
    return { skin: 'none', slice: `${url} ${s} fill / ${width} stretch` }
  }
  return { skin: url }
}

/** `[menu]` look keys → the ☰ button's `menu-button-*` tokens and the system
 *  pages' `panel-skin*`; the other keys are the menu's own (`engine.menuConfig`).
 *  Returns the value combinations it cannot use (a `slice` without its skin). */
export function menuTheme(cfg: MenuConfig, resolve: (path: string) => string): { tokens: ThemeTokens; unknown: string[] } {
  const t: ThemeTokens = {}
  const unknown: string[] = []
  const skin = (v: unknown): v is string => typeof v === 'string' && v !== '' && v !== 'none'
  if (skin(cfg.skin)) {
    Object.assign(t, skinTokens('menu-button', `url("${resolve(cfg.skin)}")`, cfg.slice, cfg.sliceWidth))
    // The artwork is the button: no circle, no frame, no fill unless asked for.
    if (cfg.background === undefined) t['menu-button-bg'] = 'transparent'
    t['menu-button-border'] = 'none'
    t['menu-button-radius'] = '0'
  } else for (const k of ['slice', 'sliceWidth'] as const) if (cfg[k] !== undefined) unknown.push(`${k} (needs skin)`)
  if (cfg.background !== undefined) t['menu-button-bg'] = String(cfg.background)
  if (cfg.color !== undefined) t['menu-button-color'] = String(cfg.color)
  if (skin(cfg.panelSkin)) Object.assign(t, skinTokens('panel', `url("${resolve(cfg.panelSkin)}")`, cfg.panelSlice, cfg.panelSliceWidth))
  else for (const k of ['panelSlice', 'panelSliceWidth'] as const) if (cfg[k] !== undefined) unknown.push(`${k} (needs panelSkin)`)
  return { tokens: t, unknown }
}

/** `[input]` look keys → `input-*` tokens (the non-look keys — `position`,
 *  `ok`, `cancel` — stay on `engine.inputConfig`). */
export function inputTheme(input: InputConfig, resolve: (path: string) => string): { tokens: ThemeTokens; unknown: string[] } {
  const t: ThemeTokens = {}
  const unknown: string[] = []
  const str = (v: string | number | undefined): string | undefined => (v === undefined ? undefined : String(v))
  for (const key of Object.keys(input)) {
    const v = (input as Record<string, unknown>)[key] as string | number | undefined
    switch (key) {
      case 'skin':
        if (typeof v === 'string' && v && v !== 'none') {
          Object.assign(t, skinTokens('input-box', `url("${resolve(v)}")`, input.slice, input.sliceWidth))
          if (input.background === undefined) t['input-box-bg'] = 'transparent'
          if (input.border === undefined) t['input-box-border'] = 'none'
        }
        break
      case 'slice':
      case 'sliceWidth':
        if (!input.skin) unknown.push(`${key} (needs skin)`)
        break
      case 'background': t['input-box-bg'] = str(v); break
      case 'border': t['input-box-border'] = str(v); break
      case 'radius': t['input-box-radius'] = str(v); break
      case 'fieldBackground': t['input-bg'] = str(v); break
      case 'fieldColor': t['input-color'] = str(v); break
      case 'fieldBorder': t['input-border'] = str(v); break
      case 'fieldRadius': t['input-radius'] = str(v); break
      case 'fieldSize': t['input-size'] = str(v); break
      case 'promptColor': t['input-prompt-color'] = str(v); break
      case 'buttonBackground': t['input-button-bg'] = str(v); break
      case 'buttonColor': t['input-button-color'] = str(v); break
      case 'position':
        if (v !== 'center' && v !== 'top' && v !== 'bottom') unknown.push(`position=${String(v)}`)
        break
      case 'ok':
      case 'cancel':
        break
      default: unknown.push(key)
    }
  }
  return { tokens: t, unknown }
}

/** `[choices]` look keys → `choice-*` tokens (layout / behaviour keys stay on
 *  `engine.choicesConfig` and the stage). */
export function choicesTheme(cfg: ChoicesConfig, resolve: (path: string) => string): { tokens: ThemeTokens; unknown: string[] } {
  const t: ThemeTokens = {}
  const unknown: string[] = []
  const str = (v: string | number | undefined): string | undefined => (v === undefined ? undefined : String(v))
  for (const key of Object.keys(cfg)) {
    const v = (cfg as Record<string, unknown>)[key] as string | number | undefined
    switch (key) {
      case 'skin':
        if (typeof v === 'string' && v && v !== 'none') {
          Object.assign(t, skinTokens('choice', `url("${resolve(v)}")`, cfg.slice, cfg.sliceWidth))
          if (cfg.background === undefined) t['choice-bg'] = 'transparent'
          if (cfg.border === undefined) t['choice-border'] = 'none'
        }
        break
      case 'slice':
      case 'sliceWidth':
        if (!cfg.skin) unknown.push(`${key} (needs skin)`)
        break
      case 'gap': t['choices-gap'] = str(v); break
      case 'width': t['choice-width'] = str(v); break
      case 'background': t['choice-bg'] = str(v); break
      case 'border': t['choice-border'] = str(v); break
      case 'radius': t['choice-radius'] = str(v); break
      case 'color': t['choice-color'] = str(v); break
      case 'size': t['choice-size'] = str(v); break
      case 'hover': t['choice-hover'] = str(v); break
      case 'chosenBackground': t['choice-chosen-bg'] = str(v); break
      case 'chosenColor': t['choice-chosen-color'] = str(v); break
      // plain text, quoted into a CSS `content` string
      case 'chosenMark': t['choice-chosen-mark'] = `"${String(str(v) ?? '').replace(/["\\]/g, '\\$&')}"`; break
      case 'disabledBackground': t['choice-disabled-bg'] = str(v); break
      case 'disabledColor': t['choice-disabled-color'] = str(v); break
      case 'timerBackground': t['choice-timer-bg'] = str(v); break
      case 'timerColor': t['choice-timer-color'] = str(v); break
      case 'position':
        if (!['center', 'top', 'bottom', 'left', 'right'].includes(String(v))) unknown.push(`position=${String(v)}`)
        break
      case 'layout':
        if (v !== 'column' && v !== 'grid') unknown.push(`layout=${String(v)}`)
        break
      case 'chosenStyle':
        if (v !== 'none' && v !== 'dim' && v !== 'mark') unknown.push(`chosenStyle=${String(v)}`)
        break
      case 'columns':
      case 'timer':
      case 'timerDefault':
        if (typeof v !== 'number' || !(v > 0)) unknown.push(`${key}=${String(v)} (needs a positive number)`)
        break
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
