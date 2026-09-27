// Plugin manifest v2 (`plugin.json`) — the declarative half of the plugin
// platform.
// A manifest says WHAT a plugin contributes (extension points), WHAT it needs
// (permissions) and HOW the host should run it (activation / reload / entries);
// the executable halves live in the engine (`entries.engine`) and the editor
// (`entries.editor`). Host-registry plugins (the first-party set in
// @nilvn/plugins, or any module a host registers itself) use the `'bundled'`
// entry sentinel — the hosts resolve those from their own registries.
//
// Two catalogs are the host-owned vocabulary a plugin may NOT extend:
//   EXTENSION_POINTS — the keys `contributes` may carry (unknown keys are
//                      ignored with a warning: forward-compatible);
//   PERMISSIONS      — the capability ids `permissions` may request; a plugin
//                      only ever receives the capability objects it declared AND
//                      the host granted (the rest are simply `undefined`).

import type { CommandSchema, EffectSchema, ObjectKindSchema, ParamSchema, ParamType, TextEffectDef } from './schema.js'
import { isValidRange, parseSemVer, satisfiesRange } from './semver.js'

/** Every `ParamType` (command params and config fields). */
export const PARAM_TYPES: readonly ParamType[] = ['string', 'number', 'boolean', 'enum', 'asset:bg', 'asset:bgm', 'asset:se', 'asset:sprite', 'actor', 'face', 'color', 'expr', 'variable', 'panel', 'key', 'script']
/** Every config field type: the param types plus the config-only `list`. */
export const CONFIG_TYPES: readonly ConfigFieldType[] = [...PARAM_TYPES, 'list']
/** Every `CommandCategory`. */
export const COMMAND_CATEGORIES: readonly string[] = ['stage', 'audio', 'fx', 'flow', 'text']

/** The plugin↔host contract version. A manifest declaring a higher `apiVersion`
 *  than the host supports is rejected (forward-compat is not guaranteed). v1 was
 *  the pre-batch-B `{ name, entry, capabilities }` shape; v2 = this file. */
export const PLUGIN_API_VERSION = 2

/** The file a plugin package is rooted at. */
export const PLUGIN_MANIFEST_FILE = 'plugin.json'

/** The `entries.*` sentinel host-registry plugins use: the host's own registry
 *  supplies the module (the first-party set, or a module the host registered
 *  itself), nothing is fetched. */
export const BUNDLED_ENTRY = 'bundled'

// ---- permissions ----

export type PermissionSide = 'engine' | 'editor' | 'host'
export type CatalogStatus = 'active' | 'reserved'

export interface PermissionDef {
  /** The id a manifest writes; `pattern` ids end in `:` and take a suffix. */
  id: string
  group: string
  side: PermissionSide
  status: CatalogStatus
  pattern?: boolean
  /** What the capability object exposes (active) or is reserved for. */
  description: string
}

/** The closed capability catalog. */
export const PERMISSIONS: readonly PermissionDef[] = [
  { id: 'stage.read', group: 'stage', side: 'engine', status: 'active', description: 'Read stage objects: hasObject / getProp / getBand / getFace / hasChar / charFace / snapshot.' },
  { id: 'stage.write', group: 'stage', side: 'engine', status: 'active', description: 'Stage read + every Renderer write verb, applyEffect, and keyframe choreography (playFrames / startLoop / stopLoop).' },
  { id: 'stage.layer:', group: 'stage', side: 'engine', status: 'reserved', pattern: true, description: 'A named renderer layer (weather / masks).' },
  { id: 'audio.play', group: 'audio', side: 'engine', status: 'active', description: 'playTrack / stopTrack / stopAllTracks / playSe, channel volumes and voicePlaying.' },
  { id: 'audio.bus:', group: 'audio', side: 'engine', status: 'reserved', pattern: true, description: 'A specific audio bus.' },
  { id: 'audio.capture', group: 'audio', side: 'host', status: 'reserved', description: 'Microphone capture (host-mediated).' },
  { id: 'vars.read', group: 'data', side: 'engine', status: 'active', description: 'Read script variables.' },
  { id: 'vars.write', group: 'data', side: 'engine', status: 'active', description: 'Read + write script variables.' },
  { id: 'save.slice', group: 'data', side: 'engine', status: 'active', description: 'Own a SaveState.ext slice (saveState / restoreState are called).' },
  { id: 'session.save', group: 'session', side: 'engine', status: 'active', description: 'saveState / restoreState / restart, the work save key and build info.' },
  { id: 'session.settings', group: 'session', side: 'engine', status: 'active', description: 'Text speed, channel volumes, language switching, resolveText.' },
  { id: 'session.backlog', group: 'session', side: 'engine', status: 'active', description: 'The dialogue backlog and voice replay by ref.' },
  { id: 'session.replay', group: 'session', side: 'engine', status: 'active', description: 'A–B replay segments: list / play / end / seen signals.' },
  { id: 'ui.layer', group: 'ui', side: 'engine', status: 'active', description: 'A host container inside the stage root (removed on dispose).' },
  { id: 'ui.screen', group: 'ui', side: 'engine', status: 'active', description: 'Full-stage screens over the story, entries in the system menu and on the title page, HUD widgets (the menuItems / titleItems / hud contributions).' },
  { id: 'ui.dialog', group: 'ui', side: 'engine', status: 'active', description: 'In-engine confirm / alert boxes and toasts (never the browser’s).' },
  { id: 'ui.panel', group: 'ui', side: 'editor', status: 'active', description: 'A manager panel host in the editor.' },
  { id: 'ui.window', group: 'ui', side: 'editor', status: 'active', description: 'A draggable editor window.' },
  { id: 'ui.toast', group: 'ui', side: 'editor', status: 'active', description: 'Editor toasts.' },
  { id: 'ui.inspector', group: 'ui', side: 'editor', status: 'reserved', description: 'The selected-object inspector panel.' },
  { id: 'project.read', group: 'project', side: 'editor', status: 'active', description: 'Read the open project (IR) and editor state.' },
  { id: 'project.commit', group: 'project', side: 'editor', status: 'active', description: 'Mutate the project through the editor (undoable).' },
  { id: 'assets.read', group: 'project', side: 'editor', status: 'active', description: 'Resolve project assets.' },
  { id: 'assets.write', group: 'project', side: 'editor', status: 'active', description: 'Import / replace project assets.' },
  { id: 'fs.pick', group: 'system', side: 'host', status: 'reserved', description: 'Native file picker (host-mediated).' },
  { id: 'fs.project', group: 'system', side: 'host', status: 'reserved', description: 'Files under the project directory (host-mediated).' },
  { id: 'net:', group: 'system', side: 'host', status: 'reserved', pattern: true, description: 'Network access to one origin (host-mediated; third-party default-deny).' },
  { id: 'clipboard', group: 'system', side: 'host', status: 'reserved', description: 'Clipboard read / write.' },
  { id: 'timer', group: 'system', side: 'engine', status: 'active', description: 'setTimeout / setInterval / requestAnimationFrame, cleared on dispose.' },
  { id: 'input.keys', group: 'ui', side: 'engine', status: 'active', description: 'Keyboard bindings declared in contributes.keybindings, handled through ctx.input.on; the player can rebind them in the settings.' },
  { id: 'storage.local', group: 'data', side: 'engine', status: 'active', description: 'A key-value store namespaced per work and plugin (async, JSON values) — the engine’s SaveStore.' },
  { id: 'ai.text', group: 'ai', side: 'host', status: 'reserved', description: 'Text generation through the configured provider.' },
  { id: 'ai.image', group: 'ai', side: 'host', status: 'reserved', description: 'Image generation.' },
  { id: 'ai.audio', group: 'ai', side: 'host', status: 'reserved', description: 'Audio / voice generation.' },
  { id: 'ai.code', group: 'ai', side: 'host', status: 'reserved', description: 'Code generation (plugins from natural language).' },
  { id: 'ai.context', group: 'ai', side: 'host', status: 'reserved', description: 'Read the authoring context handed to AI slots.' },
]

/** A permission id as a manifest writes it (pattern ids carry their suffix). */
export type Permission =
  | 'stage.read'
  | 'stage.write'
  | `stage.layer:${string}`
  | 'audio.play'
  | `audio.bus:${string}`
  | 'audio.capture'
  | 'vars.read'
  | 'vars.write'
  | 'save.slice'
  | 'session.save'
  | 'session.settings'
  | 'session.backlog'
  | 'session.replay'
  | 'ui.layer'
  | 'ui.screen'
  | 'ui.dialog'
  | 'storage.local'
  | 'input.keys'
  | 'ui.panel'
  | 'ui.window'
  | 'ui.toast'
  | 'ui.inspector'
  | 'project.read'
  | 'project.commit'
  | 'assets.read'
  | 'assets.write'
  | 'fs.pick'
  | 'fs.project'
  | `net:${string}`
  | 'clipboard'
  | 'timer'
  | 'ai.text'
  | 'ai.image'
  | 'ai.audio'
  | 'ai.code'
  | 'ai.context'

/** Resolve a permission id (exact, or a pattern id with its suffix) to its
 *  catalog entry; undefined for anything outside the catalog. */
export function matchPermission(id: string): PermissionDef | undefined {
  for (const p of PERMISSIONS) {
    if (p.pattern ? id.startsWith(p.id) && id.length > p.id.length : id === p.id) return p
  }
  return undefined
}

// ---- extension points ----

export interface ExtensionPointDef {
  key: string
  side: 'engine' | 'editor'
  status: CatalogStatus
  /** Schema version of this point's contribution shape. */
  version: number
  description: string
}

/** The keys `contributes` may carry. */
export const EXTENSION_POINTS: readonly ExtensionPointDef[] = [
  { key: 'commands', side: 'engine', status: 'active', version: 1, description: 'Script commands `[name …]` (CommandSchema drives the insert form).' },
  { key: 'textEffects', side: 'engine', status: 'active', version: 1, description: 'Inline text effects `{name:text}`.' },
  { key: 'objectKinds', side: 'engine', status: 'active', version: 1, description: 'Addressable stage-object kinds.' },
  { key: 'effects', side: 'engine', status: 'active', version: 1, description: 'Retargetable effects bound to kinds via appliesToKinds.' },
  { key: 'hooks', side: 'engine', status: 'active', version: 1, description: 'Engine hook names the runtime half listens to (introspection; the module is authoritative).' },
  { key: 'saveSlice', side: 'engine', status: 'active', version: 1, description: 'Declares a SaveState.ext slice owned by this plugin.' },
  { key: 'config', side: 'engine', status: 'active', version: 1, description: 'Plugin settings (ConfigFieldSchema[]): the config file’s [plugins.<id>] table and ctx.config at runtime; scope = player rows also appear in the in-game settings panel and persist per work.' },
  { key: 'menuItems', side: 'engine', status: 'active', version: 1, description: 'Entries in the in-game system menu (wired with ctx.screen.menuItem; needs ui.screen).' },
  { key: 'titleItems', side: 'engine', status: 'active', version: 1, description: 'Buttons on the title page (ctx.screen.titleItem; needs ui.screen).' },
  { key: 'hud', side: 'engine', status: 'active', version: 1, description: 'Persistent widgets in a stage corner while playing (ctx.screen.hud; needs ui.screen).' },
  { key: 'actorFields', side: 'engine', status: 'active', version: 1, description: 'Fields an actor declaration may carry for this plugin ([actors.<id>] / [actor …]), reached as ctx.actorField(actorId, key).' },
  { key: 'keybindings', side: 'engine', status: 'active', version: 1, description: 'Keyboard bindings in the engine’s key table (id, default key, label, when); handled through ctx.input.on (needs input.keys), rebindable by the player.' },
  { key: 'services', side: 'engine', status: 'active', version: 1, description: 'Services this plugin offers other plugins (id + semver version), provided through ctx.services.provide; a consumer lists the provider in dependencies and calls ctx.services.get.' },
  { key: 'themeTokens', side: 'engine', status: 'active', version: 1, description: 'The plugin’s own theme tokens (--nilvn-<short>-*) with their defaults: set by the work’s [theme] like the engine’s, read by the plugin’s styles and ctx.theme.' },
  { key: 'rendererLayers', side: 'engine', status: 'reserved', version: 1, description: 'Named renderer layers.' },
  { key: 'panels', side: 'editor', status: 'active', version: 1, description: 'Manager panels (the editor renders the host; the plugin fills it).' },
  { key: 'nodeKinds', side: 'editor', status: 'active', version: 1, description: 'IR node kinds this plugin owns (forms + inert flag while disabled).' },
  { key: 'stageTools', side: 'editor', status: 'active', version: 1, description: 'Stage overlay tools (modal takeovers of the stage).' },
  { key: 'lineActions', side: 'editor', status: 'active', version: 1, description: 'Buttons on a dialogue line’s action bar.' },
  { key: 'objectMenu', side: 'editor', status: 'active', version: 1, description: 'Sections in an on-stage object’s context menu.' },
  { key: 'windows', side: 'editor', status: 'reserved', version: 1, description: 'Draggable editor windows.' },
  { key: 'insertPalette', side: 'editor', status: 'reserved', version: 1, description: 'Insert-palette categories and entries.' },
  { key: 'timelineLanes', side: 'editor', status: 'reserved', version: 1, description: 'Extra timeline lanes.' },
  { key: 'exportSteps', side: 'editor', status: 'reserved', version: 1, description: 'Steps in the export pipeline.' },
  { key: 'projectMenuItems', side: 'editor', status: 'reserved', version: 1, description: 'Project menu entries.' },
  { key: 'inspectors', side: 'editor', status: 'reserved', version: 1, description: 'Selected-object inspector sections.' },
  { key: 'aiSlots', side: 'editor', status: 'reserved', version: 1, description: 'AI slots (roadmap §6).' },
  { key: 'aiProviders', side: 'editor', status: 'reserved', version: 1, description: 'AI providers (roadmap §6).' },
]

const POINT_KEYS = new Set(EXTENSION_POINTS.map((p) => p.key))

// ---- manifest ----

/** A manager panel the editor hosts for the plugin (was `PluginUI`). */
export interface PanelDef {
  id: string
  /** Tab label — an i18n id resolved through the plugin's `messages`. */
  label: string
  /** Free-form descriptor; the plugin renders its own panel body. */
  kind?: string
}

/** A config field's type: any `ParamType`, or `list` (config only). */
export type ConfigFieldType = ParamType | 'list'

/** One plugin setting (`contributes.config`): a `ParamSchema` minus the command
 *  positional / required bits, plus a numeric range, who may change it, and
 *  the config-only `list` type. */
export interface ConfigFieldSchema extends Omit<ParamSchema, 'positional' | 'required' | 'list' | 'type' | 'default'> {
  type: ConfigFieldType
  /** A `list`: a TOML array (`["prologue", "true_end"]`). */
  default?: string | number | boolean | string[] | number[]
  /** A `list`'s item type (default `string`). */
  items?: 'string' | 'number'
  min?: number
  max?: number
  step?: number
  /** `author` (default): set in the config file / the studio, read-only in the
   *  game. `player`: also a row in the in-game settings panel, persisted per work
   *  (the author's value is the default). A `list` is author-only. */
  scope?: 'author' | 'player'
}

/** An entry a plugin adds to the in-game system menu or the title page. */
export interface MenuItemDef {
  id: string
  /** An i18n id resolved through the plugin's `messages`. */
  label: string
  /** @deprecated Ignored: the system menu's list only opens while playing. A
   *  title-page entry is a `titleItems` entry. */
  when?: 'playing' | 'always'
}

/** A keyboard binding a plugin adds to the engine's key table. */
export interface KeybindingDef {
  /** Unique within the plugin; the table names it `<plugin id>:<id>`. */
  id: string
  /** The default key, in the `[keys]` format: `'w'`, `'Ctrl+S'`, several as an
   *  array, `false` = unbound until the author or player binds it. */
  default: string | string[] | false
  /** An i18n id resolved through the plugin's `messages` (the settings row). */
  label?: string
  /** `playing` (default): while the story plays with no menu or screen open;
   *  `always`: on the title / ending pages and plugin screens too. */
  when?: 'playing' | 'always'
}

/** A HUD widget slot. */
export interface HudDef {
  id: string
  slot?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

/** A field an actor declaration may carry for this plugin. */
export interface ActorFieldDef {
  key: string
  type: ParamType
  /** An i18n id (the studio's actor form). */
  label?: string
}

/** A service a plugin offers other plugins (`ctx.services.provide`). */
export interface ServiceDef {
  /** Unique within the plugin; consumers ask for `(plugin id, id)`. */
  id: string
  /** The service interface's own semver version; a consumer may pass a range. */
  version: string
}

/** A theme token a plugin adds to the `--nilvn-*` contract. */
export interface ThemeTokenDef {
  /** Token name, starting with the plugin's short name and a dash
   *  (`weather-drop` for `com.example.weather`); the custom property is
   *  `--nilvn-<name>`. */
  name: string
  /** A CSS value; may reference other tokens (`var(--nilvn-accent)`). */
  default: string
  /** An i18n id (the studio's theme form). */
  label?: string
}

/** The prefix a plugin's theme tokens must start with: its id's last segment,
 *  lower-cased, `_` → `-`, then a dash (`com.example.weather` → `weather-`). */
export function themeTokenPrefix(id: string): string {
  return (id.slice(id.lastIndexOf('.') + 1).toLowerCase().replace(/_/g, '-')) + '-'
}

/** Contributions per extension point. Every field optional; unknown keys are
 *  tolerated (ignored with a warning) so a newer plugin loads on an older host. */
export interface PluginContributions {
  commands?: CommandSchema[]
  textEffects?: TextEffectDef[]
  /** Object kinds this plugin contributes (declarative mirror of the engine's
   *  `objectKinds`). Built-in kinds live in BUILTIN_OBJECT_KINDS, not here. */
  objectKinds?: ObjectKindSchema[]
  effects?: EffectSchema[]
  hooks?: string[]
  /** The plugin owns a `SaveState.ext[id]` slice. `{ version }` names the
   *  slice's shape version (default 1); it must equal the module's
   *  `stateVersion`. */
  saveSlice?: boolean | { version: number }
  config?: ConfigFieldSchema[]
  menuItems?: MenuItemDef[]
  titleItems?: MenuItemDef[]
  hud?: HudDef[]
  actorFields?: ActorFieldDef[]
  keybindings?: KeybindingDef[]
  services?: ServiceDef[]
  themeTokens?: ThemeTokenDef[]
  panels?: PanelDef[]
  nodeKinds?: string[]
  stageTools?: string[]
  lineActions?: string[]
  objectMenu?: string[]
  /** Reserved points (see EXTENSION_POINTS) — typed loosely on purpose. */
  [reserved: string]: unknown
}

export interface PluginActivation {
  /** `eager` (default): activate when enabled; `onCommand`: at the first
   *  execution of one of its `contributes.commands`; `manual`: only via
   *  `engine.enablePlugin`. */
  engine?: 'eager' | 'onCommand' | 'manual'
  editor?: 'eager' | 'onPanelOpen'
}

/** `plugin.json` — what a plugin tells the hosts so users can enable and use it
 *  by clicking, and so the hosts can run it with exactly the capabilities it
 *  declared. Superset of the v1 manifest; `id` is the stable key everywhere
 *  (`name` is display only). */
export interface PluginManifest {
  /** Stable reverse-DNS id (`app.nilvn.textfx`). The enabled-set / `[use]` /
   *  i18n-namespace key. */
  id: string
  /** Display name: an i18n id resolved through `messages` (`plugin.textfx.name`). */
  name: string
  /** An i18n id (`plugin.textfx.desc`). */
  description?: string
  /** The plugin's own SemVer. */
  version: string
  /** Engine compatibility range (semver.ts subset); absent = any. */
  engine?: string
  /** Editor compatibility range; absent = any. */
  editor?: string
  /** Other plugins this one needs: id → range. Activated first; a missing or
   *  incompatible dependency keeps this plugin inactive with a diagnostic. */
  dependencies?: Record<string, string>
  contributes?: PluginContributions
  /** Capabilities requested from the PERMISSIONS catalog. */
  permissions?: Permission[]
  activation?: PluginActivation
  /** Hot-plug policy: `hot` (default) = deactivate / dispose / reactivate in
   *  place; `restart` = the host must reload (IR node shapes, renderer layers…). */
  reload?: 'hot' | 'restart'
  /** Module entries relative to plugin.json (`'bundled'` for host-registry
   *  plugins). No `engine` = a pure editor plugin (the former `editorOnly`); no
   *  `editor` = a pure runtime plugin. */
  entries?: { engine?: string; editor?: string }
  /** Stylesheets relative to plugin.json, scoped by the host per plugin id. */
  styles?: string[]
  /** Resource files relative to plugin.json (`sfx/click.ogg`) — the complete
   *  list an exporter copies next to the plugin, and the only paths
   *  `ctx.asset()` resolves. */
  assets?: string[]
  /** The plugin's own UI-chrome i18n catalog: `{ lang: { id: text } }`. The hosts
   *  register it under the `plugin:<id>` namespace. */
  messages?: Partial<Record<string, Record<string, string>>>
  /** Author-facing usage block (one display line per entry): how to trigger
   *  this plugin in an AuthoringDoc. Tools prefer it over deriving usage from
   *  `contributes`, which under-reports hook-only / auto plugins. */
  authorUsage?: string[]
  /** Plugin contract version this manifest targets (defaults to current). */
  apiVersion?: number
}

/** `id` grammar: reverse-DNS, ≥ 2 dot-separated labels of `[a-z0-9-]`, each
 *  starting with a letter. */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

export function isPluginId(s: string): boolean {
  return PLUGIN_ID_RE.test(s)
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface ManifestReport {
  /** Problems that reject the manifest. */
  errors: string[]
  /** Tolerated oddities (unknown extension points, reserved permissions…). */
  warnings: string[]
}

export interface ValidateManifestOptions {
  /** Host versions to check the manifest's ranges against (absent = skip). */
  engineVersion?: string
  editorVersion?: string
}

/** Load-time check of a manifest against the host's catalogs, contract version
 *  and (optionally) versions. Bundled manifests always pass with no warnings;
 *  this is the seam that guards third-party plugins. */
export function validatePluginManifest(m: PluginManifest, opts: ValidateManifestOptions = {}): ManifestReport {
  const errors: string[] = []
  const warnings: string[] = []
  if (typeof m.id !== 'string' || !isPluginId(m.id)) errors.push(`invalid plugin id "${String(m.id)}" (expected reverse-DNS, e.g. com.example.myfx)`)
  if (typeof m.name !== 'string' || !m.name) errors.push('missing "name"')
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) errors.push(`invalid "version" "${String(m.version)}" (expected x.y.z)`)
  if (m.apiVersion !== undefined && m.apiVersion > PLUGIN_API_VERSION) {
    errors.push(`requires plugin API v${m.apiVersion}, host is v${PLUGIN_API_VERSION}`)
  }
  for (const [field, range] of [['engine', m.engine], ['editor', m.editor]] as const) {
    if (range !== undefined && !isValidRange(range)) errors.push(`invalid "${field}" range "${range}"`)
  }
  if (m.engine && opts.engineVersion && isValidRange(m.engine) && !satisfiesRange(opts.engineVersion, m.engine)) {
    errors.push(`requires engine ${m.engine}, host is ${opts.engineVersion}`)
  }
  if (m.editor && opts.editorVersion && isValidRange(m.editor) && !satisfiesRange(opts.editorVersion, m.editor)) {
    errors.push(`requires editor ${m.editor}, host is ${opts.editorVersion}`)
  }
  for (const [dep, range] of Object.entries(m.dependencies ?? {})) {
    if (!isPluginId(dep)) errors.push(`invalid dependency id "${dep}"`)
    if (!isValidRange(range)) errors.push(`invalid range "${range}" for dependency "${dep}"`)
  }
  for (const p of m.permissions ?? []) {
    const def = matchPermission(p)
    if (!def) errors.push(`unknown permission "${p}"`)
    else if (def.status === 'reserved') warnings.push(`permission "${p}" is reserved — no host grants it yet`)
  }
  for (const key of Object.keys(m.contributes ?? {})) {
    if (!POINT_KEYS.has(key)) warnings.push(`unknown extension point "${key}" — ignored`)
    else if (EXTENSION_POINTS.find((p) => p.key === key)!.status === 'reserved') warnings.push(`extension point "${key}" is reserved — ignored`)
  }
  const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
  const seen = new Set<string>()
  for (const f of m.contributes?.config ?? []) {
    if (!f || typeof f.key !== 'string' || !CONFIG_KEY_RE.test(f.key)) errors.push(`contributes.config: invalid key "${String(f?.key)}"`)
    else if (seen.has(f.key)) errors.push(`contributes.config: duplicate key "${f.key}"`)
    else seen.add(f.key)
    if (f && f.scope !== undefined && f.scope !== 'author' && f.scope !== 'player') errors.push(`contributes.config."${String(f.key)}": unknown scope "${String(f.scope)}"`)
  }
  const bindingIds = new Set<string>()
  for (const k of m.contributes?.keybindings ?? []) {
    if (!k || typeof k.id !== 'string' || !CONFIG_KEY_RE.test(k.id)) errors.push(`contributes.keybindings: invalid id "${String(k?.id)}"`)
    else if (bindingIds.has(k.id)) errors.push(`contributes.keybindings: duplicate id "${k.id}"`)
    else bindingIds.add(k.id)
    const d = k?.default
    if (!(d === false || typeof d === 'string' || (Array.isArray(d) && d.every((x) => typeof x === 'string')))) errors.push(`contributes.keybindings."${String(k?.id)}": default must be a key, a list of keys or false`)
    if (k && k.when !== undefined && k.when !== 'playing' && k.when !== 'always') errors.push(`contributes.keybindings."${String(k.id)}": unknown when "${String(k.when)}"`)
  }
  for (const a of m.contributes?.actorFields ?? []) {
    if (!a || typeof a.key !== 'string' || !CONFIG_KEY_RE.test(a.key)) errors.push(`contributes.actorFields: invalid key "${String(a?.key)}"`)
  }
  const serviceIds = new Set<string>()
  for (const s of m.contributes?.services ?? []) {
    if (!s || typeof s.id !== 'string' || !CONFIG_KEY_RE.test(s.id)) errors.push(`contributes.services: invalid id "${String(s?.id)}"`)
    else if (serviceIds.has(s.id)) errors.push(`contributes.services: duplicate id "${s.id}"`)
    else serviceIds.add(s.id)
    if (s && (typeof s.version !== 'string' || !parseSemVer(s.version))) errors.push(`contributes.services."${String(s?.id)}": version must be a semver version ("1.0.0")`)
  }
  const tokenNames = new Set<string>()
  const prefix = typeof m.id === 'string' ? themeTokenPrefix(m.id) : ''
  for (const t of m.contributes?.themeTokens ?? []) {
    if (!t || typeof t.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(t.name)) errors.push(`contributes.themeTokens: invalid name "${String(t?.name)}" (lower-case words joined by dashes)`)
    else if (!t.name.startsWith(prefix) || t.name.length === prefix.length) errors.push(`contributes.themeTokens: "${t.name}" must start with "${prefix}" (the plugin's short name)`)
    else if (tokenNames.has(t.name)) errors.push(`contributes.themeTokens: duplicate name "${t.name}"`)
    else tokenNames.add(t.name)
    if (t && (typeof t.default !== 'string' || !t.default.trim())) errors.push(`contributes.themeTokens."${String(t?.name)}": default must be a CSS value`)
    else if (t && /[;{}]/.test(t.default)) errors.push(`contributes.themeTokens."${String(t.name)}": default must be one CSS value (no ";", "{" or "}")`)
  }
  if (m.activation?.engine && !['eager', 'onCommand', 'manual'].includes(m.activation.engine)) errors.push(`unknown activation.engine "${m.activation.engine}"`)
  if (m.reload && m.reload !== 'hot' && m.reload !== 'restart') errors.push(`unknown reload policy "${m.reload}"`)
  if (m.entries && !m.entries.engine && !m.entries.editor) warnings.push('"entries" names neither an engine nor an editor module')
  paramChecks(m, errors, warnings)
  for (const p of m.assets ?? []) if (!isPluginRelPath(p)) errors.push(`assets: "${String(p)}" is not a path inside the plugin (relative, no "..")`)
  const slice = m.contributes?.saveSlice
  if (slice && typeof slice === 'object' && !(Number.isInteger(slice.version) && slice.version >= 1)) errors.push(`contributes.saveSlice.version must be a positive integer`)
  return { errors, warnings }
}

/** The shape checks a hand-written manifest most often gets wrong: command and
 *  config field types, positional indexes, enum options, a contribution without
 *  the permission that wires it, and labels missing from the `en` messages. */
function paramChecks(m: PluginManifest, errors: string[], warnings: string[]): void {
  const c = m.contributes ?? {}
  const field = (where: string, f: { type?: unknown; options?: ParamSchema['options'] }, types: readonly string[] = PARAM_TYPES): void => {
    if (!types.includes(f.type as string)) errors.push(`${where}: unknown type "${String(f.type)}" (one of ${types.join(', ')})`)
    if (f.type === 'enum' && !(Array.isArray(f.options) && f.options.length && f.options.every((o) => o && typeof o === 'object' && typeof o.value === 'string' && typeof o.label === 'string'))) {
      errors.push(`${where}: an enum needs options: [{ value, label }, …]`)
    }
  }
  for (const cmd of c.commands ?? []) {
    const where = `contributes.commands."${String(cmd?.name)}"`
    if (!COMMAND_CATEGORIES.includes(cmd?.category)) errors.push(`${where}: category must be one of ${COMMAND_CATEGORIES.join(', ')}`)
    for (const p of cmd?.params ?? []) {
      field(`${where}.params."${String(p?.key)}"`, p)
      if (p?.positional !== undefined && !(Number.isInteger(p.positional) && p.positional >= 0)) errors.push(`${where}.params."${String(p.key)}": positional is the argument index (0, 1, …)`)
    }
  }
  for (const f of c.config ?? []) {
    if (!f) continue
    const where = `contributes.config."${String(f.key)}"`
    field(where, f, CONFIG_TYPES)
    if (f.type === 'list') {
      if (f.scope === 'player') errors.push(`${where}: a list is author-only (scope "player" is not supported)`)
      if (f.items !== undefined && f.items !== 'string' && f.items !== 'number') errors.push(`${where}: items is "string" or "number"`)
      const item = f.items === 'number' ? 'number' : 'string'
      if (f.default !== undefined && !(Array.isArray(f.default) && (f.default as unknown[]).every((x) => typeof x === item))) errors.push(`${where}: a list's default is an array of ${item}s`)
    } else if (f.items !== undefined) warnings.push(`${where}: items only applies to type "list"`)
  }
  const has = (perm: string): boolean => (m.permissions ?? []).includes(perm as Permission)
  const needs: [unknown, string, string][] = [
    [c.keybindings?.length, 'keybindings', 'input.keys'],
    [c.saveSlice, 'saveSlice', 'save.slice'],
    [c.menuItems?.length, 'menuItems', 'ui.screen'],
    [c.titleItems?.length, 'titleItems', 'ui.screen'],
    [c.hud?.length, 'hud', 'ui.screen'],
  ]
  for (const x of c.menuItems ?? []) if (x && 'when' in x) warnings.push(`contributes.menuItems."${String(x.id)}": "when" is deprecated and ignored — the system menu only opens while playing; use titleItems for the title page`)
  for (const [present, point, perm] of needs) if (present && !has(perm)) warnings.push(`contributes.${point} needs the "${perm}" permission — without it nothing is wired`)
  const en = m.messages?.en
  if (en) {
    const labels = [
      m.name,
      m.description,
      ...(c.commands ?? []).flatMap((x) => [x?.label, ...(x?.params ?? []).map((p) => p?.label), ...(x?.params ?? []).flatMap((p) => (p?.options ?? []).map((o) => o?.label))]),
      ...(c.config ?? []).map((f) => f?.label),
      ...(c.keybindings ?? []).map((k) => k?.label),
      ...(c.menuItems ?? []).map((x) => x?.label),
      ...(c.titleItems ?? []).map((x) => x?.label),
      ...(c.themeTokens ?? []).map((x) => x?.label),
    ]
    for (const id of labels) if (typeof id === 'string' && id.startsWith('plugin.') && !(id in en)) warnings.push(`messages.en has no "${id}"`)
  }
}

/** A path a plugin may name for its own files (`styles`, `assets`, `entries`):
 *  relative to plugin.json, forward slashes, no `..` segment, no scheme
 *  (`./engine.js` is fine). */
export function isPluginRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.startsWith('/') || p.endsWith('/') || p.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return false
  const segs = p.split('/')
  return !segs.includes('..') && segs.some((seg) => seg !== '' && seg !== '.')
}

/** A plugin path in its canonical form (`./sfx//a.ogg` → `sfx/a.ogg`): the
 *  spelling package refs and the `assets` list are compared in. */
export function normalizePluginPath(p: string): string {
  return p
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/')
}

/** Convenience: only the errors (the shape most call sites need). */
export function manifestErrors(m: PluginManifest, opts?: ValidateManifestOptions): string[] {
  return validatePluginManifest(m, opts).errors
}

/** Whether the manifest ships a runtime (engine) half. */
export function hasEngineHalf(m: PluginManifest): boolean {
  return !!m.entries?.engine
}

/** Whether the manifest ships an editor half. */
export function hasEditorHalf(m: PluginManifest): boolean {
  return !!m.entries?.editor
}
