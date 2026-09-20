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
import { isValidRange, satisfiesRange } from './semver.js'

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

/** One plugin setting (`contributes.config`): a `ParamSchema` minus the command
 *  positional / required bits, plus a numeric range and who may change it. */
export interface ConfigFieldSchema extends Omit<ParamSchema, 'positional' | 'required'> {
  min?: number
  max?: number
  step?: number
  /** `author` (default): set in the config file / the studio, read-only in the
   *  game. `player`: also a row in the in-game settings panel, persisted per work
   *  (the author's value is the default). */
  scope?: 'author' | 'player'
}

/** An entry a plugin adds to the in-game system menu or the title page. */
export interface MenuItemDef {
  id: string
  /** An i18n id resolved through the plugin's `messages`. */
  label: string
  /** Menu entries: show only while `playing` (default) or on every session state. */
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
  saveSlice?: boolean
  config?: ConfigFieldSchema[]
  menuItems?: MenuItemDef[]
  titleItems?: MenuItemDef[]
  hud?: HudDef[]
  actorFields?: ActorFieldDef[]
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
  for (const a of m.contributes?.actorFields ?? []) {
    if (!a || typeof a.key !== 'string' || !CONFIG_KEY_RE.test(a.key)) errors.push(`contributes.actorFields: invalid key "${String(a?.key)}"`)
  }
  if (m.activation?.engine && !['eager', 'onCommand', 'manual'].includes(m.activation.engine)) errors.push(`unknown activation.engine "${m.activation.engine}"`)
  if (m.reload && m.reload !== 'hot' && m.reload !== 'restart') errors.push(`unknown reload policy "${m.reload}"`)
  if (m.entries && !m.entries.engine && !m.entries.editor) warnings.push('"entries" names neither an engine nor an editor module')
  return { errors, warnings }
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
