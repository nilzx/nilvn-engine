import { builtins } from './builtins.js'
import { applyConfig, fetchConfig, mergeDefaults } from './config.js'
import { isThemeToken, THEME_TOKEN_RE } from './theme.js'
import { tUI, uiLangName } from './i18n.js'
import { AUTOSAVE_KEY, QUICKSAVE_KEY, READ_KEY, SETTINGS_KEY, UNLOCKS_KEY, PLUGIN_SETTINGS_KEY, GLOBALS_KEY, LocalStorageSaveStore, isSlotPayload, slotKey, type SaveStore, type SlotPayload, type SettingsPayload, type GlobalsPayload } from './save-store.js'
import type { ConfigFieldSchema } from '@nilvn/core'
import type { ScreenButton } from './renderer/types.js'
import { endingModel, titleModel, type ChromeHost } from './chrome.js'
import { SystemMenu } from './system-menu.js'
import type { TitleConfig, EndingConfig, MenuConfig, SavesConfig, SettingsConfig, SettingKey, KeysConfig, KeyAction, InputConfig, ChoicesConfig, PreloadConfig } from './types.js'
import { interpolateSegments, interpolateText, displayValue, type InterpolateHost } from './text.js'
import { buildFileManifest, expandIncludes, FileScriptLoader, scriptId, type ScriptFile } from './scripts.js'
import { isImageUrl, scanAssetRefs } from './preload.js'
import { UiPanels } from './ui.js'
import { screenBackground } from './chrome.js'
import { bindingOf, matchKey, isEditableTarget } from './keys.js'
import { FIRST_PARTY_ID_PREFIX } from './plugin-manifest.js'
import type { SessionState, VolumeChannel } from './types.js'

/** Actor keys the engine owns (never moved into a plugin's `ext`). */
const STANDARD_ACTOR_KEYS = new Set(['name', 'nameKey', 'color', 'textColor', 'sprites', 'defaultFace', 'canvas', 'layers', 'ext'])

/** Coerce a raw config value to its field's declared type (TOML and the studio
 *  hand typed values; a string from elsewhere still lands right). */
function coerceConfig(raw: unknown, field: ConfigFieldSchema): unknown {
  if (raw === undefined || raw === null) return field.default
  switch (field.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) return field.default
      const lo = field.min ?? -Infinity
      const hi = field.max ?? Infinity
      return Math.min(hi, Math.max(lo, n))
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : field.default
    case 'enum':
      return field.options?.some((o) => o.value === String(raw)) ? String(raw) : field.default
    default:
      return typeof raw === 'string' ? raw : String(raw)
  }
}

/** Engine field per volume channel (shared with the plugin context's caps). */
export const VOLUME_FIELD: Record<VolumeChannel, 'bgmVolume' | 'ambienceVolume' | 'seVolume' | 'voiceVolume'> = {
  bgm: 'bgmVolume',
  ambience: 'ambienceVolume',
  se: 'seVolume',
  voice: 'voiceVolume',
}
import { evalExpr, truthy } from './expr.js'
import { parseScript, parseSegments, parseTag } from './parser.js'
import { animate, DomRenderer, preloadImage } from './stage.js'
import type { EditStage, StageState } from './stage.js'
import type { ChoicePrompt, ChoiceView, CharLayer, CharOptions, SceneTransitionOpts, TransitionKind } from './renderer/types.js'
import { BUILTIN_KINDS, kindOf, ObjectHandle } from './object.js'
import { PluginHost } from './plugin-host.js'
import { decodeChannelSet, decodeFrames, decodeTracks, type DecodedFrame, type DecodedTrack } from './keyframes.js'
import { openPackage, type PackageSource, type ScriptPackage } from './package.js'
import { AudioBus, type TrackOptions } from './audio-bus.js'
import { ChunkResidency, HOLE } from './residency.js'
import { LoopRuntime, type SavedLoop } from './loop-runtime.js'
import { ReplayRegistry } from './replay.js'
// Chunked-streaming contract. Type-only ⇒ erased from the IIFE; the
// engine consumes the same manifest/loader shape the editor produces.
import type { ChunkManifest, ContentLoader } from '@nilvn/core'
import type {
  ActorDef,
  AdvConfig,
  BacklogEntry,
  BuiltinContext,
  ChoiceItem,
  ChoicesNode,
  CommandContext,
  CommandNode,
  DialogueNode,
  EffectDef,
  EffectParams,
  EngineDiagnostic,
  EngineHooks,
  EngineOptions,
  EnginePlugin,
  ObjectKind,
  PluginContext,
  PluginManifest,
  PluginState,
  RecordableProp,
  ScriptNode,
  Segment,
  TextEffectFn,
  TextSpan,
} from './types.js'
import type { BuiltinFn } from './builtins.js'

export type { SavedLoop } from './loop-runtime.js'

/** A hook's arguments minus the trailing PluginContext the host appends. */
type HookArgs<K extends keyof EngineHooks> = NonNullable<EngineHooks[K]> extends (...a: [...infer A, PluginContext]) => void ? A : never

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Where in the script a save resumes, addressed as (nearest preceding label,
 *  offset) rather than a flat node index. Label names — scene ids and in-scene
 *  labels — stay stable across re-compilation (including the per-scene compile of
 *  batch 4), so the address survives changes a flat index would not, and a missing
 *  label is a stronger staleness guard than the old node count. The empty label is
 *  an absolute address from the script start. */
export interface SaveAddress {
  label: string
  offset: number
}

/** A resumable snapshot of a play session (playhead + variables + stage). */
export interface SaveState {
  v: 2
  /** Playhead as a stable (label, offset) address (see SaveAddress). Replaces the
   *  pre-v2 flat `pos` + `nodeCount`, which broke under per-scene compilation. */
  at: SaveAddress
  vars: Record<string, unknown>
  stage: StageState
  textSpeed: number
  /** Content language at save time, restored so the load resumes in the same
   *  language. Optional — pre-i18n saves just keep the current language. */
  lang?: string
  /** Background music playing at save time, so the track resumes on load. */
  bgm?: { src: string; loop: boolean; volume: number }
  /** Non-music loop tracks (ambience beds) playing at save time, resumed on load.
   *  Absent = none, so older saves / loaders are unaffected. */
  tracks?: { track: string; src: string; loop: boolean; volume: number }[]
  /** LEGACY slot (pre-pluginization saves): loops used to persist here at the top
   *  level. Read on restore for old saves; new saves carry them in
   *  `ext.animstudio` instead, and never write this field. */
  activeLoops?: SavedLoop[]
  /** The `[call]` stack — where each pending `[return]` goes back to, innermost
   *  last. Absent = none, so older saves / loaders are unaffected. */
  calls?: SaveAddress[]
  /** `[ui show|hide]` decisions on the declarative panels. Absent = none. */
  ui?: Record<string, boolean>
  /** Per-plugin state slices, keyed by plugin id (EnginePlugin.saveState /
   *  restoreState; pre-batch-B saves used the bundled short names, which still
   *  resolve). A slice whose plugin is not active at load time is carried through
   *  to the next save untouched, so disabling a plugin never destroys its saved
   *  state. Absent = none, so older saves / loaders are unaffected. */
  ext?: Record<string, unknown>
}

/**
 * The engine: script loading, the node-execution loop, plugins, save/restore and
 * localization. The heavier subsystems are composed in and reach
 * back through small host interfaces: {@link AudioBus} (every <audio> element),
 * {@link ChunkResidency} (chunked streaming), {@link LoopRuntime} (recording
 * event-frames + loops) and {@link ReplayRegistry} (A–B segments). Commands see
 * only the `Renderer` via `CommandContext.stage`.
 */
export class Engine {
  // Concrete DOM renderer: the engine constructs it and drives its dialogue layer
  // through the Renderer verbs (typeLine / showChoices). Commands see only the
  // `Renderer` interface via `CommandContext.stage`.
  readonly stage: DomRenderer
  /** Script variables, written by [set] and read by [if] / choice conditions */
  vars: Record<string, unknown> = {}
  /** Persistent variables (`[persist]`, `[input persist=true]`, the `sys.*`
   *  namespace): they outlive the session — kept in the save store's `globals`
   *  key, never in a `SaveState` — and read through the same expressions and
   *  `{$var}` placeholders as `vars`. Write with `setVar` / `setGlobal`. The
   *  engine's own `sys.endings` / `sys.chosen` lists start empty. */
  readonly globals: Record<string, unknown> = { 'sys.endings': [], 'sys.chosen': [] }
  private readonly persistNames = new Set<string>()
  /** Everything the store held under `globals`, declared today or not: written
   *  back merged, so a declaration a work drops for a while loses nothing. */
  private storedGlobals: Record<string, unknown> = {}
  private globalsLoaded = false
  private globalsDirty = false
  /** `[input]` config (the `[input]` section): position and button labels. */
  readonly inputConfig: InputConfig = {}
  /** `[choices]` config: chosen style and timer (layout and tokens go to the stage). */
  readonly choicesConfig: ChoicesConfig = {}
  /** `[choices timer= default=]`: overrides for the next prompt only. */
  private nextChoices: { timer?: number; timerDefault?: number } | null = null
  /** `[game] scripts` — files played in order as chunks (see `loadScripts`). */
  scripts: string[] = []
  /** `[preload]` config: what `prepare()` warms and how the loading page looks. */
  readonly preloadConfig: PreloadConfig = {}
  /** Return addresses of the pending `[call]`s, innermost last. */
  private callStack: SaveAddress[] = []
  /** An armed scene transition (`[trans …]` / `trans=`), revealed at the next line. */
  private pendingTrans: { kind: TransitionKind; opts: SceneTransitionOpts } | null = null
  /** The declarative panels (`[ui.<id>]`). */
  readonly ui: UiPanels = new UiPanels(this)
  /** `prepare()` warmed the preload set for the loaded content. */
  private warmed = false
  /** Dismisses a pending `[input]` box (a load / restart during the prompt). */
  private promptCancel: (() => void) | null = null
  /** `{$var}` / `{@key}` filling for everything the engine shows. */
  private readonly textHost: InterpolateHost = {
    getVar: (name) => this.getVar(name),
    resolveKey: (key) => this.resolveText(key),
    missing: (name) => this.report({ phase: 'exec', message: `variable "${name}" is not defined — shown as empty` }, true),
  }
  /** The same, but an undefined variable is simply empty: panels draw as soon
   *  as play starts, before the script's first `[set]`. */
  private readonly quietTextHost: InterpolateHost = {
    getVar: (name) => this.getVar(name),
    resolveKey: (key) => this.resolveText(key),
    missing: () => {},
  }
  actors: Record<string, ActorDef> = {}
  /** Current content language; dialogue/choice/name keys resolve from
   *  catalogs[lang] first, then catalogs[defaultLang]. */
  lang = 'en'
  /** Fallback content language when a key is missing in `lang`. */
  defaultLang = 'en'
  /** Languages the in-game switcher offers (those that ship a catalog). */
  languages: string[] = ['en']
  /** Localized content: catalogs[lang][key] -> string (carries inline markup). */
  catalogs: Record<string, Record<string, string>> = {}
  /** Path prefix aliases, e.g. { '@bg': 'assets/bg' } */
  alias: Record<string, string> = {}
  /** Command macros: [bg_street] in a script expands via this table */
  macros: Record<string, string> = {}
  /** Per-command default params, merged under the script's explicit ones */
  defaults: Record<string, Record<string, string>> = {}
  /** Virtual asset table (resolved path -> inline URL) for single-file bundles */
  assets: Record<string, string> = {}
  /** The parsed nilvn.config.toml, for settings UIs and the like */
  config: AdvConfig = {}
  /** Script auto-loaded by start() when none was loaded explicitly */
  entry?: string
  private _textSpeed = 40
  /** Typewriter speed (characters per second); a change applies mid-line and
   *  reaches plugins as `onSettingsChange('textSpeed')`. */
  get textSpeed(): number {
    return this._textSpeed
  }
  set textSpeed(v: number) {
    if (v === this._textSpeed) return
    this._textSpeed = v
    this.settingChanged('textSpeed', v)
  }
  baseUrl: string
  /** Per-work id for saves / settings (the menu plugin namespaces localStorage by
   *  it). Set from the loaded package's `saveKey`, else `EngineOptions.saveKey`. */
  saveKey?: string
  /** The tool version that produced the loaded package (the menu shows it). */
  buildInfo?: string
  /** User master volume per audio channel (0..1), multiplied with each clip's
   *  authored volume. The in-game menu drives these; persistence is its job.
   *  `ambienceVolume` scales every named loop track other than 'music' (the
   *  ambience bus of the multi-track model,). */
  bgmVolume = 1
  ambienceVolume = 1
  seVolume = 1
  voiceVolume = 1

  /** The classic BGM slot's track name. */
  static readonly MUSIC_TRACK = AudioBus.MUSIC_TRACK

  private nodes: ScriptNode[] = []
  private labels: Record<string, number> = {}
  private pos = 0
  private running = false
  private destroyed = false
  /** Bumped on every run loop; an old loop sees the mismatch and bows out, so
   *  a load can cleanly restart play from a saved position. */
  private generation = 0
  /** Index of the node currently being shown/awaited — the spot a save resumes
   *  from, so loading re-shows that line/choice instead of skipping past it. */
  private resumeIndex = 0
  private typing = false
  private skipTyping = false
  /** Voice clip queued by [voice ...] for the very next dialogue line. `ref` is the
   *  raw asset ref (resolved to a URL only at play time), so the backlog can re-resolve
   *  it by ref after the source chunk was released. */
  private pendingVoice: { ref: string; offset: number } | null = null
  /** Session-only rolling log of played dialogue lines for the menu's backlog,
   *  capped to the most recent {@link BACKLOG_CAP}. Deliberately NOT persisted in a
   *  SaveState — it's play-session state, reset on every session entry. */
  private backlog: BacklogEntry[] = []
  private static readonly BACKLOG_CAP = 200
  private advanceResolve: (() => void) | null = null
  /** Resolver for a pending choices prompt, so a load() can unblock it. */
  private choiceResolve: (() => void) | null = null
  /** The engine's own commands (builtins.ts) — engine code, run with the engine in hand. */
  private builtinCommands = new Map<string, BuiltinFn>()
  /** Plugins: registry, activation, contributions, disposal (plugin-host.ts). */
  private readonly host: PluginHost
  /** The privileged context built-in commands carry as `ctx.plugin`. */
  private rootCtx: PluginContext | null = null

  // ---- composed subsystems ----
  private readonly audio: AudioBus
  private readonly residency: ChunkResidency
  private readonly loops: LoopRuntime
  private readonly replay = new ReplayRegistry()

  // ---- robustness contract ----
  /** Content problems reported so far, oldest first (capped at
   *  {@link Engine.DIAGNOSTICS_CAP}; the oldest are dropped). */
  readonly diagnostics: EngineDiagnostic[] = []
  private static readonly DIAGNOSTICS_CAP = 500
  /** `[use]` names that resolved to no plugin (their commands / effects degrade to
   *  no-ops with a diagnostic instead of aborting the script). */
  readonly missingPlugins: string[] = []
  /** Plugins quarantined after `pluginFailureLimit` consecutive command failures
   *  (or a throwing `setup`): their commands are no-ops for the rest of this engine's life. */
  readonly isolatedPlugins: string[] = []
  private readonly strict: boolean
  private readonly pluginFailureLimit: number
  private onErrorCb?: (info: EngineDiagnostic) => void
  /** Console lines already emitted (lenient mode dedupes repeats). */
  private logged = new Set<string>()
  /** The node executing right now, so a jump / load diagnostic raised from inside
   *  a command can point at the script line that asked for it. */
  private current: ScriptNode | null = null

  /** ext slices restored from a save whose plugin isn't installed — carried to the
   *  next save untouched (see SaveState.ext). Reset on every session entry. */
  private unclaimedExt: Record<string, unknown> = {}
  /** Orchestrator hook: called when a replay reaches its segment end (the menu
   *  restores the stashed pre-replay session here). Absent → the run finishes. */
  onReplayEnd: (() => void) | null = null
  private warned = new Set<string>()
  private onEndCb?: () => void
  private onReadyCb?: () => void
  private onSessionCb?: (state: SessionState, prev: SessionState) => void
  private sessionListeners = new Set<(state: SessionState, prev: SessionState) => void>()
  private _session: SessionState = 'idle'
  private _ending: string | undefined
  private pendingEnding: string | undefined
  private prepared = false
  private readyResolve!: () => void
  /** Resolves once `prepare()` (or the first `start()`) has content and plugins
   *  in place — the moment a host shows its title screen. Never rejects. */
  readonly ready: Promise<void> = new Promise((r) => {
    this.readyResolve = r
  })
  // ---- built-in screens (batch G inc 3): config, strings, persistence ----
  /** `[title]` — mutable so a host can adjust before `showTitle()`. */
  readonly titleConfig: TitleConfig = {}
  /** `[ending.<id>]` by id. */
  readonly endingConfig: Record<string, EndingConfig> = {}
  /** When the autosave is written (`[saves] autosave`). */
  autosave: 'label' | 'line' | false = 'label'
  /** Chrome string overrides by language (`messages` option / `[strings]`). */
  readonly messages: Record<string, Record<string, string>> = {}
  private screensOn: { title: boolean; ending: boolean; menu: boolean; loading: boolean } = { title: true, ending: true, menu: true, loading: true }
  private customStore: SaveStore | undefined
  /** `[menu]`, `[saves]`, `[settings]`. */
  readonly menuConfig: MenuConfig = {}
  readonly savesConfig: SavesConfig = {}
  readonly settingsConfig: SettingsConfig = {}
  /** `[keys]` — bindings that override {@link KEYS_DEFAULT} (`false` unbinds). */
  readonly keysConfig: KeysConfig = {}
  /** The in-game system menu (undefined when `screens.menu` / `[menu] enabled` is off). */
  private menu: SystemMenu | undefined
  // ---- auto / skip (inc 4): engine mechanisms the menu only toggles ----
  private _auto = false
  private _skip = false
  private skipHeld = false
  private _autoDelay = 1.5
  private _skipMode: 'read' | 'all' = 'read'
  private _dialogOpacity = 1
  private _uiScale = 1
  /** `label:offset` addresses of lines the player has seen (skip mode's "read"). */
  private readSet = new Set<string>()
  private readDirty = false
  /** The read key of the line parked on now (`\u0000`-prefixed while unread). */
  private parkedReadKey = ''
  /** Replay segments passed in normal play (the gallery's unlock set). */
  private unlocks = new Set<string>()
  private persistTimer: number | undefined
  /** Whether a player setting changed since the last store write (the read set
   *  and the persistent variables have their own flags: each writes only itself). */
  private settingsDirty = false
  private persistedLoaded = false
  private loadingSettings = false
  // ---- plugin platform v3 (inc 4b): settings, actor fields, chrome contributions ----
  /** The author's plugin settings (`[plugins.<id>]` / the `pluginConfig` option), by plugin id. */
  private authorPluginConfig: Record<string, Record<string, unknown>> = {}
  /** The players' (`scope: player`) values, persisted per work. */
  private playerPluginConfig: Record<string, Record<string, unknown>> = {}
  private pluginConfigListeners = new Map<string, Set<(key: string, value: unknown) => void>>()
  private titleExtras = new Map<string, ScreenButton>()
  private hudEls = new Set<HTMLElement>()
  private pluginScreen: { id: string; el: HTMLElement } | null = null
  /** Listeners fired after a language switch, so the menu re-localizes its chrome. */
  private langListeners = new Set<(lang: string) => void>()
  /** What's parked on screen right now (an awaited dialogue line or a choices
   *  prompt), so a language switch can re-render it in place without disturbing
   *  playback. Cleared once the player advances past it. */
  private shown: { kind: 'dialogue'; node: DialogueNode; paged?: boolean } | { kind: 'choices'; node: ChoicesNode; prompt: ChoicePrompt } | null = null
  private keyHandler = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return
    const hit = (a: KeyAction): boolean => matchKey(bindingOf(this.keysConfig, a), e)
    if (hit('menu')) {
      if (this.pluginScreen) this.closePluginScreen()
      else this.menu?.onEscape()
      return
    }
    if (hit('skipHold')) {
      if (e.repeat) return
      this.skipHeld = true // hold Ctrl = skip while held (read text, or everything per skipMode)
      if (this.typing) this.skipTyping = true
      else if (this.advanceResolve && this.skipActive(this.parkedReadKey)) this.tapAdvance()
      return
    }
    if (!this.running || this.menu?.isOpen()) return
    if (hit('advance')) {
      e.preventDefault()
      this.tap()
      return
    }
    // The rest are the system menu's actions: bound only while the menu exists
    // (a host that draws its own chrome binds its own keys) and while playing.
    const menu = this.menu
    if (!menu || this.session !== 'playing') return
    const actions: [KeyAction, () => void][] = [
      ['auto', () => menu.toggleMode('auto')],
      ['skip', () => menu.toggleMode('skip')],
      ['quicksave', () => menu.quickSave()],
      ['quickload', () => menu.quickLoad()],
      ['backlog', () => menu.open('backlog')],
      ['save', () => menu.open('saves')],
      ['load', () => menu.open('load')],
      ['settings', () => menu.open('settings')],
      ['fullscreen', () => void this.setFullscreen(!this.isFullscreen())],
    ]
    for (const [action, run] of actions) {
      if (!hit(action)) continue
      e.preventDefault() // F5 must not reload the page, Tab must not move focus
      run()
      return
    }
  }
  private keyUpHandler = (e: KeyboardEvent) => {
    if (matchKey(bindingOf(this.keysConfig, 'skipHold'), e)) this.skipHeld = false
  }

  private autoUse: string[]

  constructor(opts: EngineOptions) {
    this.stage = new DomRenderer(opts.container)
    this.stage.onAssetError = (what, url) => this.report({ phase: 'exec', message: `${what}: image failed to load — ${url}` }, true)
    this.stage.onObstructed = (id, by) =>
      this.report({ phase: 'exec', message: `hotspot "${id}": "${by}" covers its centre — a click there never reaches it` }, true)
    this._textSpeed = opts.textSpeed ?? 40 // direct: no hooks before the plugin host exists
    this.baseUrl = opts.baseUrl ?? document.baseURI
    this.onEndCb = opts.onEnd
    this.onReadyCb = opts.onReady
    this.onSessionCb = opts.onSessionChange
    this.saveKey = opts.saveKey
    this.buildInfo = opts.buildInfo
    this.onErrorCb = opts.onError
    this.strict = opts.strict ?? false
    this.pluginFailureLimit = Math.max(1, Math.floor(opts.pluginFailureLimit ?? 3))
    this.autoUse = [...(opts.use ?? [])]
    Object.assign(this.alias, opts.alias)
    Object.assign(this.actors, opts.actors)
    this.catalogs = opts.catalogs ?? {}
    this.defaultLang = opts.defaultLang ?? 'en'
    this.lang = opts.lang ?? this.defaultLang
    this.languages = opts.languages ?? [this.lang]
    Object.assign(this.macros, opts.macros)
    Object.assign(this.assets, opts.assets)
    mergeDefaults(this.defaults, opts.defaults)

    this.audio = new AudioBus({
      volumes: () => ({ bgm: this.bgmVolume, ambience: this.ambienceVolume, se: this.seVolume, voice: this.voiceVolume }),
      running: () => this.running,
    })
    this.residency = new ChunkResidency({
      nodes: () => this.nodes,
      labels: () => this.labels,
      catalogs: () => this.catalogs,
      lang: () => this.lang,
      generation: () => this.generation,
      destroyed: () => this.destroyed,
      pos: () => this.pos,
      resumeIndex: () => this.resumeIndex,
      onParsed: (nodes, diagnostics, chunk) => {
        this.reportParse(diagnostics, chunk)
        this.scanReplayDefs(nodes) // entry chunk carries the [replaydef] preamble
      },
      report: (info, once) => this.report(info, once),
    })
    this.residency.attach(opts.manifest, opts.loader, opts.maxResidentChunks)
    this.loops = new LoopRuntime({
      applyRecordable: (objId, chId, value) => this.applyRecordable(objId, chId, value),
      recordableMode: (objId, chId) => this.recordableMode(objId, chId),
      readChannel: (objId, chId) => this.readChannel(objId, chId),
      generation: () => this.generation,
      destroyed: () => this.destroyed,
    })

    for (const [name, fn] of Object.entries(builtins)) this.builtinCommands.set(name, fn)
    this.host = new PluginHost(this, { grant: opts.grant, failureLimit: this.pluginFailureLimit, loader: opts.pluginLoader }, this.missingPlugins, this.isolatedPlugins)
    // After the plugin host exists: an unknown token is a diagnostic, and diagnostics reach hooks.
    if (opts.theme) this.setTheme(opts.theme)
    if (opts.title) Object.assign(this.titleConfig, opts.title)
    for (const [id, e] of Object.entries(opts.endings ?? {})) this.endingConfig[id] = { ...e }
    if (opts.saves?.autosave !== undefined) this.autosave = opts.saves.autosave
    for (const [lang, table] of Object.entries(opts.messages ?? {})) this.messages[lang] = { ...table }
    if (opts.screens === false) this.screensOn = { title: false, ending: false, menu: false, loading: false }
    else if (opts.screens) this.screensOn = { title: opts.screens.title ?? true, ending: opts.screens.ending ?? true, menu: opts.screens.menu ?? true, loading: opts.screens.loading ?? true }
    this.customStore = opts.saveStore
    if (opts.saves) Object.assign(this.savesConfig, opts.saves)
    if (opts.menu) Object.assign(this.menuConfig, opts.menu)
    if (opts.settings) {
      Object.assign(this.settingsConfig, opts.settings)
      if (typeof opts.settings.autoDelay === 'number') this._autoDelay = opts.settings.autoDelay
      if (opts.settings.skipMode) this._skipMode = opts.settings.skipMode
    }
    if (opts.keys) Object.assign(this.keysConfig, opts.keys)
    this.onSegmentSeen((id) => {
      if (this.unlocks.has(id)) return
      this.unlocks.add(id)
      void this.saveStore.set(UNLOCKS_KEY, [...this.unlocks]).catch(() => {})
    })
    if (this.screensOn.menu && this.menuConfig.enabled !== false) {
      this.menu = new SystemMenu(this)
      this.menu.mount()
    }
    for (const [id, table] of Object.entries(opts.pluginConfig ?? {})) this.setPluginConfig(id, table)
    this.normalizeActors()
    for (const k of BUILTIN_KINDS) this.host.seedKind(k)
    // The engine ships no plugins of its own: the host hands it a registry (the
    // first-party set from @nilvn/plugins, or its own) plus their manifests. A
    // first-party id (`app.nilvn.textfx`) also answers to its short name.
    for (const p of opts.registry ?? []) this.host.register(p)
    for (const m of opts.manifests ?? []) this.host.attachManifest(m)
    for (const p of opts.plugins ?? []) this.install(p)

    this.stage.root.addEventListener('click', () => this.tap())
    this.stage.objectClick = (objId, onclick) => void this.runInline(onclick, objId)
    window.addEventListener('keydown', this.keyHandler)
    window.addEventListener('keyup', this.keyUpHandler)
  }

  /** The stable surface the editor decorates / hit-tests against, hiding the
   *  stage's DOM internals (see {@link EditStage}). */
  get editStage(): EditStage {
    return this.stage
  }

  /** True while a real per-line voice clip is playing; voicefx reads it to mute
   *  the synthesized typing blip for that line. */
  get voicePlaying(): boolean {
    return this.audio.voicePlaying
  }

  /** Chunked-play manifest, when a package / manifest+loader was supplied. */
  private get manifest(): ChunkManifest | undefined {
    return this.residency.manifest
  }

  private get loader(): ContentLoader | undefined {
    return this.residency.loader
  }

  // ---- script & config loading ----

  /** Load a TOML config file; assets and the entry script resolve relative to it */
  async loadConfig(url: string): Promise<void> {
    const abs = this.resolve(url)
    this.baseUrl = abs.slice(0, abs.lastIndexOf('/') + 1)
    applyConfig(this, await fetchConfig(abs))
  }

  /** Load content — the one entry. A
   *  `.nvn` URL fetches that script (the classic path; assets resolve relative to
   *  its directory). Anything else is a script package: a package directory URL
   *  (or its nilvn.json), zip bytes / a Blob, or an already-opened ScriptPackage.
   *  Rejects only for what a host must handle itself — an unreachable URL or a
   *  file that is not a package this engine plays (PackageFormatError); content
   *  problems inside a package surface as diagnostics during play. */
  async load(source: PackageSource): Promise<void> {
    if (typeof source === 'string' && /\.nvn(?:[?#].*)?$/i.test(source)) return this.loadScript(source)
    await this.loadPackage(await openPackage(source))
  }

  /** Fetch and parse a `.nvn` script; assets in it resolve relative to its directory. */
  async loadScript(url: string): Promise<void> {
    const abs = this.resolve(url)
    this.baseUrl = abs.slice(0, abs.lastIndexOf('/') + 1)
    const text = await this.fetchScriptText(abs, url)
    this.loadSource(await this.withIncludes(text, abs))
  }

  /** Play several `.nvn` files in order as chunks (`[game] scripts`): labels
   *  are global — a jump or call reaches any file, and a file's stem names its
   *  first line — the files fall through in list order, and a save's address
   *  names the file's chunk. A label defined in two files is reported (the
   *  first wins). `[include]` lines are spliced in first. Assets and includes
   *  resolve against the first file's directory (`baseUrl`). */
  async loadScripts(urls: string[]): Promise<void> {
    if (!urls.length) throw new Error('loadScripts() needs at least one file')
    // baseUrl stays where loadConfig() put it: assets and aliases resolve from the
    // config file's directory whatever folder the script files live in (an
    // [include] resolves relative to the including file separately).
    const files: ScriptFile[] = await Promise.all(
      urls.map(async (u) => {
        const abs = this.resolve(u)
        return { id: scriptId(u), url: abs, body: await this.withIncludes(await this.fetchScriptText(abs, u), abs) }
      }),
    )
    if (this.destroyed) return
    const ids = new Set<string>()
    for (const f of files) {
      if (ids.has(f.id)) this.report({ phase: 'load', message: `two script files are both named "${f.id}" — give them different names` })
      ids.add(f.id)
    }
    const { manifest, duplicates } = buildFileManifest(files, this.defaultLang)
    for (const d of duplicates) this.report({ phase: 'load', message: `label "${d.label}" is defined in both "${d.first}" and "${d.second}" — the first wins`, chunk: d.second })
    this.nodes = []
    this.labels = {}
    this.residency.reset()
    this.residency.attach(manifest, new FileScriptLoader(files, (ref) => this.resolve(ref)))
    this.warmed = false
  }

  private async fetchScriptText(abs: string, shown: string): Promise<string> {
    const res = await fetch(abs)
    if (!res.ok) throw new Error(`Failed to load script ${shown}: ${res.status}`)
    return res.text()
  }

  /** Splice `[include path]` lines into a script file's text. */
  private withIncludes(text: string, fileUrl: string): Promise<string> {
    return expandIncludes(text, fileUrl, {
      fetchText: async (url) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      },
      resolve: (path, from) => (path.startsWith('@') ? this.resolve(path) : new URL(path, from).href),
      report: (message, error) => this.report({ phase: 'load', message, error }),
    })
  }

  /** Adopt an opened package: its actors / languages / text speed / save key /
   *  enabled plugins, then wire chunked play to its loader, warm every language's
   *  always-on `base` text slice, and fill the by-ref asset table the synchronous
   *  `resolve()` reads. Replaces any script loaded before; call it on a fresh
   *  engine (or one that has finished) before `start()`. Never rejects over
   *  content: a base slice or asset that fails to resolve is a `load` diagnostic. */
  async loadPackage(pkg: ScriptPackage): Promise<void> {
    const m = pkg.manifest
    // A package replaces whatever was resident.
    this.nodes = []
    this.labels = {}
    this.warmed = false
    this.residency.reset()
    this.residency.attach(m.chunks, pkg.loader)
    Object.assign(this.actors, m.actors)
    this.defaultLang = m.chunks.defaultLang || m.lang
    this.lang = m.lang
    this.languages = m.languages.length ? [...m.languages] : [m.lang]
    if (Number.isFinite(m.textSpeed)) this.textSpeed = m.textSpeed
    this.saveKey = m.saveKey
    this.buildInfo = m.engine
    if (m.title) this.config = { ...this.config, game: { ...this.config.game, title: m.title } } // the title page's heading
    this.queueUse(m.plugins.map((p) => p.id))
    // The always-warm `base` slice per switchable language (actor names on line
    // one); scene slices stream with their chunks.
    await Promise.all(
      this.languages.map((lang) =>
        this.residency.ensureLocale('base', lang).catch((err: unknown) => {
          this.report({ phase: 'load', message: `base text (${lang}) failed to load: ${errMsg(err)}`, error: err })
        }),
      ),
    )
    if (this.destroyed) return
    // By-ref asset table: the stage verbs resolve synchronously through
    // `this.assets`, so every ref the package indexes is resolved up front (a
    // URL join for hosted packages; a blob URL for in-memory zips).
    await Promise.all(
      Object.keys(m.chunks.assets).map(async (ref) => {
        try {
          this.assets[ref] = await pkg.loader.assetUrl(ref)
        } catch (err) {
          this.report({ phase: 'load', message: `asset "${ref}" could not be resolved: ${errMsg(err)}`, error: err }, true)
        }
      }),
    )
  }

  loadSource(source: string): void {
    const parsed = parseScript(source)
    this.warmed = false
    this.nodes = parsed.nodes
    this.labels = parsed.labels
    this.reportParse(parsed.diagnostics)
    this.scanReplayDefs(parsed.nodes)
  }

  // ---- diagnostics ----

  /** Record and surface a content problem — the ONLY way the engine reacts to bad
   *  content (it never throws to the host). Appends to {@link diagnostics}, logs
   *  (strict: `console.error` every time; lenient: once per distinct line, as a
   *  warning unless an exception is attached), then notifies the `onError` plugin
   *  hooks and the host's `EngineOptions.onError`. `once` collapses repeats of the
   *  same (phase, line, message) — unknown-command style noise — into one entry. */
  report(info: EngineDiagnostic, once = false): void {
    const key = `${info.phase}:${info.line ?? ''}:${info.message}`
    if (once) {
      if (this.warned.has(key)) return
      this.warned.add(key)
    }
    this.diagnostics.push(info)
    const over = this.diagnostics.length - Engine.DIAGNOSTICS_CAP
    if (over > 0) this.diagnostics.splice(0, over)
    const where = info.line !== undefined ? ` (line ${info.line})` : ''
    const who = info.plugin ? ` ${info.plugin}` : info.chunk ? ` chunk "${info.chunk}"` : ''
    const tag = `[nilvn] ${info.phase}${who}: ${info.message}${where}`
    if (this.strict || !this.logged.has(tag)) {
      this.logged.add(tag)
      if (info.error !== undefined) console.error(tag, info.error)
      else if (this.strict) console.error(tag)
      else console.warn(tag)
    }
    for (const { fn, ctx } of this.host.listeners('onError')) {
      try {
        fn(info, ctx)
      } catch (err) {
        console.error('[nilvn] onError hook failed:', err)
      }
    }
    try {
      this.onErrorCb?.(info)
    } catch (err) {
      console.error('[nilvn] onError failed:', err)
    }
  }

  /** Surface a parse's skipped lines, one `parse` diagnostic each. */
  private reportParse(diags: { line: number; message: string }[], chunk?: string): void {
    for (const d of diags) this.report({ phase: 'parse', message: d.message, line: d.line, chunk })
  }

  /** Dispatch one hook to every active listener with its owner's context,
   *  isolating each: a throwing hook is reported against its plugin and never
   *  aborts the line / command that fired it. */
  private fire<K extends Exclude<keyof EngineHooks, 'onError'>>(name: K, ...args: HookArgs<K>): void {
    for (const { fn, ctx, owner } of this.host.listeners(name)) {
      try {
        ;(fn as (...a: unknown[]) => void)(...args, ctx)
      } catch (err) {
        this.report({ phase: 'plugin', plugin: owner, message: `${name} hook failed: ${errMsg(err)}`, error: err })
      }
    }
  }

  // ---- A–B replay segments (Project.replays) ----

  /** Replay-segment declarations from the `[replaydef]` preamble, registered at
   *  parse time. `title` is the raw wire token — possibly a keepKeys `@key` the
   *  gallery resolves at render. */
  get replays(): { id: string; title: string; label: string }[] {
    return this.replay.replays
  }

  /** Register the `[replaydef]` declarations found in a parsed script/chunk, at
   *  PARSE time (not execution). The scan serves the abreplay plugin's handlers:
   *  without them installed the unlock signal can never fire. */
  private scanReplayDefs(nodes: ScriptNode[]): void {
    this.replay.scan(nodes, this.host.hasCommand('replaydef'))
  }

  /** The segment id currently playing as an isolated replay, or null. */
  isReplaying(): string | null {
    return this.replay.segment
  }

  /** Subscribe to "normal play passed a segment's end marker" — the unlock
   *  signal a persistence layer (the menu plugin) listens for. */
  onSegmentSeen(fn: (segId: string) => void): () => void {
    return this.replay.onSegmentSeen(fn)
  }

  /** @internal `[replayend]` in normal play — fire the unlock signal. */
  fireSegmentSeen(segId: string): void {
    this.replay.fireSegmentSeen(segId)
  }

  /** @internal `[replayend]` for the segment being replayed — the replay is over.
   *  Whoever started it (the menu stashes the interrupted session) takes over via
   *  `onReplayEnd`; with no orchestrator the run simply finishes. */
  endReplay(): void {
    this.replay.segment = null
    const cb = this.onReplayEnd
    if (cb) cb()
    else if (!this.menu?.handleReplayEnd()) this.finish()
  }

  /** Play one authored segment as an isolated replay: a clean-slate session
   *  (fresh vars, blank stage, silence) starting at the segment's start label.
   *  The segment's own commands establish its scene. Returns false for an
   *  unknown segment id. Ends via its `[replayend]` marker → `endReplay`. */
  async playReplay(segId: string): Promise<boolean> {
    const def = this.replay.find(segId)
    if (!def) return false
    this.generation++
    this.loops.cancelRafAnims()
    this.loops.cancelLoops()
    this.vars = {}
    this.skipTyping = true
    this.unblock()
    this.audio.stopAllTracks(0)
    this.audio.stopVoice()
    this.resetBacklog()
    await this.stage.restore({ chars: [], text: '', dialog: false })
    this.fireTheme() // the script theme layer was reset with the stage
    // Chunked play: make the chunk defining the start label resident first.
    try {
      await this.residency.ensureLoaded(def.label)
    } catch (err) {
      this.report({ phase: 'load', chunk: this.manifest?.labelIndex[def.label], message: `could not load replay "${segId}": ${errMsg(err)}`, error: err })
      return false
    }
    const pos = this.labels[def.label]
    if (pos === undefined) {
      this.report({ phase: 'jump', message: `replay "${segId}" starts at unknown label "${def.label}"` })
      return false
    }
    this.replay.segment = segId
    void this.runLoop(pos) // sets running + bumps generation itself
    return true
  }

  // ---- localization ----

  /** Resolve a catalog key in the current language, falling back to the default
   *  language, then to an empty string. */
  resolveText(key: string): string {
    return this.catalogs[this.lang]?.[key] ?? this.catalogs[this.defaultLang]?.[key] ?? ''
  }

  /** Display name for a speaker: the localized name (when the actor carries a
   *  nameKey that resolves), else the literal `name`, else the raw id. */
  private actorName(actor: ActorDef | undefined, speaker: string | undefined): string | undefined {
    if (!speaker) return undefined
    const fromKey = actor?.nameKey ? this.resolveText(actor.nameKey) : ''
    return this.fill(fromKey || actor?.name || speaker)
  }

  /** Fill `{$var}` / `{@key}` placeholders in a string with the current values
   *  (what dialogue, choices, actor names and config strings go through). */
  fill(text: string, quiet = false): string {
    return interpolateText(text, quiet ? this.quietTextHost : this.textHost)
  }

  /** What a line shows now: key-backed text resolved in the current language,
   *  placeholders filled. */
  private displaySegments(segments: Segment[], textKey?: string): Segment[] {
    return interpolateSegments(textKey ? parseSegments(this.resolveText(textKey)) : segments, this.textHost)
  }

  /** A choice's display text in the current language. */
  private choiceText(item: ChoiceItem): string {
    return item.textKey ? this.resolveText(item.textKey) : item.text
  }

  /** Switch content + chrome language and re-render whatever is parked on screen,
   *  leaving playback state (playhead, variables, stage) untouched. Ignores a
   *  language that ships no catalog (other than the default). Async because
   *  in chunked play the resident chunks' text slices for the NEW language
   *  may not be loaded yet — chrome + already-resident keys switch synchronously
   *  (exactly the old behavior), then the missing slices are fetched and the
   *  parked line repainted once they land. Non-chunked play resolves at once. */
  async setLanguage(lang: string): Promise<void> {
    if (lang === this.lang) return
    if (lang !== this.defaultLang && !this.catalogs[lang]) return
    this.lang = lang
    this.repaintShown()
    this.ui.refresh()
    for (const fn of this.langListeners) fn(lang)
    this.settingChanged('lang', lang)
    void this.repaintScreen()
    if (!this.residency.active) return
    await this.residency.ensureResidentLocales(lang)
    // Dropped if the session moved past this switch during the fetch (another
    // switch, a destroy) — the newer state owns the screen.
    if (this.destroyed || this.lang !== lang) return
    this.repaintShown()
  }

  /** Subscribe to language switches (the in-game menu re-localizes its chrome
   *  this way). Returns an unsubscribe function. */
  onLanguageChange(fn: (lang: string) => void): () => void {
    this.langListeners.add(fn)
    return () => this.langListeners.delete(fn)
  }

  /** Re-render the parked dialogue line / choices prompt in place — after a
   *  language switch (key-backed text re-resolves) or a plugin toggle (text
   *  effects re-apply from the now-active set). Playback state is untouched.
   *  @internal */
  repaintShown(): void {
    const s = this.shown
    if (!s) return
    const onSpan = (span: TextSpan, effect: string | undefined): void => {
      if (effect) this.applyTextEffect(effect, span)
    }
    if (s.kind === 'dialogue') {
      const node = s.node
      const actor = node.speaker ? this.actors[node.speaker] : undefined
      this.stage.setName(this.actorName(actor, node.speaker), actor?.color, actor?.textColor)
      const segments = this.displaySegments(node.segments, node.textKey)
      if (s.paged && this.stage.repaintLine(segments, onSpan)) return
      this.stage.setLine(segments, onSpan)
    } else {
      const visible = s.node.items.filter((it) => !it.cond || truthy(evalExpr(it.cond, this.scope())))
      visible.forEach((item, i) => s.prompt.relabel(i, this.displaySegments(parseSegments(this.choiceText(item))), onSpan))
    }
  }

  /** Resolve a resource path: alias prefixes, then the asset table, then base URL */
  resolve(path: string): string {
    for (const [key, value] of Object.entries(this.alias)) {
      if (path === key) {
        path = value
        break
      }
      if (path.startsWith(key + '/')) {
        path = value + path.slice(key.length)
        break
      }
    }
    const inline = this.assets[path] ?? this.assets[path.replace(/^\.\//, '')]
    if (inline) return inline
    // An `@prefix` no `[path]` entry and no `[alias]` declares would otherwise
    // travel on as a literal URL segment and fail far from its cause — a 404
    // image, or an audio element reporting MediaError into the console, neither
    // of which is a diagnostic. Name the prefix here, where it is still visible.
    if (path.startsWith('@'))
      this.report({ phase: 'load', message: `unknown path alias "${path.split('/')[0]}" in "${path}" — no [path] entry or [alias] declares it` }, true)
    return new URL(path, this.baseUrl).href
  }

  // ---- plugins (plugin-host.ts) ----

  /** Install a host plugin now: register + activate. Every permission it declares
   *  is granted unless `EngineOptions.grant` says otherwise, and `setPlugins`
   *  never removes it (it is the host's own code, not part of the work's set). */
  install(plugin: EnginePlugin): void {
    const rec = this.host.register(plugin, { pinned: true })
    if (rec) this.host.activate(rec.id)
  }

  /** Register a plugin (and optionally its manifest) for `[use id]` / `enablePlugin`
   *  without activating it. */
  registerPlugin(plugin: EnginePlugin, manifest?: PluginManifest): void {
    this.host.register(plugin, { manifest })
  }

  /** Hot-plug "on": activate a registered plugin, or load one by `[use]` spelling
   *  (`…/plugin.json`, `./x.js`). Re-paints whatever is parked on screen so text
   *  effects / styles take effect at once. Resolves to whether it is active. */
  async enablePlugin(idOrUse: string): Promise<boolean> {
    await this.host.use([idOrUse], true)
    this.repaintShown()
    return this.host.isActive(idOrUse)
  }

  /** Hot-plug "off": deactivate a plugin, releasing everything it registered
   *  (commands, effects, kinds, hooks, styles, listeners, timers, layers). */
  disablePlugin(id: string): boolean {
    const ok = this.host.deactivate(id)
    if (ok) this.repaintShown()
    return ok
  }

  /** Hot reload: deactivate → (re-import a path plugin, cache-busted) → activate,
   *  carrying its save slice across; a failure rolls back to the previous module
   *  with a diagnostic. Resolves to whether the plugin is active afterwards. */
  async reloadPlugin(id: string): Promise<boolean> {
    const ok = await this.host.reload(id)
    this.repaintShown()
    return ok
  }

  /** Make exactly `ids` (plus plugins installed through `EngineOptions.plugins`)
   *  the active set — the editor's toggle path. */
  async setPlugins(ids: string[]): Promise<void> {
    await this.host.setEnabled(ids)
    this.repaintShown()
  }

  /** Ids of the active plugins, in activation order. */
  get activePlugins(): readonly string[] {
    return this.host.activeIds()
  }

  /** Lifecycle state of a registered plugin (undefined = unknown id). */
  pluginState(id: string): PluginState | undefined {
    return this.host.state(id)
  }

  // ---- object kinds & effects ----

  /** Apply a named effect to a stage object. Resolves the effect, checks it is
   *  bound to the object's kind (`appliesToKinds`), builds the scoped object
   *  handle, and runs it with its OWNER plugin's context. Commands dispatch to
   *  one or more effects this way, so a single effect (e.g. `shake`) serves both
   *  `[shake]` and `[charfx … shake]` across whatever kinds it declares. No-op
   *  (warning) on an unknown effect or a kind mismatch; silent no-op when the
   *  target object is not on stage. */
  async applyEffect(name: string, objId: string, params: EffectParams): Promise<void> {
    const owned = this.host.effect(name)
    if (!owned) {
      this.warnOnce(`unknown effect "${name}" — missing a [use ...]?`)
      return
    }
    const kind = kindOf(objId)
    if (!owned.value.appliesToKinds.includes(kind)) {
      this.warnOnce(`effect "${name}" does not apply to "${kind}" objects`)
      return
    }
    if (!this.stage.hasObject(objId)) return
    const ctx = this.host.contextOf(owned.owner)
    if (!ctx) return // its owner was quarantined or removed meanwhile
    await owned.value.apply(new ObjectHandle(this.stage, objId, kind), params, ctx)
  }

  /** Look up a registered effect (the editor reads this in 2b). */
  getEffect(name: string): EffectDef | undefined {
    return this.host.effect(name)?.value
  }

  /** Look up a registered object kind (the editor reads this in 2b). */
  getKind(id: string): ObjectKind | undefined {
    return this.host.kind(id)
  }

  // ---- recording event-frames ----

  /** Resolve a recordable channel descriptor for an object id + channel id, via the
   *  object's kind. Undefined when the kind doesn't declare the channel. */
  private recordableProp(objId: string, chId: string): RecordableProp | undefined {
    return this.host.kind(kindOf(objId))?.recordable?.find((p) => p.id === chId)
  }

  /** The mode the player needs to decide interpolate vs. snap. */
  private recordableMode(objId: string, chId: string): 'continuous' | 'discrete' | undefined {
    return this.recordableProp(objId, chId)?.mode
  }

  /** Apply one channel value to a stage object through its recordable descriptor —
   *  the descriptor coerces the (possibly raw-string) value to its channel type.
   *  No-op when the object's kind doesn't declare the channel. */
  private applyRecordable(objId: string, chId: string, value: number | string): void {
    const prop = this.recordableProp(objId, chId)
    if (!prop) return
    prop.apply(new ObjectHandle(this.stage, objId, kindOf(objId)), value)
  }

  /** Public seam for the editor to write ANY recordable channel — continuous or
   *  discrete, numeric or string (face / band) — through one uniform path that the
   *  descriptor coerces. No-op for an unknown channel / absent object. */
  applyChannel(objId: string, chId: string, value: number | string): void {
    this.applyRecordable(objId, chId, value)
  }

  /** Read one recordable channel's current value (the discrete pose seed for the
   *  editor's value picker). Undefined when the channel isn't declared / readable. */
  readChannel(objId: string, chId: string): number | string | boolean | undefined {
    const prop = this.recordableProp(objId, chId)
    return prop?.read(new ObjectHandle(this.stage, objId, kindOf(objId)))
  }

  /** Play a recording event-frame to completion (blocking) — decoded tracks or
   *  the serializer's `kf` wire token. See LoopRuntime. */
  playFrames(durationSec: number, tracks: DecodedTrack[] | string): Promise<void> {
    return this.loops.playFrames(durationSec, typeof tracks === 'string' ? decodeTracks(tracks) : tracks)
  }

  /** Abort any in-flight preview event-frame (the editor's ▶ play) WITHOUT bumping the
   *  session generation or touching running loops. The frame editor calls this when it
   *  closes mid-preview so the engine clock stops posing the element to the last keyframe
   *  after the editor tears down (editor finding #5). */
  stopFrames(): void {
    this.loops.cancelRafAnims()
  }

  // ---- single-element loops — see LoopRuntime ----

  /** The defining data of every loop running now (entry + body, no phase — §4). */
  runningLoops(): SavedLoop[] {
    return this.loops.runningLoops()
  }

  /** Begin (or replace) a single-element loop on an object (non-blocking).
   *  `entry` / `body` may be the wire forms (`ch=v,…` / `t:ch=v;…`). */
  startLoop(objId: string, durationSec: number, entry: Record<string, string> | string, body: DecodedFrame[] | string, intoEase?: string, bridge = true): void {
    this.loops.startLoop(objId, durationSec, typeof entry === 'string' ? decodeChannelSet(entry) : entry, typeof body === 'string' ? decodeFrames(body) : body, intoEase, bridge)
  }

  /** Stop the loop running on `objId` and settle the object to its `exit` pose
   *  (a channel set or its `ch=v,…` wire form). */
  stopLoop(objId: string, exit: Record<string, string> | string, outEase?: string): void {
    this.loops.stopLoop(objId, typeof exit === 'string' ? decodeChannelSet(exit) : exit, outEase)
  }

  /** Queue plugins for auto-loading at start() — same entries as [use ...] */
  /** `[use menu]` / `app.nilvn.menu` (the pre-0.15 menu plugin): the menu is built
   *  in now — dropped with one diagnostic so older packages keep playing. */
  private dropBuiltinMenu(names: string[]): string[] {
    const rest = names.filter((n) => n !== 'menu' && n !== 'app.nilvn.menu')
    if (rest.length !== names.length) this.report({ phase: 'load', message: '[use menu] ignored — the in-game menu is built into the engine (0.15); remove it from [plugins] use / the package' }, true)
    return rest
  }

  queueUse(names: string[]): void {
    names = this.dropBuiltinMenu(names)
    this.autoUse.push(...names)
  }

  /** Resolve [use ...] entries: a registered id / short name activates; a
   *  `…/plugin.json` loads a plugin package; a module path imports a bare module.
   *  A name that resolves to nothing (unknown, fails to load, isn't a plugin) is
   *  registered in {@link missingPlugins} with a diagnostic and play continues —
   *  its commands / effects / kinds simply degrade to no-ops. */
  async usePlugins(names: string[]): Promise<void> {
    names = this.dropBuiltinMenu(names)
    await this.host.use(names)
  }

  // ---- characters ----

  /**
   * Show a character or update its face/position.
   * Sprite URL comes from src= or the actor's `sprites` template.
   */
  async showActor(
    id: string,
    face?: string,
    opts: { at?: string; fade?: number; src?: string; y?: number; scale?: number; rotation?: number; layers?: Record<string, string> } = {},
    onlyIfVisible = false,
  ): Promise<void> {
    if (onlyIfVisible && !this.stage.hasChar(id)) return
    const actor = this.actors[id]
    if (actor?.layers && !opts.src) {
      // Layered sprite: this command's values over what is on stage (or the
      // defaults), every layer rebuilt from its template.
      const values: Record<string, string> = { ...this.stage.charLayers(id) }
      for (const [k, v] of Object.entries(opts.layers ?? {})) if (k in actor.layers) values[k] = v
      if (face !== undefined) values.face = face
      else if (values.face === undefined && this.stage.charFace(id)) values.face = this.stage.charFace(id)!
      const built = this.buildLayers(id, actor, values)
      await this.stage.showChar(id, '', { at: opts.at, fade: opts.fade, face: built.face, ...built, y: opts.y, scale: opts.scale, rotation: opts.rotation })
      return
    }
    const tmpl = actor?.sprites
    const resolvedFace = face ?? this.stage.charFace(id) ?? actor?.defaultFace ?? 'default'
    let src = opts.src
    if (!src) {
      if (!actor?.sprites) {
        if (onlyIfVisible) return
        throw new Error(`No sprite for "${id}" — declare [actor ${id} sprites=path/{face}.png] or pass src=`)
      }
      src = actor.sprites.replaceAll('{face}', resolvedFace)
    }
    await this.stage.showChar(id, this.resolve(src), {
      at: opts.at,
      fade: opts.fade,
      face: resolvedFace,
      // The unresolved script path, so a save stores the ref (not a resolved / data
      // URL) and a load re-resolves it through this engine.
      ref: src,
      // Let the renderer recompute the URL for a later `face` channel change. Built
      // from the actor's `{face}` template so alias / asset-table resolution stays in
      // the engine; absent when the character was shown by raw `src=` (no template).
      faceUrl: tmpl ? (f) => this.resolve(tmpl.replaceAll('{face}', f)) : undefined,
      y: opts.y,
      scale: opts.scale,
      rotation: opts.rotation,
    })
  }

  /** A layered actor's images for `values` (a layer without a value takes its
   *  default; an optional one without either is left out). Throws when a
   *  required layer has nothing to show. */
  private buildLayers(id: string, actor: ActorDef, values: Record<string, string>): { layers: CharLayer[]; canvas?: [number, number]; layerUrl: CharOptions['layerUrl']; face?: string } {
    const defs = actor.layers ?? {}
    const layers: CharLayer[] = []
    for (const [name, def] of Object.entries(defs)) {
      const value = values[name] ?? def.default ?? (name === 'face' ? actor.defaultFace : undefined)
      if (value === undefined || value === '' || value === 'none') {
        if (def.optional) continue
        throw new Error(`layer "${name}" of "${id}" has no value — give it a default in [actors.${id}.layers] or pass ${name}=`)
      }
      const ref = def.src.replaceAll(`{${name}}`, value)
      layers.push({ name, value, url: this.resolve(ref), ref, offset: def.offset })
    }
    return {
      layers,
      canvas: actor.canvas,
      layerUrl: (layer, v) => {
        const d = defs[layer]
        return d ? this.resolve(d.src.replaceAll(`{${layer}}`, v)) : undefined
      },
      face: layers.find((l) => l.name === 'face')?.value,
    }
  }

  // ---- scene transitions ----

  /** Arm a scene transition: the picture freezes now; the scene changes that
   *  follow happen underneath; the next dialogue line / choices prompt (or
   *  `commitTransition`) reveals the result with `kind`. */
  armTransition(kind: TransitionKind, opts: SceneTransitionOpts = {}): void {
    this.stage.beginTransition()
    this.pendingTrans = { kind, opts }
  }

  /** Reveal the scene under an armed transition; a no-op without one. */
  async commitTransition(): Promise<void> {
    const p = this.pendingTrans
    if (!p) return
    this.pendingTrans = null
    await this.stage.endTransition(p.kind, p.opts)
  }

  // ---- events: script commands from the UI (panel buttons, hotspots, sprites) ----

  /** Run script commands (one per line, with or without brackets) in the
   *  current session — what a `[ui.<id>]` button's `onclick`, a `[hotspot]`
   *  and a clickable sprite do. Only while a story runs; a bad line reports.
   *  When the commands move the playhead (`[jump]`, `[call]`), the parked
   *  line or prompt is released so play goes on from there. */
  async runInline(text: string, source = 'ui'): Promise<void> {
    if (!this.running || this.destroyed) return
    const gen = this.generation
    const before = this.pos
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith('//'))
    for (const line of lines) {
      if (gen !== this.generation) return
      const inner = line.startsWith('[') && line.endsWith(']') ? line.slice(1, -1).trim() : line
      let node: ScriptNode
      try {
        node = parseTag(inner, 0)
      } catch (err) {
        this.report({ phase: 'exec', message: `${source}: ${errMsg(err)}`, error: err }, true)
        continue
      }
      if (node.type !== 'command') {
        this.report({ phase: 'exec', message: `${source}: only commands can run from a click ("${line}")` }, true)
        continue
      }
      await this.execCommand(node)
    }
    if (gen === this.generation && this.pos !== before) this.unblock()
  }

  // ---- audio (see AudioBus) ----
  // Multi-track model: any number of named looping
  // tracks play side by side, each on a bus — 'music' rides the music master,
  // everything else the ambience master. `[bgm]`/`[stopbgm]` keep their classic
  // single-slot semantics on the 'music' track; `track=` addresses the others.

  /** Start (or replace) a named looping track. */
  playTrack(track: string, url: string, opts: TrackOptions = {}): void {
    this.audio.playTrack(track, url, opts)
  }

  /** Classic single-slot BGM — the 'music' track. */
  playBgm(url: string, opts: TrackOptions = {}): void {
    this.audio.playTrack(Engine.MUSIC_TRACK, url, opts)
  }

  /** Stop one named track, optionally fading it out. */
  stopTrack(track: string, fadeSec = 0): void {
    this.audio.stopTrack(track, fadeSec)
  }

  /** Stop every looping track (load / restart / destroy / `[stopbgm track=all]`). */
  stopAllTracks(fadeSec = 0): void {
    this.audio.stopAllTracks(fadeSec)
  }

  /** Re-apply the master volumes to anything currently audible — call after the
   *  user changes a channel volume (the in-game menu does). */
  applyVolumes(): void {
    this.audio.applyVolumes()
  }

  /** Stop the classic BGM slot (the 'music' track). */
  stopBgm(fadeSec = 0): void {
    this.audio.stopTrack(Engine.MUSIC_TRACK, fadeSec)
  }

  /** Play a one-shot sound effect, tracked so destroy() can stop it mid-clip. */
  playSe(url: string, volume = 1): void {
    this.audio.playSe(url, volume)
  }

  /** Queue a per-line voice clip for the next dialogue (see the [voice] builtin).
   *  `ref` is the raw asset ref; it's resolved to a URL only when the line plays
   *  (and again, by ref, for backlog replay). */
  setPendingVoice(ref: string, offset: number): void {
    this.pendingVoice = { ref, offset: Number.isFinite(offset) ? offset : 0 }
  }

  // ---- backlog ----

  /** Append a played line to the session backlog, keeping only the most recent
   *  {@link Engine.BACKLOG_CAP} (a ring buffer via front-trim). `segments` are the
   *  displayed segments; their plain text is stored (inline effects / pauses
   *  stripped, `br` → newline) so the menu lists clean text. `offset` is the voice
   *  clip's leading-silence trim, kept so replay seeks exactly as live play. */
  private recordBacklog(speaker: string, segments: Segment[], voiceRef?: string, offset?: number, actor?: string): void {
    const text = segments.map((s) => (s.kind === 'text' ? s.text : s.kind === 'br' ? '\n' : '')).join('')
    this.backlog.push({ speaker, actor, text, voiceRef, offset: voiceRef ? offset : undefined, lang: this.lang })
    // Per-line autosave rides on the backlog entry so its preview is this line.
    if (this.autosave === 'line') void this.writeAutosave()
    const over = this.backlog.length - Engine.BACKLOG_CAP
    if (over > 0) this.backlog.splice(0, over)
  }

  /** Snapshot of the session backlog (oldest → newest) for the menu's backlog UI. A
   *  copy, so the caller can't mutate engine state. */
  getBacklog(): BacklogEntry[] {
    return this.backlog.slice()
  }

  /** Clear the backlog and stop any in-flight replay. Called on every session entry
   *  (start / restart / restoreState / destroy) — the backlog is play-session state,
   *  never carried across a load or a return to the start. */
  private resetBacklog(): void {
    this.backlog.length = 0
    this.audio.stopBacklog()
  }

  /** Re-play a backlogged line's voice by its raw ref, seeking past `offset` seconds
   *  of leading silence exactly as live play does. Resolves the ref FRESH each time —
   *  via the loader when chunked (so a released chunk's clip still resolves, and a
   *  future Tauri loader can re-mint a blob), else the static asset map. Captures the
   *  generation so a session reset (start/restart/restoreState/destroy) during the
   *  async resolve drops the stale clip — mirroring the engine's other post-await
   *  guards; stops any prior/concurrent replay so clips never overlap. */
  async replayVoice(ref: string, offset = 0): Promise<void> {
    if (!ref) return
    const gen = this.generation
    this.audio.stopBacklog() // stop the current replay immediately on click
    const url = this.loader ? await this.loader.assetUrl(ref) : this.resolve(ref)
    // Session moved on during the resolve (a load/restart/destroy bumped the
    // generation, or destroy ran) — drop this stale replay, don't play over the new
    // session. `destroyed` alone would miss restart/restoreState (they don't set it).
    if (this.destroyed || gen !== this.generation) return
    this.audio.playBacklog(url, offset)
  }

  // ---- execution ----

  // ---- session ----

  /** Where the session is (see `SessionState`). */
  get session(): SessionState {
    return this._session
  }

  /** The ending reached (`[ending id]`, or `default` for `[end]` / running off
   *  the end); undefined outside the `ending` state. */
  get ending(): string | undefined {
    return this._ending
  }

  /** Subscribe to session transitions; returns the unsubscribe. */
  onSessionChange(fn: (state: SessionState, prev: SessionState) => void): () => void {
    this.sessionListeners.add(fn)
    return () => this.sessionListeners.delete(fn)
  }

  private setSession(state: SessionState): void {
    const prev = this._session
    if (state === prev) return
    this._session = state
    if (state !== 'ending') this._ending = undefined
    for (const el of this.hudEls) el.style.display = state === 'playing' ? '' : 'none'
    this.ui.refresh()
    if (state !== 'playing' && this.pluginScreen) this.closePluginScreen()
    this.fire('onSessionChange', state, prev)
    for (const fn of this.sessionListeners) fn(state, prev)
    this.onSessionCb?.(state, prev)
  }

  /** Bring content and plugins into place without playing: the auto-loaded
   *  entry script, the entry chunk (chunked play), the queued `[use]` plugins.
   *  Resolves `ready` and fires `onReady` the first time it succeeds. `start()`
   *  calls it, so a host only needs it to put a title screen BEFORE play.
   *  Returns false when a content problem (reported) leaves nothing playable;
   *  still throws for the programming error of having loaded nothing at all. */
  async prepare(label?: string): Promise<boolean> {
    if (this.destroyed) return false
    if (!this.nodes.length && !this.manifest) {
      if (this.scripts.length) await this.loadScripts(this.scripts)
      else if (this.entry) await this.loadScript(this.entry)
    }
    if (this.destroyed) return false
    // Chunked play (lazy): make only the ENTRY chunk (the one defining the
    // start label, or the manifest entry) resident before the "no script" check —
    // further chunks load on demand as jumps / fall-through reach them. No-op
    // without a manifest+loader (non-chunked play already has its script loaded).
    if (this.manifest) {
      // An unknown start label falls back to the entry (reported below, once the
      // label lookup runs against whatever is resident).
      const target = label !== undefined && this.manifest.labelIndex[label] !== undefined ? label : this.manifest.entry.label
      try {
        await this.residency.ensureLoaded(target)
      } catch (err) {
        this.report({ phase: 'load', chunk: this.manifest.labelIndex[target], message: `could not load the opening scene: ${errMsg(err)}`, error: err })
        return false
      }
      if (this.destroyed) return false
    }
    if (!this.nodes.length) {
      // A package whose entry chunk holds no nodes is a content problem; a host that
      // never loaded anything is a programming error and still throws.
      if (this.manifest) {
        this.report({ phase: 'load', chunk: this.manifest.labelIndex[this.manifest.entry.label], message: 'the package has no playable script' })
        return false
      }
      throw new Error('No script loaded — call load(), loadSource() or loadConfig() first')
    }
    if (this.autoUse.length) {
      const names = this.autoUse
      this.autoUse = []
      await this.usePlugins(names)
      if (this.destroyed) return false
      // The load-time scan may have run before [use] plugins installed their
      // commands (loadSource precedes start); re-scan now that they have.
      // Idempotent per id, and still a no-op when abreplay stays uninstalled.
      this.scanReplayDefs(this.nodes)
    }
    if (!this.persistedLoaded) {
      this.persistedLoaded = true
      await this.loadPersisted()
      if (this.destroyed) return false
    }
    // Warm the opening assets once per loaded content, on the loading page.
    if (!this.warmed) {
      this.warmed = true
      const cfg = this.preloadConfig
      const refs = [...(cfg.assets ?? []), ...(cfg.auto ? this.autoPreloadRefs() : [])]
      if (refs.length) {
        await this.preload(refs)
        if (this.destroyed) return false
      }
    }
    if (!this.prepared) {
      this.prepared = true
      this.fire('onReady')
      this.onReadyCb?.()
      this.readyResolve()
    }
    return true
  }

  /** Show the title screen (or, before the screens land, just enter the `title`
   *  state): stops any run and clears the session — variables, stage, audio,
   *  backlog — so `start()` from here is a fresh game. `[title]` in a script
   *  calls this. */
  async showTitle(): Promise<void> {
    if (this.destroyed) return
    // Content and plugins first (a title item a plugin contributes, the config's
    // title music path): the same step start() takes. Nothing loadable = a host
    // that only wants the state; the page still shows.
    if (this.nodes.length || this.entry || this.scripts.length || this.manifest) {
      await this.prepare()
      if (this.destroyed) return
    }
    this.generation++
    this.loops.cancelRafAnims()
    this.loops.cancelLoops()
    this.running = false
    this.skipTyping = true
    this.pendingVoice = null
    this.unblock()
    this.vars = {}
    this.callStack = []
    this.pendingTrans = null
    this.ui.reset()
    this.unclaimedExt = {}
    this.replay.segment = null
    this.audio.stopAllTracks(0)
    this.audio.stopVoice()
    this.resetBacklog()
    await this.stage.restore({ chars: [], text: '', dialog: false })
    this.fireTheme()
    this.stage.chrome.hideScreen()
    this.setSession('title')
    await this.showTitleScreen()
  }

  // ---- chrome strings, persistence, the built-in screens ----

  /** A chrome string in the work's language: the work's overrides (`messages`
   *  / `[strings]`), then the engine catalog (en base), then the id. */
  t(id: string, params?: Record<string, string | number>): string {
    const own = this.messages[this.lang]?.[id] ?? this.messages.en?.[id]
    if (own === undefined) return tUI(id, params, this.lang)
    return params ? own.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : own
  }

  /** A config string: `@key` through the content catalogs, else literal, with
   *  `{$var}` / `{@key}` filled (what the pages, menus and panels show). */
  chromeString(s: string | undefined, quiet = false): string | undefined {
    return this.chromeText(s, quiet)
  }

  /** A config string: `@key` through the content catalogs, else literal.
   *  `quiet` = an undefined `{$var}` is empty without a diagnostic. */
  private chromeText(s: string | undefined, quiet = false): string | undefined {
    if (s === undefined) return undefined
    if (s.startsWith('@') && s.length > 1) return this.fill(this.resolveText(s.slice(1)) || s, quiet)
    return this.fill(s, quiet)
  }

  /** Where saves and settings persist: the host's store, else `localStorage`
   *  namespaced by the work (`saveKey`, else the page title). */
  get saveStore(): SaveStore {
    return this.customStore ?? new LocalStorageSaveStore(this.saveKey || (typeof document !== 'undefined' && document.title) || 'game')
  }

  /** Write the autosave (the title page's Continue). Skipped during a replay. */
  async writeAutosave(): Promise<void> {
    if (!this.running || this.replay.segment) return
    try {
      await this.saveStore.set(AUTOSAVE_KEY, this.slotPayload())
    } catch (err) {
      this.report({ phase: 'exec', message: `autosave failed: ${errMsg(err)}`, error: err }, true)
    }
  }

  /** Whether an autosave exists for this work. */
  async hasContinue(): Promise<boolean> {
    try {
      return isSlotPayload(await this.saveStore.get(AUTOSAVE_KEY))
    } catch {
      return false
    }
  }

  /** Resume from the autosave (Continue on the title page). False when there is
   *  none or it no longer fits the script. */
  continueGame(): Promise<boolean> {
    return this.loadSave(AUTOSAVE_KEY)
  }

  private chromeHost(hasContinue: boolean): ChromeHost {
    return {
      t: (id) => this.t(id),
      text: (s) => this.chromeText(s),
      resolve: (p) => this.resolve(p),
      workTitle: this.config.game?.title,
      buildInfo: this.buildInfo,
      hasContinue,
      extraButtons: [...this.titleExtras.values()],
      customButton: (id) => {
        if (!id.startsWith('ui:') || !this.ui.has(id.slice(3))) return undefined
        const pid = id.slice(3)
        return { id, label: this.ui.label(pid), onSelect: () => this.ui.toggle(pid) }
      },
      actions: {
        newGame: () => void this.start(),
        continueGame: () => void this.continueGame(),
        toTitle: () => void this.showTitle(),
        restart: () => void this.restart(),
        ...(this.menu ? { open: (screen: string) => this.menu!.open(screen === 'saves' ? 'load' : 'settings') } : {}),
      },
    }
  }

  // ---- auto / skip / read tracking ----

  /** Auto mode: lines advance by themselves after `autoDelay` (+ per-character
   *  time, and never before the voice clip ends); a tap ends it. */
  get auto(): boolean {
    return this._auto
  }
  setAuto(on: boolean): void {
    if (this._auto === on) return
    this._auto = on
    if (on && this._skip) this.setSkip(false)
    this.fire('onSettingsChange', 'auto', on ? 1 : 0)
    if (on && this.advanceResolve && !this.typing) this.tapAdvance() // parked on a line: go now
  }
  /** Skip mode: read lines (or everything, per `skipMode`) pass at once; ends at
   *  the first unread line in `read` mode and at every choice. Ctrl held = the
   *  same while held. */
  get skip(): boolean {
    return this._skip
  }
  setSkip(on: boolean): void {
    if (this._skip === on) return
    this._skip = on
    if (on && this._auto) this.setAuto(false)
    this.fire('onSettingsChange', 'skip', on ? 1 : 0)
    if (on) {
      if (this.typing) this.skipTyping = true
      else if (this.advanceResolve) this.tapAdvance()
    }
  }
  get autoDelay(): number {
    return this._autoDelay
  }
  setAutoDelay(sec: number, persist = true): void {
    const v = Math.max(0, sec)
    if (v === this._autoDelay) return
    this._autoDelay = v
    if (persist) this.settingChanged('autoDelay', v)
  }
  get skipMode(): 'read' | 'all' {
    return this._skipMode
  }
  setSkipMode(mode: 'read' | 'all', persist = true): void {
    if (mode === this._skipMode) return
    this._skipMode = mode
    if (persist) this.settingChanged('skipMode', mode)
  }
  /** The dialogue box's chrome opacity (the `dialog-opacity` token), a player setting. */
  get dialogOpacity(): number {
    return this._dialogOpacity
  }
  setDialogOpacity(v: number): void {
    const o = Math.max(0, Math.min(1, v))
    if (o === this._dialogOpacity) return
    this._dialogOpacity = o
    this.setTheme({ 'dialog-opacity': o === 1 ? '' : String(o) })
    this.settingChanged('dialogOpacity', o)
  }
  /** The chrome font-size multiplier (the `ui-scale` token), a player setting. */
  get uiScale(): number {
    return this._uiScale
  }
  setUiScale(v: number): void {
    const s = Math.max(0.5, Math.min(2, v))
    if (s === this._uiScale) return
    this._uiScale = s
    this.setTheme({ 'ui-scale': s === 1 ? '' : String(s) })
    this.settingChanged('uiScale', s)
  }
  isFullscreen(): boolean {
    return typeof document !== 'undefined' && document.fullscreenElement === this.stage.root
  }
  async setFullscreen(on: boolean): Promise<void> {
    try {
      if (on && !this.isFullscreen()) await this.stage.root.requestFullscreen?.()
      else if (!on && this.isFullscreen()) await document.exitFullscreen?.()
    } catch {
      /* not allowed here (no gesture, iframe policy) — the setting just stays off */
    }
  }
  getVolume(channel: VolumeChannel): number {
    return this[VOLUME_FIELD[channel]]
  }
  /** Display name of a language code (`ja` → 日本語). */
  languageName(lang: string): string {
    return uiLangName(lang)
  }
  /** Whether the player has passed this replay segment's end in normal play. */
  isUnlocked(segId: string): boolean {
    return this.unlocks.has(segId)
  }

  private readKeyOf(index: number): string {
    const a = this.addressOf(index)
    return `${a.label}:${a.offset}`
  }
  private skipActive(readKey: string): boolean {
    return (this._skip || this.skipHeld) && (this._skipMode === 'all' || this.readSet.has(readKey))
  }
  /** Skip applies to the line being typed / parked on now. */
  private lineSkipActive(): boolean {
    return (this._skip || this.skipHeld) && (this._skipMode === 'all' || this.readSet.has(this.readKeyOf(this.resumeIndex)))
  }
  /** Resolve a parked line as a tap would, without the tap's auto-cancel. */
  private tapAdvance(): void {
    this.audio.stopVoice()
    const resolve = this.advanceResolve
    this.advanceResolve = null
    resolve?.()
  }

  /** Park on a shown line: a tap, or — in skip / auto mode — the engine's own clock. */
  private async waitAdvanceOrAuto(readKey: string, textLen: number, stopVoice = true): Promise<void> {
    const gen = this.generation
    if (this.skipActive(readKey)) {
      await this.sleep(this.skipHeld ? 30 : 60) // a beat per line keeps the page responsive
      if (gen !== this.generation) return
      if (stopVoice) this.audio.stopVoice()
      return
    }
    if (this._skip && !this.skipHeld) this.setSkip(false) // unread text: skip mode ends here
    if (!this._auto) {
      await this.waitAdvance()
      return
    }
    const ms = (this._autoDelay + Math.min(textLen, 200) * 0.04) * 1000
    let tapped = false
    const tap = this.waitAdvance().then(() => {
      tapped = true
    })
    const clock = this.sleep(ms).then(async () => {
      while (!tapped && this._auto && this.voicePlaying && gen === this.generation) await this.sleep(100)
      while (!tapped && !this._auto && gen === this.generation) await this.sleep(100) // auto turned off meanwhile: wait for the tap
    })
    await Promise.race([tap, clock])
    if (gen !== this.generation) return
    if (!tapped) {
      this.advanceResolve = null
      if (stopVoice) this.audio.stopVoice()
    }
  }

  // ---- persisted player state: settings, read lines, unlocks, slots ----

  private settingChanged(key: SettingKey, value: number | string): void {
    this.fire('onSettingsChange', key, value)
    if (this.loadingSettings) return
    this.settingsDirty = true
    this.schedulePersist()
  }
  private schedulePersist(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = window.setTimeout(() => void this.persistNow(), 300)
  }
  private async persistNow(): Promise<void> {
    this.persistTimer = undefined
    const settings: SettingsPayload = {
      v: 1,
      textSpeed: this._textSpeed,
      autoDelay: this._autoDelay,
      skipMode: this._skipMode,
      volumes: { bgm: this.bgmVolume, ambience: this.ambienceVolume, se: this.seVolume, voice: this.voiceVolume },
      lang: this.lang,
      dialogOpacity: this._dialogOpacity,
      uiScale: this._uiScale,
    }
    try {
      if (this.settingsDirty) {
        this.settingsDirty = false
        await this.saveStore.set(SETTINGS_KEY, settings)
        if (Object.keys(this.playerPluginConfig).length) await this.saveStore.set(PLUGIN_SETTINGS_KEY, this.playerPluginConfig)
      }
      if (this.readDirty) {
        this.readDirty = false
        await this.saveStore.set(READ_KEY, [...this.readSet])
      }
      // Only once the stored table is known — writing before that would replace
      // the player's persistent variables with this run's seeds.
      if (this.globalsDirty && this.globalsLoaded) {
        this.globalsDirty = false
        this.storedGlobals = { ...this.storedGlobals, ...structuredClone(this.globals) }
        const payload: GlobalsPayload = { v: 1, vars: this.storedGlobals }
        await this.saveStore.set(GLOBALS_KEY, payload)
      }
    } catch {
      /* storage unavailable — settings just don't persist */
    }
  }
  private markRead(index: number): void {
    const key = this.readKeyOf(index)
    if (this.readSet.has(key)) return
    this.readSet.add(key)
    this.readDirty = true
    this.schedulePersist()
  }

  /** Bring back what the player persisted: settings, read lines, unlocks. Once,
   *  at `prepare()`; the old menu plugin's localStorage keys migrate here too. */
  private async loadPersisted(): Promise<void> {
    const store = this.saveStore
    this.loadingSettings = true
    try {
      if (!this.customStore) await this.migrateLegacyStorage(store)
      const s = (await store.get(SETTINGS_KEY)) as SettingsPayload | undefined
      if (s && typeof s === 'object') {
        if (typeof s.textSpeed === 'number') this.textSpeed = s.textSpeed
        if (typeof s.autoDelay === 'number') this._autoDelay = s.autoDelay
        if (s.skipMode === 'read' || s.skipMode === 'all') this._skipMode = s.skipMode
        for (const [ch, v] of Object.entries(s.volumes ?? {})) if (typeof v === 'number') this.setVolume(ch as VolumeChannel, v)
        if (typeof s.dialogOpacity === 'number') this.setDialogOpacity(s.dialogOpacity)
        if (typeof s.uiScale === 'number') this.setUiScale(s.uiScale)
        if (typeof s.lang === 'string' && s.lang !== this.lang && this.languages.includes(s.lang)) await this.setLanguage(s.lang)
      }
      const read = await store.get(READ_KEY)
      if (Array.isArray(read)) for (const k of read) if (typeof k === 'string') this.readSet.add(k)
      const unlocks = await store.get(UNLOCKS_KEY)
      if (Array.isArray(unlocks)) for (const k of unlocks) if (typeof k === 'string') this.unlocks.add(k)
      const g = (await store.get(GLOBALS_KEY)) as GlobalsPayload | undefined
      if (g && typeof g === 'object' && g.v === 1 && g.vars && typeof g.vars === 'object') {
        this.storedGlobals = { ...g.vars }
        // The store wins over the declared defaults; undeclared entries wait in
        // `storedGlobals` for a later declaration (or a `[set]` on a `sys.*` name).
        for (const [k, v] of Object.entries(this.storedGlobals)) if (this.isPersistent(k)) this.globals[k] = structuredClone(v)
      }
      const pc = await store.get(PLUGIN_SETTINGS_KEY)
      if (pc && typeof pc === 'object') {
        for (const [pid, table] of Object.entries(pc as Record<string, unknown>)) {
          if (table && typeof table === 'object') this.setPluginConfig(pid, table as Record<string, unknown>, { player: true, persist: false })
        }
      }
    } catch {
      /* unavailable — defaults */
    } finally {
      this.loadingSettings = false
      this.globalsLoaded = true
      if (this.globalsDirty) this.schedulePersist()
    }
  }

  /** The pre-0.15 menu plugin kept `nilvn:save:<game>:<n>` / `nilvn:settings:<game>`
   *  / `nilvn:unlocks:<game>` in localStorage — move them into the store once. */
  private async migrateLegacyStorage(store: SaveStore): Promise<void> {
    if (typeof localStorage === 'undefined') return
    const game = this.saveKey || (typeof document !== 'undefined' && document.title) || 'game'
    try {
      for (let n = 0; n < 100; n++) {
        const k = `nilvn:save:${game}:${n}`
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw) as unknown
        const payload: SlotPayload | undefined = isSlotPayload(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && (parsed as SaveState).v === 2
            ? { v: 1, savedAt: Date.now(), preview: '', state: parsed as SaveState }
            : undefined
        if (payload && (await store.get(slotKey(n))) === undefined) await store.set(slotKey(n), payload)
        localStorage.removeItem(k)
      }
      const legacySettings = localStorage.getItem(`nilvn:settings:${game}`)
      if (legacySettings) {
        const s = JSON.parse(legacySettings) as Record<string, unknown>
        const map: Record<string, VolumeChannel> = { bgmVolume: 'bgm', ambienceVolume: 'ambience', seVolume: 'se', voiceVolume: 'voice' }
        const volumes: Partial<Record<VolumeChannel, number>> = {}
        for (const [field, ch] of Object.entries(map)) if (typeof s[field] === 'number') volumes[ch] = s[field] as number
        if ((await store.get(SETTINGS_KEY)) === undefined) await store.set(SETTINGS_KEY, { v: 1, volumes } satisfies SettingsPayload)
        localStorage.removeItem(`nilvn:settings:${game}`)
      }
      const legacyUnlocks = localStorage.getItem(`nilvn:unlocks:${game}`)
      if (legacyUnlocks) {
        const arr = JSON.parse(legacyUnlocks) as unknown
        const have = ((await store.get(UNLOCKS_KEY)) as string[] | undefined) ?? []
        if (Array.isArray(arr)) await store.set(UNLOCKS_KEY, [...new Set([...have, ...arr.filter((x): x is string => typeof x === 'string')])])
        localStorage.removeItem(`nilvn:unlocks:${game}`)
      }
    } catch {
      /* a corrupt legacy entry is left alone */
    }
  }

  // ---- plugin settings (`contributes.config` / `[plugins.<id>]` / `ctx.config`) ----

  private pluginIdOf(nameOrId: string): string {
    return nameOrId.includes('.') ? nameOrId : FIRST_PARTY_ID_PREFIX + nameOrId
  }

  /** Set a plugin's settings: the author's layer by default (the config file /
   *  the studio), the player's with `player: true` (persisted per work).
   *  Listeners (`ctx.config.onChange`) hear each key. */
  setPluginConfig(nameOrId: string, patch: Record<string, unknown>, opts: { player?: boolean; persist?: boolean } = {}): void {
    const pid = this.pluginIdOf(nameOrId)
    const layer = opts.player ? this.playerPluginConfig : this.authorPluginConfig
    const table = (layer[pid] ??= {})
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete table[k]
      else table[k] = v
      for (const fn of this.pluginConfigListeners.get(pid) ?? []) fn(k, this.pluginConfigValue(pid, k))
    }
    if (opts.player && opts.persist !== false) {
      this.settingsDirty = true
      this.schedulePersist()
    }
    this.menuPluginRowsChanged()
  }

  /** The schema a plugin declared (`contributes.config`), if it has a manifest. */
  pluginConfigSchema(pid: string): ConfigFieldSchema[] | undefined {
    return this.host.manifestOf(pid)?.contributes?.config
  }

  /** One setting: the player's value, else the author's, else the schema default —
   *  coerced to the field's type when a schema names it. */
  pluginConfigValue(pid: string, key: string): unknown {
    const field = this.pluginConfigSchema(pid)?.find((f) => f.key === key)
    const raw = this.playerPluginConfig[pid]?.[key] ?? this.authorPluginConfig[pid]?.[key] ?? field?.default
    return field ? coerceConfig(raw, field) : raw
  }

  /** Every setting of a plugin (schema keys first, then author extras). */
  pluginConfigAll(pid: string): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const f of this.pluginConfigSchema(pid) ?? []) out[f.key] = this.pluginConfigValue(pid, f.key)
    for (const k of Object.keys(this.authorPluginConfig[pid] ?? {})) if (!(k in out)) out[k] = this.pluginConfigValue(pid, k)
    for (const k of Object.keys(this.playerPluginConfig[pid] ?? {})) if (!(k in out)) out[k] = this.pluginConfigValue(pid, k)
    return out
  }

  onPluginConfigChange(pid: string, fn: (key: string, value: unknown) => void): () => void {
    const set = this.pluginConfigListeners.get(pid) ?? new Set()
    this.pluginConfigListeners.set(pid, set)
    set.add(fn)
    return () => set.delete(fn)
  }

  /** Report author settings a plugin's schema does not name (once per plugin). @internal */
  checkPluginConfig(pid: string, warn: (message: string) => void): void {
    const schema = this.pluginConfigSchema(pid)
    if (!schema) return
    const known = new Set(schema.map((f) => f.key))
    for (const k of Object.keys(this.authorPluginConfig[pid] ?? {})) if (!known.has(k)) warn(`[plugins.${pid}] unknown setting "${k}" — not in contributes.config`)
  }

  /** Active plugins with `scope: player` settings — the settings panel's plugin rows. */
  activePluginConfigs(): { id: string; name: () => string; t: (id: string) => string; fields: ConfigFieldSchema[] }[] {
    const out: { id: string; name: () => string; t: (id: string) => string; fields: ConfigFieldSchema[] }[] = []
    for (const id of this.activePlugins) {
      const m = this.host.manifestOf(id)
      const fields = (m?.contributes?.config ?? []).filter((f) => f.scope === 'player')
      if (!fields.length) continue
      // Labels are the plugin's own i18n ids: resolve through ITS context (its manifest messages).
      const t = (msgId: string): string => this.host.contextOf(id)?.t(msgId) ?? this.t(msgId)
      out.push({ id, name: () => (m?.name ? t(m.name) : id), t, fields })
    }
    return out
  }
  private menuPluginRowsChanged(): void {
    this.menu?.pluginRowsChanged()
  }

  // ---- actor fields (`contributes.actorFields`) ----

  /** Move plugin-declared fields an actor carries at top level (`[actors.<id>]
   *  voice = 360`, `[actor yuki voice=360]`) into `ext[pluginId]`, for every
   *  registered manifest that declares them. Idempotent; run after every actor
   *  or manifest change. @internal */
  normalizeActors(): void {
    const fields = this.host.actorFields()
    if (!fields.length) return
    for (const actor of Object.values(this.actors)) {
      const a = actor as ActorDef & Record<string, unknown>
      for (const { pluginId, key } of fields) {
        if (!(key in a) || key === 'ext') continue
        if (STANDARD_ACTOR_KEYS.has(key) && key !== 'voice') continue
        const ext = (a.ext ??= {})
        const table = (ext[pluginId] ??= {})
        if (!(key in table)) table[key] = a[key]
        delete a[key]
      }
    }
  }

  /** A plugin's actor field (`ext[pluginId][key]`), with the pre-0.15 top-level
   *  `voice` still honoured for voicefx. */
  actorField(actorId: string, pluginId: string, key: string): unknown {
    const a = this.actors[actorId] as (ActorDef & Record<string, unknown>) | undefined
    if (!a) return undefined
    const v = a.ext?.[pluginId]?.[key]
    if (v !== undefined) return v
    if (key === 'voice' && pluginId === 'app.nilvn.voicefx') return a.voice
    return undefined
  }

  // ---- chrome contributions (`menuItems` / `titleItems` / `hud` / plugin screens) ----

  /** @internal */
  addMenuItem(pluginId: string, id: string, onSelect: () => void): () => void {
    const def = this.host.manifestOf(pluginId)?.contributes?.menuItems?.find((m) => m.id === id)
    const label = (): string => (def ? (this.host.contextOf(pluginId)?.t(def.label) ?? def.label) : id)
    return this.menu?.addItem(`${pluginId}:${id}`, label, onSelect, def?.when ?? 'playing') ?? (() => {})
  }
  /** @internal */
  addTitleItem(pluginId: string, id: string, onSelect: () => void): () => void {
    const def = this.host.manifestOf(pluginId)?.contributes?.titleItems?.find((m) => m.id === id)
    const key = `${pluginId}:${id}`
    this.titleExtras.set(key, {
      id: key,
      get label() {
        return def ? (host.contextOf(pluginId)?.t(def.label) ?? def.label) : id
      },
      onSelect,
    })
    const host = this.host
    void this.repaintScreen()
    return () => {
      this.titleExtras.delete(key)
      void this.repaintScreen()
    }
  }
  /** @internal */
  hudWidget(pluginId: string, id: string): { el: HTMLElement; dispose: () => void } {
    const def = this.host.manifestOf(pluginId)?.contributes?.hud?.find((h) => h.id === id)
    const el = this.stage.chrome.overlay(`nilvn-hud nilvn-hud--${def?.slot ?? 'top-left'}`)
    el.dataset.plugin = pluginId
    el.dataset.id = id
    el.style.display = this._session === 'playing' ? '' : 'none'
    this.hudEls.add(el)
    return {
      el,
      dispose: () => {
        this.hudEls.delete(el)
        el.remove()
      },
    }
  }
  /** @internal */
  openPluginScreen(pluginId: string, id: string, title: string, render: (body: HTMLElement, close: () => void) => void): void {
    this.closePluginScreen()
    this.menu?.closeAll()
    const wrap = this.stage.chrome.overlay('nilvn-backlog nilvn-screen-plugin on')
    wrap.dataset.plugin = pluginId
    wrap.dataset.id = id
    wrap.addEventListener('click', (ev) => ev.stopPropagation())
    const bar = document.createElement('div')
    bar.className = 'nilvn-backlog__bar'
    const t = document.createElement('span')
    t.className = 'nilvn-saves__title'
    t.textContent = title
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'nilvn-backlog__close'
    close.textContent = this.t('ui.menu.close')
    close.addEventListener('click', () => this.closePluginScreen())
    bar.append(t, close)
    const body = document.createElement('div')
    body.className = 'nilvn-backlog__list'
    wrap.append(bar, body)
    this.pluginScreen = { id: `${pluginId}:${id}`, el: wrap }
    render(body, () => this.closePluginScreen())
  }
  /** @internal */
  closePluginScreen(id?: string): void {
    if (!this.pluginScreen) return
    if (id !== undefined && !this.pluginScreen.id.endsWith(`:${id}`)) return
    this.pluginScreen.el.remove()
    this.pluginScreen = null
  }

  /** The snapshot a slot holds: the state plus the line on screen as its caption. */
  private slotPayload(): SlotPayload {
    const last = this.backlog.at(-1)
    const preview = last ? `${last.speaker ? last.speaker + ': ' : ''}${last.text}`.slice(0, 48) : ''
    return { v: 1, savedAt: Date.now(), preview, state: this.saveState() }
  }
  /** Write the current session into a store key (`slot:<n>`, `quick`, `auto`). */
  async writeSave(key: string): Promise<boolean> {
    if (!this.running) return false
    try {
      await this.saveStore.set(key, this.slotPayload())
      return true
    } catch (err) {
      this.report({ phase: 'exec', message: `save failed: ${errMsg(err)}`, error: err }, true)
      return false
    }
  }
  async readSave(key: string): Promise<SlotPayload | undefined> {
    try {
      const v = await this.saveStore.get(key)
      return isSlotPayload(v) ? v : undefined
    } catch {
      return undefined
    }
  }
  async deleteSave(key: string): Promise<void> {
    try {
      await this.saveStore.remove(key)
    } catch {
      /* unavailable */
    }
  }
  /** Restore a stored save; false when there is none or it no longer fits. */
  async loadSave(key: string): Promise<boolean> {
    const p = await this.readSave(key)
    if (!p) return false
    if (!(await this.prepare())) return false
    return this.restoreState(p.state)
  }
  saveSlot(n: number): Promise<boolean> {
    return this.writeSave(slotKey(n))
  }
  loadSlot(n: number): Promise<boolean> {
    return this.loadSave(slotKey(n))
  }
  quickSave(): Promise<boolean> {
    return this.writeSave(QUICKSAVE_KEY)
  }
  quickLoad(): Promise<boolean> {
    return this.loadSave(QUICKSAVE_KEY)
  }
  /** Open one of the system menu's panels (`saves` / `load` / `backlog` / `replays` / `settings`). No-op without the menu. */
  openMenu(panel: 'saves' | 'load' | 'backlog' | 'replays' | 'settings'): void {
    this.menu?.open(panel)
  }
  /** Rebuild the system menu from the current `[menu]` / `[settings]` /
   *  `[strings]` (applyConfig calls this after a `loadConfig`): items, entry
   *  position, gestures and labels follow the config; plugin menu entries survive.
   *  Creates or removes the menu when `[menu] enabled` changed. */
  refreshMenu(): void {
    const want = this.screensOn.menu && this.menuConfig.enabled !== false
    if (this.menu && want) this.menu.remount()
    else if (this.menu) {
      this.menu.destroy()
      this.menu = undefined
    } else if (want) {
      this.menu = new SystemMenu(this)
      this.menu.mount()
    }
  }

  private async showTitleScreen(): Promise<void> {
    if (!this.screensOn.title || this.titleConfig.enabled === false) return
    const hasContinue = await this.hasContinue()
    if (this.destroyed || this._session !== 'title') return
    const { model, unknownButtons } = titleModel(this.titleConfig, this.chromeHost(hasContinue))
    for (const id of unknownButtons) this.report({ phase: 'load', message: `[title] unknown button "${id}" — ignored` }, true)
    this.stage.chrome.showScreen('title', model)
    if (this.titleConfig.bgm) this.audio.playTrack('bgm', this.resolve(this.titleConfig.bgm), { loop: true, volume: this.titleConfig.bgmVolume ?? 1, fade: 0.8 })
  }

  private showEndingScreen(id: string): void {
    const cfg = this.endingConfig[id]
    if (!this.screensOn.ending || cfg?.enabled === false) return
    this.stage.chrome.showScreen('ending', endingModel(id, cfg, this.chromeHost(false)))
    if (cfg?.bgm) this.audio.playTrack('bgm', this.resolve(cfg.bgm), { loop: true, volume: cfg.bgmVolume ?? 1, fade: 0.8 })
  }

  /** Redraw the open screen (a language switch changed its strings). */
  private async repaintScreen(): Promise<void> {
    const up = this.stage.chrome.currentScreen()
    if (up === 'title' && this._session === 'title') await this.showTitleScreen()
    else if (up === 'ending' && this._session === 'ending' && this._ending !== undefined) this.showEndingScreen(this._ending)
  }

  /** Run the script from the top, or from a specific label. Resolves when the
   *  script finishes (`[end]`, `[ending]`, running off the end) — NOT when play
   *  begins; see `prepare()` / `ready` for that. */
  async start(label?: string): Promise<void> {
    if (!(await this.prepare(label))) return
    // A title / ending page's music does not bleed into the story.
    if (this._session === 'title' || this._session === 'ending') this.audio.stopAllTracks(0.4)
    let startPos = 0
    if (label !== undefined) {
      const idx = this.labels[label]
      if (idx === undefined) this.report({ phase: 'jump', message: `unknown start label "${label}" — starting from the top` })
      else startPos = idx
    }
    // start() is a session entry, like restart() / restoreState(): stop any
    // animations left over from a previous run before the new runLoop. Loops in
    // particular have no generation guard (only a destroyed-guard), so a second
    // start() without an intervening destroy would otherwise leak the old loop's
    // rAF clock. runLoop bumps the generation, which retires stale event-frames.
    this.loops.cancelRafAnims()
    this.loops.cancelLoops()
    this.resetBacklog() // a fresh session starts with an empty backlog
    this.callStack = []
    this.ui.reset()
    await this.runLoop(startPos)
  }

  /** The node-execution loop. Guarded by `generation` so a load() can abandon a
   *  stale loop and resume from a saved position without double-running nodes. */
  private async runLoop(startPos: number): Promise<void> {
    if (this.destroyed) return
    const gen = ++this.generation
    this.pos = startPos
    this.running = true
    this.stage.chrome.hideScreen()
    this.setSession('playing')
    let steps = 0
    while (this.running && gen === this.generation) {
      // A script that loops without ever waiting ([label]/[jump] cycles, [set] storms)
      // would otherwise spin on microtasks alone and starve the page — no input, no
      // timers, not even destroy() can get a word in. Yield to the event loop every
      // so often so the host stays responsive and a runaway script is interruptible.
      if ((++steps & 0xff) === 0) {
        await this.sleep(0)
        if (gen !== this.generation) return
      }
      // Ran off the end of the resident nodes. In chunked play this may just be a
      // chunk boundary — load the next scene (in fall-through order) and continue.
      // Eager / non-chunked play has everything resident, so loadNextChunk returns
      // false at once and we fall through to finish() exactly as before.
      if (this.pos >= this.nodes.length) {
        let loaded = false
        try {
          loaded = await this.residency.loadNextChunk()
        } catch (err) {
          // A successor chunk that cannot be fetched ends the script cleanly (onEnd
          // fires) instead of surfacing as an unhandled rejection off `void runLoop()`.
          if (gen === this.generation) this.report({ phase: 'load', message: `could not load the next scene: ${errMsg(err)}`, error: err })
        }
        if (gen !== this.generation) return // a restore/destroy slipped in during the fetch
        if (!loaded) break // no next scene — the script has truly ended
        continue // new nodes appended at `pos`; keep running
      }
      const idx = this.pos
      const node = this.nodes[idx]
      // Stepped into an evicted chunk's slot: the node objects were freed but
      // the slot kept as a hole. Re-materialize the owning chunk in place, then retry
      // the same index. Never happens without a memory ceiling — no hole is ever made.
      if (node === undefined || node === HOLE) {
        const owner = this.residency.chunkOwning(idx)
        if (owner === undefined) break // off the map — defensive, treat as end
        try {
          await this.residency.ensureChunk(owner)
        } catch (err) {
          if (gen === this.generation) this.report({ phase: 'load', chunk: owner, message: `could not reload scene "${owner}": ${errMsg(err)}`, error: err })
          break
        }
        if (gen !== this.generation) return
        continue
      }
      this.pos = idx + 1
      this.resumeIndex = idx
      this.current = node
      try {
        await this.exec(node)
      } catch (err) {
        this.report({ phase: 'exec', message: `script error: ${errMsg(err)}`, line: node.line, node, error: err })
      } finally {
        if (this.current === node) this.current = null
      }
      // The last node of a chunk, left by natural advance: continue in the chunk's
      // fall-through successor even when it is not the physically next one (a
      // jump appended chunks out of story order — script files keep list order).
      if (gen === this.generation && this.pos === idx + 1) {
        const next = this.residency.fallThroughFrom(idx)
        if (next !== undefined) {
          try {
            await this.residency.ensureChunk(next)
          } catch (err) {
            if (gen === this.generation) this.report({ phase: 'load', chunk: next, message: `could not load the next scene: ${errMsg(err)}`, error: err })
            break
          }
          if (gen !== this.generation) return
          const base = this.residency.baseOf(next)
          if (base !== undefined) this.pos = base
        }
      }
    }
    if (this.running && gen === this.generation) this.finish()
  }

  /** Address a flat node index as (nearest preceding label, offset). The script
   *  always opens with a `[label …]` (each scene emits one), so a label at-or-before
   *  any executed index exists; the empty-label fallback is defensive (absolute from
   *  start). Used so a save survives re-compilation that a flat index wouldn't. */
  private addressOf(idx: number): SaveAddress {
    let label = ''
    let base = -1
    for (const name in this.labels) {
      const at = this.labels[name]!
      if (at <= idx && at > base) {
        base = at
        label = name
      }
    }
    return { label, offset: idx - (base < 0 ? 0 : base) }
  }

  /** Resolve a saved (label, offset) address to a flat node index in the loaded
   *  script, or -1 when the label no longer exists (a stale / re-scoped save). The
   *  empty label addresses absolutely from the script start. */
  private resolveAddress(at: SaveAddress): number {
    if (!at || typeof at.offset !== 'number' || typeof at.label !== 'string') return -1
    const base = at.label === '' ? 0 : this.labels[at.label]
    return base === undefined ? -1 : base + at.offset
  }

  /** Ensure the chunk that DEFINES `label` is fully resident (script + current-
   *  language text) before a jump / start / restore resolves it. No-op for
   *  non-chunked play — the whole script is already loaded. */
  ensureLoaded(label: string): Promise<void> {
    return this.residency.ensureLoaded(label)
  }

  // ---- theme (the `--nilvn-*` token contract; see theme.ts) ----
  private themeBase: Record<string, string> = {}
  private themeListeners = new Set<(theme: Readonly<Record<string, string>>) => void>()

  /** The effective theme overrides (base + script layer). Defaults are `THEME_TOKENS`. */
  get theme(): Readonly<Record<string, string>> {
    return this.stage.getTheme()
  }

  /** Merge into the BASE theme layer (host / config): survives restart and
   *  loads, is not part of a save. `''` / undefined removes a token. Unknown
   *  tokens are reported (`load` diagnostic) and painted anyway. */
  setTheme(patch: Record<string, string | number | undefined>): void {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete this.themeBase[k]
      else this.themeBase[k] = String(v)
    }
    this.checkThemeTokens(Object.keys(patch), 'load')
    this.stage.setThemeBase(this.themeBase)
    this.fireTheme()
  }

  /** The SCRIPT theme layer (`[theme …]`): merged into the stage snapshot, reset
   *  by restart / a load. `null` clears it.
   *  @internal */
  setScriptTheme(patch: Record<string, string | undefined> | null, line?: number): void {
    if (patch) this.checkThemeTokens(Object.keys(patch), 'exec', line)
    this.stage.setTheme(patch)
    this.fireTheme()
  }

  /** Subscribe to theme changes on either layer; returns the unsubscribe. */
  onThemeChange(fn: (theme: Readonly<Record<string, string>>) => void): () => void {
    this.themeListeners.add(fn)
    return () => this.themeListeners.delete(fn)
  }

  /** @internal — after a restore repaints the script layer */
  fireTheme(): void {
    const theme = this.theme
    for (const fn of this.themeListeners) fn(theme)
  }

  private checkThemeTokens(keys: string[], phase: 'load' | 'exec', line?: number): void {
    for (const k of keys) {
      if (isThemeToken(k)) continue
      const message = THEME_TOKEN_RE.test(k)
        ? `unknown theme token "${k}" (see THEME_TOKENS) — set as --nilvn-${k} anyway`
        : `invalid theme token "${k}" (lower-case words joined by dashes)`
      this.report({ phase, message, line }, true)
    }
  }

  /** Capture a resumable snapshot of the current play session. */
  saveState(): SaveState {
    // Finalize any in-flight exit-settle bridge to its exit pose first, so the
    // snapshot persists the settled exit rather than a transient mid-tween value
    // (a stopped loop is not in `activeLoops` for restore to re-settle — 4c).
    this.loops.settleExitBridges()
    const { music, beds } = this.audio.tracks()
    const state: SaveState = {
      v: 2,
      at: this.addressOf(this.resumeIndex),
      vars: structuredClone(this.vars),
      calls: this.callStack.length ? this.callStack.map((a) => ({ ...a })) : undefined,
      ui: this.ui.state(),
      stage: this.stage.snapshot(),
      textSpeed: this.textSpeed,
      lang: this.lang,
      // Store the authored base volume (not the master-scaled element volume), so
      // restore re-applies the live master cleanly instead of double-scaling.
      bgm: music,
      tracks: beds.length ? beds : undefined,
      // Per-plugin slices (running loops live in ext.animstudio now), plus any
      // slices restored from a save whose plugin isn't installed — carried
      // through untouched so disabling a plugin never destroys its saved state.
      ext: this.collectExt(),
    }
    this.fire('onSaved', state)
    return state
  }

  /** Assemble SaveState.ext: unclaimed carry-through first, then every installed
   *  plugin's saveState slice. Undefined when there is nothing to store, so saves
   *  without plugin state stay byte-identical to pre-ext ones. */
  private collectExt(): Record<string, unknown> | undefined {
    const ext: Record<string, unknown> = { ...this.unclaimedExt, ...this.host.saveSlices() }
    return Object.keys(ext).length ? ext : undefined
  }

  /** Restore a saved snapshot and resume play from it. Returns false (without
   *  touching anything) when the save is incompatible — wrong version, a
   *  different/re-ordered script, or an out-of-range playhead. */
  async restoreState(state: SaveState): Promise<boolean> {
    if (!state || state.v !== 2 || !state.at) return false
    // Chunked play (lazy): make the saved label's chunk resident before
    // resolving its (label,offset) — a label whose chunk isn't loaded would
    // otherwise read as an incompatible save. Play then continues on demand from
    // there. No-op without a manifest. ('' = absolute-from-start ⇒ entry chunk.)
    if (this.manifest) {
      const label = state.at.label || this.manifest.entry.label
      try {
        await this.residency.ensureLoaded(label)
      } catch (err) {
        this.report({ phase: 'load', chunk: this.manifest.labelIndex[label], message: `could not load the saved scene: ${errMsg(err)}`, error: err })
        return false
      }
    }
    const pos = this.resolveAddress(state.at)
    if (pos < 0 || pos >= this.nodes.length) return false
    // Invalidate the current loop first, then unblock whatever it's awaiting so
    // it unwinds (a pending dialogue advance OR a choices prompt). The new loop
    // below takes over from the saved pos.
    this.generation++
    this.loops.cancelRafAnims() // abort any in-flight event-frame before the new session
    this.loops.cancelLoops() // and stop running loops; saved ones restart after restore
    this.replay.segment = null // a load is always a normal-play session
    this.resetBacklog() // the backlog isn't persisted — a load starts a fresh backlog
    this.vars = structuredClone(state.vars)
    this.ui.restore(state.ui)
    this.pendingTrans = null
    this.callStack = Array.isArray(state.calls) ? state.calls.filter((a) => a && typeof a.label === 'string' && typeof a.offset === 'number').map((a) => ({ label: a.label, offset: a.offset })) : []
    if (typeof state.textSpeed === 'number') this.textSpeed = state.textSpeed
    // Resume in the saved language (if it still ships a catalog), keeping chrome
    // and the menu's language selection in sync.
    if (typeof state.lang === 'string' && (state.lang === this.defaultLang || this.catalogs[state.lang])) {
      this.lang = state.lang
      for (const fn of this.langListeners) fn(state.lang)
    }
    this.skipTyping = true
    this.unblock()
    // Restore audio: stop every playing track + any voice clip, then resume the
    // saved BGM and ambience beds (if any).
    this.audio.stopAllTracks(0)
    this.audio.stopVoice()
    if (state.bgm?.src) this.playBgm(state.bgm.src, { loop: state.bgm.loop, volume: state.bgm.volume })
    for (const t of state.tracks ?? []) {
      if (t.src && t.track && t.track !== Engine.MUSIC_TRACK) this.playTrack(t.track, t.src, { loop: t.loop, volume: t.volume })
    }
    // Pass a face resolver so a `face` keyframe played after this load still swaps the
    // sprite art (the renderer has no actor templates of its own).
    // A save stores asset REFS; the stage re-resolves them here
    // (aliases / the by-ref table / base URL). Older saves hold resolved URLs,
    // which `resolve()` passes through unchanged.
    await this.stage.restore(
      state.stage,
      (charId, face) => {
        const tmpl = this.actors[charId]?.sprites
        return tmpl ? this.resolve(tmpl.replaceAll('{face}', face)) : undefined
      },
      (src) => this.resolve(src),
      (charId, values) => {
        const actor = this.actors[charId]
        if (!actor?.layers) return undefined
        try {
          const built = this.buildLayers(charId, actor, values)
          return { layers: built.layers, canvas: built.canvas, layerUrl: built.layerUrl }
        } catch (err) {
          this.report({ phase: 'load', message: `could not rebuild "${charId}"'s layers: ${errMsg(err)}`, error: err }, true)
          return undefined
        }
      },
    )
    this.fireTheme() // the saved script theme layer is painted again
    // Plugin state slices run AFTER the stage is restored (e.g. animstudio
    // restarts its loops so each entry pose overrides the mid-phase value the
    // snapshot held —) and before play resumes.
    // Legacy top-level loops first (pre-ext saves)…
    for (const l of state.activeLoops ?? []) this.startLoop(l.objId, l.duration, l.entry, l.body, l.into, false)
    // …then dispatch each ext slice to its installed owner. Slices with no owner
    // are kept, not dropped: they ride along to the next save untouched.
    this.unclaimedExt = {}
    for (const [name, data] of Object.entries(state.ext ?? {})) {
      if (!this.host.restoreSlice(name, data)) this.unclaimedExt[name] = data
    }
    // Chunked play: the save may carry a different language than
    // the session it restores into, and `ensureLoaded` above ran under the OLD
    // language — fill the resident chunks' slices for the restored language before
    // play re-renders, or its first lines would fall back to the default language.
    if (this.manifest) await this.residency.ensureResidentLocales(this.lang)
    void this.runLoop(pos)
    this.fire('onRestored', state)
    return true
  }

  /** Restart the loaded script from the very beginning with a clean slate
   *  (fresh variables, blank stage, audio stopped). The script re-establishes
   *  the background / characters as it replays from the top. Used by the
   *  in-game menu's "Back to start". */
  async restart(): Promise<void> {
    // Invalidate the current loop and unblock whatever it's awaiting so it
    // unwinds (a pending dialogue advance OR a choices prompt), then play from 0.
    this.generation++
    this.loops.cancelRafAnims()
    this.loops.cancelLoops()
    this.unclaimedExt = {} // a clean slate carries no other session's plugin state
    this.vars = {}
    this.callStack = []
    this.pendingTrans = null
    this.ui.reset()
    this.skipTyping = true
    this.unblock()
    this.audio.stopAllTracks(0)
    this.audio.stopVoice()
    this.replay.segment = null // back to normal play
    this.resetBacklog() // back to the start ⇒ empty backlog
    await this.stage.restore({ chars: [], text: '', dialog: false })
    this.fireTheme() // the script theme layer was reset with the stage
    void this.runLoop(0)
  }

  /** Move the playhead to `label`, first making the chunk that DEFINES it resident
   *  (a no-op when the whole script is already loaded — non-chunked or eager play).
   *  Async: the three jump sites (`[jump]`/`[if]` builtins + choice
   *  targets) await it. Captures the generation before the load and bails without
   *  moving the playhead if the session advanced during it (a concurrent
   *  restore/destroy) — the run loop's generation guard then unwinds this stale
   *  frame instead of it clobbering the new session's `pos`. */
  async jump(label: string): Promise<void> {
    const gen = this.generation
    const from = this.current ?? undefined
    try {
      await this.residency.ensureLoaded(label)
    } catch (err) {
      // The target's chunk could not be fetched: report, stay put, keep playing.
      if (gen !== this.generation) return
      this.report({ phase: 'load', chunk: this.manifest?.labelIndex[label], message: `could not load the scene for "${label}": ${errMsg(err)}`, line: from?.line, node: from, error: err })
      return
    }
    if (gen !== this.generation) return
    const idx = this.labels[label]
    if (idx === undefined) {
      // Unknown target = the jump is a no-op and play continues past it (decision
      // §6-1: the author sees what follows in preview; the finished game reads as
      // "nothing happened" rather than ending on a black screen).
      this.report({ phase: 'jump', message: `unknown label "${label}"`, line: from?.line, node: from }, true)
      return
    }
    this.pos = idx
  }

  /** `[call label]`: jump there, remembering the line after the call so
   *  `[return]` comes back to it. An unknown label reports (as `jump` does) and
   *  remembers nothing. */
  async call(label: string): Promise<void> {
    const gen = this.generation
    const here = this.addressOf(this.pos)
    await this.jump(label)
    if (gen !== this.generation || this.labels[label] === undefined) return
    this.callStack.push(here)
  }

  /** `[return]`: back to the line after the innermost pending `[call]`; without
   *  one, a diagnostic and play goes on. */
  async returnFromCall(): Promise<void> {
    const to = this.callStack.pop()
    const from = this.current ?? undefined
    if (!to) {
      this.report({ phase: 'exec', message: '[return] with no [call] to return to — ignored', line: from?.line, node: from }, true)
      return
    }
    const gen = this.generation
    if (this.manifest && to.label) {
      try {
        await this.residency.ensureLoaded(to.label)
      } catch (err) {
        if (gen === this.generation) this.report({ phase: 'load', chunk: this.manifest.labelIndex[to.label], message: `could not load the scene to return to ("${to.label}"): ${errMsg(err)}`, error: err })
        return
      }
      if (gen !== this.generation) return
    }
    const idx = this.resolveAddress(to)
    if (idx < 0 || idx > this.nodes.length) {
      this.report({ phase: 'jump', message: `[return] target "${to.label}" +${to.offset} no longer exists — ignored`, line: from?.line, node: from })
      return
    }
    this.pos = idx
  }

  /** Warm assets — images are decoded, everything else fetched into the HTTP
   *  cache — `concurrency` at a time, with the loading page up meanwhile (unless
   *  `screen: false`, `[preload] screen = false` or `screens.loading` says no).
   *  Failures are diagnostics, never rejections; `onPreload` fires per asset. */
  async preload(refs: string[], opts: { screen?: boolean } = {}): Promise<void> {
    const list = [...new Set(refs.filter((r) => typeof r === 'string' && r))]
    if (!list.length || this.destroyed) return
    const cfg = this.preloadConfig
    // The loading page never replaces a page that is up (the title, an ending):
    // `showScreen` is one-at-a-time, and the page would be gone afterwards.
    const screen = (opts.screen ?? cfg.screen !== false) && this.screensOn.loading && this.stage.chrome.currentScreen() === null
    if (screen) this.showLoadingScreen(0)
    const workers = Math.max(1, Math.min(cfg.concurrency ?? 4, list.length))
    let next = 0
    let done = 0
    const run = async (): Promise<void> => {
      while (next < list.length && !this.destroyed) {
        const ref = list[next++]!
        await this.warmAsset(ref)
        done++
        if (screen) this.stage.chrome.setProgress(done / list.length)
        this.fire('onPreload', done, list.length, ref)
      }
    }
    await Promise.all(Array.from({ length: workers }, run))
    if (screen && !this.destroyed) this.stage.chrome.hideScreen('loading')
  }

  private async warmAsset(ref: string): Promise<void> {
    try {
      const url = this.loader ? await this.loader.assetUrl(ref) : this.resolve(ref)
      if (isImageUrl(url)) await preloadImage(url)
      else {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await res.arrayBuffer()
      }
    } catch (err) {
      this.report({ phase: 'load', message: `preload of "${ref}" failed: ${errMsg(err)}`, error: err }, true)
    }
  }

  /** What `[preload] auto` warms: the resident nodes' assets — in chunked play
   *  the entry chunk's and its fall-through successors' manifest lists. */
  private autoPreloadRefs(): string[] {
    const m = this.manifest
    if (m && m.chunks.some((c) => c.assets.length)) {
      const entry = m.labelIndex[m.entry.label]
      const first = m.chunks.find((c) => c.id === entry) ?? m.chunks[0]
      const ids = new Set<string>(first ? [first.id, ...first.next] : [])
      return m.chunks.filter((c) => ids.has(c.id)).flatMap((c) => c.assets)
    }
    return scanAssetRefs(this.nodes, this.actors)
  }

  private showLoadingScreen(progress: number): void {
    const cfg = this.preloadConfig
    this.stage.chrome.showScreen('loading', {
      heading: this.chromeText(cfg.heading) ?? this.t('ui.loading.title'),
      background: screenBackground(cfg.background, (p) => this.resolve(p)),
      buttons: [],
      progress,
    })
  }

  /** End the run now. `endingId` names the ending reached (`[ending id]`);
   *  `[end]` and running off the end are the `default` ending. The session
   *  enters `ending` and the chrome shows that screen (once inc 3 lands). */
  finish(endingId?: string): void {
    if (!this.running) return
    this.running = false
    const id = endingId ?? this.pendingEnding ?? 'default'
    this.pendingEnding = undefined
    this._ending = id
    this.addToGlobalSet('sys.endings', id)
    this.setSession('ending')
    this.showEndingScreen(id)
    this.fire('onEnd')
    this.onEndCb?.()
  }

  /** Write one script variable (what `[set]` and `vars.set` do): plugins hear
   *  `onVarChange`. */
  setVar(name: string, value: unknown): void {
    if (this.isPersistent(name)) {
      this.setGlobal(name, value)
      return
    }
    this.vars[name] = value
    this.fire('onVarChange', name, value)
    this.ui.refresh()
  }

  /** A variable by name — persistent first, then the session's; `undefined`
   *  when neither has it (expressions read it as 0, `{$var}` shows empty). */
  getVar(name: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.globals, name) ? this.globals[name] : this.vars[name]
  }

  /** `[choices timer=8 default=2]`: the next prompt's timer (seconds; 0 = none)
   *  and 1-based default, overriding the `[choices]` config for that prompt only. */
  setNextChoices(over: { timer?: number; timerDefault?: number }): void {
    this.nextChoices = { ...over }
  }

  /** The table expressions evaluate against: the session's variables under the
   *  persistent ones (a fresh object each call — read, don't write). */
  scope(): Record<string, unknown> {
    return { ...this.vars, ...this.globals }
  }

  /** Whether `name` persists across sessions: declared with `[persist]` /
   *  `declarePersist`, or in the reserved `sys.` namespace. */
  isPersistent(name: string): boolean {
    return this.persistNames.has(name) || name.startsWith('sys.')
  }

  /** Declare a persistent variable (`[persist]`, the `[persist]` config section,
   *  `[input persist=true]`). The store's value wins; `def` seeds the first run. */
  declarePersist(name: string, def: unknown): void {
    this.persistNames.add(name)
    if (Object.prototype.hasOwnProperty.call(this.globals, name)) return
    this.globals[name] = Object.prototype.hasOwnProperty.call(this.storedGlobals, name) ? structuredClone(this.storedGlobals[name]) : def
  }

  /** Write a persistent variable (declaring it if needed) and schedule the
   *  store write; plugins hear `onVarChange`. */
  setGlobal(name: string, value: unknown): void {
    this.persistNames.add(name)
    this.globals[name] = value
    this.globalsDirty = true
    this.schedulePersist()
    this.fire('onVarChange', name, value)
    this.ui.refresh()
  }

  /** Add `value` to a persistent list once (`sys.endings`, `sys.chosen`). */
  private addToGlobalSet(name: string, value: string): void {
    const cur = this.globals[name]
    const list = Array.isArray(cur) ? cur.slice() : []
    if (list.includes(value)) return
    list.push(value)
    this.setGlobal(name, list)
  }

  /** Ask the player for a string — the `[input]` command's box (in-engine, never
   *  the browser's). The fallback is the variable's current value when it has
   *  one (a persisted name comes back on the next run, a second `[input]` offers
   *  the first answer), else `default`: cancel, or OK on an empty field, yields
   *  it. The value is written with `setVar` (persistent when `persist` or
   *  declared so). Resolves to the value written. */
  async promptInput(name: string, opts: { prompt?: string; default?: string; maxlength?: number; pattern?: string; persist?: boolean } = {}): Promise<string> {
    const gen = this.generation
    const seed = opts.default !== undefined ? this.fill(opts.default) : ''
    if (opts.persist) this.declarePersist(name, seed)
    const current = this.getVar(name)
    const def = current !== undefined && current !== '' ? displayValue(current) : seed
    let pattern = opts.pattern
    if (pattern !== undefined) {
      try {
        new RegExp(`^(?:${pattern})$`, 'u')
      } catch (err) {
        this.report({ phase: 'exec', message: `[input] pattern "${pattern}" is not a valid regular expression — ignored: ${errMsg(err)}`, error: err }, true)
        pattern = undefined
      }
    }
    const cfg = this.inputConfig
    const handle = this.stage.chrome.prompt(this.chromeText(opts.prompt) ?? '', {
      ok: this.chromeText(cfg.ok) ?? this.t('ui.dialog.ok'),
      cancel: this.chromeText(cfg.cancel) ?? this.t('ui.dialog.cancel'),
      default: def,
      maxlength: opts.maxlength,
      pattern,
      position: cfg.position,
    })
    this.promptCancel = handle.cancel
    const typed = await handle.result
    this.promptCancel = null
    if (gen !== this.generation) return def
    const value = typed === null || typed === '' ? def : typed
    this.setVar(name, value)
    return value
  }

  /** Set a channel's master volume (0..1), re-applied to what is playing;
   *  plugins hear `onSettingsChange('volume:<channel>')`. */
  setVolume(channel: VolumeChannel, value: number): void {
    const v = Math.max(0, Math.min(1, value))
    const field = VOLUME_FIELD[channel]
    if (this[field] === v) return
    this[field] = v
    this.applyVolumes()
    this.settingChanged(`volume:${channel}`, v)
  }

  destroy(): void {
    if (this.destroyed) return
    this.setSession('idle') // while plugins can still hear it
    this.destroyed = true
    this.generation++
    this.loops.destroy()
    this.running = false
    this.skipTyping = true
    this.pendingVoice = null
    this.unblock()
    window.removeEventListener('keydown', this.keyHandler)
    window.removeEventListener('keyup', this.keyUpHandler)
    this.menu?.destroy()
    this.menu = undefined
    this.ui.destroy()
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer)
      void this.persistNow()
    }
    // Plugins release everything they registered, last activated first. A throwing
    // deactivate is reported and never blocks the rest of the shutdown.
    this.host.destroyAll()
    this.audio.destroy()
    this.resetBacklog() // drop the session backlog (the replay clip is already stopped)
    // Let a byte-reclaiming loader (desktop player / editor try-play) free every
    // resident chunk's native cache — a host embedding chunked play may outlive
    // this engine instance. No-op for the Web loader.
    this.residency.releaseAll()
    this.replay.destroy()
    this.stage.destroy()
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  wait(sec: number): Promise<void> {
    return this.sleep(sec * 1000)
  }

  getTextEffect(name: string): TextEffectFn | undefined {
    return this.host.textEffect(name)?.value
  }

  /** Report a content problem once per distinct message (an `exec` diagnostic). */
  warnOnce(msg: string): void {
    this.report({ phase: 'exec', message: msg }, true)
  }

  // ---- internals ----

  /** Release whatever the run loop is parked on — a pending dialogue advance or a
   *  choices prompt — so a superseded loop unwinds (load / restart / replay / destroy). */
  private unblock(): void {
    const adv = this.advanceResolve
    this.advanceResolve = null
    adv?.()
    const ch = this.choiceResolve
    this.choiceResolve = null
    ch?.()
    const pc = this.promptCancel
    this.promptCancel = null
    pc?.()
  }

  private tap(): void {
    if (!this.running) return
    if (this._auto) this.setAuto(false) // a tap takes the wheel back
    if (this._skip) this.setSkip(false)
    if (this.typing) {
      this.skipTyping = true
      return
    }
    // Advancing past the line also cuts its voice clip short.
    this.audio.stopVoice()
    const resolve = this.advanceResolve
    this.advanceResolve = null
    resolve?.()
  }

  private waitAdvance(): Promise<void> {
    return new Promise((r) => {
      this.advanceResolve = r
    })
  }

  private exec(node: ScriptNode): void | Promise<void> {
    switch (node.type) {
      case 'label':
        this.fire('onLabel', node.name)
        if (this.autosave === 'label') void this.writeAutosave()
        return
      case 'command':
        return this.execCommand(node)
      case 'dialogue':
        return this.execDialogue(node)
      case 'choices':
        return this.execChoices(node)
    }
  }

  /** The parsed-tag half every command context shares. */
  private tagArgs(node: { name: string; args: string[]; params: Record<string, string>; raw: string }): Omit<CommandContext, 'plugin'> {
    const { args, params } = node
    const pick = (key: string | number) => (typeof key === 'number' ? args[key] : params[key])
    return {
      name: node.name,
      args,
      params,
      raw: node.raw,
      str: <D extends string | undefined>(key: string | number, def?: D) => (pick(key) ?? def) as string | D,
      num: (key: string | number, def = 0) => {
        const v = pick(key)
        const n = v === undefined ? NaN : parseFloat(v)
        return Number.isFinite(n) ? n : def
      },
      numOpt: (key: string | number) => {
        const v = pick(key)
        const n = v === undefined ? NaN : parseFloat(v)
        return Number.isFinite(n) ? n : undefined
      },
      resolve: (p) => this.resolve(p),
      wait: (sec) => this.wait(sec),
    }
  }

  /** Built-in commands are engine code: they get the engine, the renderer and the
   *  privileged root context. Never handed to a plugin. */
  private builtinContext(node: { name: string; args: string[]; params: Record<string, string>; raw: string }): BuiltinContext {
    this.rootCtx ??= this.host.rootContext()
    return { ...this.tagArgs(node), plugin: this.rootCtx, engine: this, stage: this.stage, animate }
  }

  /** A plugin command runs with its owner's capability context only. */
  private pluginCommandContext(node: { name: string; args: string[]; params: Record<string, string>; raw: string }, plugin: PluginContext): CommandContext {
    return { ...this.tagArgs(node), plugin }
  }

  private async execCommand(node: CommandNode, depth = 0): Promise<void> {
    const builtin = this.builtinCommands.get(node.name)
    // A plugin command; an `onCommand`-activated plugin wakes up on first use.
    const owned = builtin ? undefined : (this.host.command(node.name) ?? this.host.activateForCommand(node.name))
    if (!builtin && !owned) {
      if (this.macros[node.name] !== undefined) return this.execMacro(node, depth)
      this.report({ phase: 'exec', message: `unknown command [${node.name}] — missing a [use ...] or macro?`, line: node.line, node }, true)
      return
    }
    // A quarantined plugin's commands are no-ops (already reported at isolation).
    const owner = owned?.owner
    if (owner && this.host.isIsolated(owner)) return
    const defaults = this.defaults[node.name]
    const merged = defaults ? { ...node, params: { ...defaults, ...node.params } } : node
    this.fire('onCommand', node.name, merged.args, merged.params)
    try {
      if (builtin) await builtin(this.builtinContext(merged))
      else {
        const ctx = this.host.contextOf(owner!)
        if (!ctx) return
        await owned!.value(this.pluginCommandContext(merged, ctx))
      }
    } catch (err) {
      this.report({ phase: 'exec', message: `[${node.name}] failed: ${errMsg(err)}`, line: node.line, node, plugin: owner, error: err })
      if (owner) this.host.noteFailure(owner)
      return
    }
    if (owner) this.host.noteSuccess(owner) // a success resets the consecutive count
  }

  /** Expand a macro: each line is a command (with or without brackets) */
  private async execMacro(node: CommandNode, depth: number): Promise<void> {
    if (depth >= 8) throw new Error(`macro [${node.name}] expands too deep — recursive macros?`)
    const lines = this.macros[node.name]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith('//'))
    const single = lines.length === 1
    for (const line of lines) {
      const inner = line.startsWith('[') && line.endsWith(']') ? line.slice(1, -1).trim() : line
      const sub = parseTag(inner, node.line)
      if (sub.type !== 'command') {
        this.warnOnce(`macro "${node.name}": only command lines are supported`)
        continue
      }
      // A single-line macro passes the caller's args/params through (caller wins)
      if (single) {
        sub.args.push(...node.args)
        Object.assign(sub.params, node.params)
      }
      await this.execCommand(sub, depth + 1)
    }
  }

  private async execDialogue(node: DialogueNode): Promise<void> {
    const gen = this.generation
    if (this.pendingTrans) {
      await this.commitTransition() // an armed [trans] reveals the scene before its line
      if (gen !== this.generation) return
    }
    this.audio.stopVoice() // a previous line's clip never bleeds into this one
    // Capture the queued voice ref + offset before startPendingVoice consumes them,
    // so the backlog can re-play the clip by ref (with the same silence trim) later.
    const voiceRef = this.pendingVoice?.ref
    const voiceOffset = this.pendingVoice?.offset
    // `yuki(angry): ...` swaps the face automatically when the sprite is visible
    if (node.speaker && node.face) await this.showActor(node.speaker, node.face, {}, true)
    this.stage.focusChar(node.speaker ?? null)
    const actor = node.speaker ? this.actors[node.speaker] : undefined
    this.stage.setName(this.actorName(actor, node.speaker), actor?.color, actor?.textColor)
    this.stage.showDialog(true)
    this.fire('onDialogue', node)

    // A [voice ...] right before this line plays alongside the text. The
    // typewriter keeps its fixed textSpeed; the clip just mutes the synth blip.
    this.startPendingVoice(gen)

    // Resolve text at display time (not parse time) so a language switch can
    // re-render this line from the new catalog; literal lines keep their segments.
    const segments = this.displaySegments(node.segments, node.textKey)
    const readKey = this.readKeyOf(this.resumeIndex)
    const wasRead = this.readSet.has(readKey)
    // An unread line never matches skip-mode's read set: the marker keeps it so.
    const parkedKey = wasRead ? readKey : `\u0000${readKey}`
    const textLen = segments.reduce((n, s) => n + (s.kind === 'text' ? s.text.length : 0), 0)
    const pos = this.pos
    const ended = await this.typeLine(segments, node.speaker, parkedKey, textLen, node)
    // A load() while this line was typing bumps the generation — bail before
    // parking on waitAdvance so we never steal the new loop's advance resolver.
    if (gen !== this.generation) return
    // A click ran [jump] / [call] while the line was typing (runInline): play
    // goes on from there, this line neither finishes nor parks.
    if (this.pos !== pos) return
    // The line is fully shown in the CURRENT session (the guard above dropped stale
    // frames, so a mid-type load can't leak into a fresh, reset backlog) — record it.
    this.recordBacklog(this.actorName(actor, node.speaker) ?? '', segments, voiceRef, voiceOffset, actor ? node.speaker : undefined)
    this.markRead(this.resumeIndex)
    this.fire('onDialogueDone', node)
    this.parkedReadKey = parkedKey
    // `ended`: a language switch on a {p} page shrank the line and the tap that
    // turned the page already ended it — no second park.
    if (ended) return
    this.stage.showIndicator(true)
    this.shown = { kind: 'dialogue', node } // park for in-place language switch
    await this.waitAdvanceOrAuto(this.parkedReadKey, textLen)
    this.shown = null
    this.stage.showIndicator(false)
  }

  /** Start the queued per-line voice (if any), seeking past its `offset` seconds
   *  of leading silence. Plays alongside the typewriter (which keeps its fixed
   *  textSpeed) and sets voicePlaying so voicefx mutes the synth blip. */
  private startPendingVoice(gen: number): void {
    const pv = this.pendingVoice
    this.pendingVoice = null
    if (!pv) return
    this.audio.playVoice(this.resolve(pv.ref), pv.offset, () => gen === this.generation)
  }

  /** Type one line through the renderer, owning the pacing policy: the live text
   *  speed, the tap-to-skip flag, and the session guard. */
  private async typeLine(segments: Segment[], speaker?: string, readKey = '', textLen = 0, node?: DialogueNode): Promise<boolean> {
    const gen = this.generation
    const pos = this.pos
    this.typing = true
    this.skipTyping = false
    const ended = await this.stage.typeLine(segments, {
      cps: () => this.textSpeed,
      // A tap, or skip mode over a line it may pass (read, or anything in `all`).
      skip: () => this.skipTyping || this.lineSkipActive(),
      // …or a click (a hotspot, a panel button) moved the playhead meanwhile.
      alive: () => this.running && gen === this.generation && this.pos === pos,
      onReveal: (span, effect) => {
        if (effect) this.applyTextEffect(effect, span)
        if (this.host.hasListeners('onReveal')) this.fire('onReveal', span.char, span.index, speaker)
      },
      // A page break parks like the end of a line — tap, auto or skip turns the
      // page — but the voice clip plays on across pages.
      onPage: async () => {
        this.typing = false
        this.stage.showIndicator(true)
        if (node) this.shown = { kind: 'dialogue', node, paged: true } // parked inside the line: a language switch repaints this page
        await this.waitAdvanceOrAuto(readKey, textLen, false)
        this.shown = null
        this.stage.showIndicator(false)
        this.typing = true
        this.skipTyping = false
      },
    })
    this.typing = false
    return ended
  }

  /** Run one inline text effect on a revealed span. Unknown → one `exec`
   *  diagnostic; a throwing effect is reported against its plugin and the
   *  character stays revealed (an effect can never break a line). */
  private applyTextEffect(effect: string, span: TextSpan): void {
    const owned = this.host.textEffect(effect)
    if (!owned) {
      this.report({ phase: 'exec', message: `unknown text effect {${effect}:...} — missing a [use ...]?` }, true)
      return
    }
    const ctx = this.host.contextOf(owned.owner)
    if (!ctx) return
    try {
      owned.value(span, span.index, ctx)
    } catch (err) {
      this.report({ phase: 'plugin', plugin: owned.owner, message: `text effect {${effect}} failed: ${errMsg(err)}`, error: err }, true)
    }
  }

  private async execChoices(node: ChoicesNode): Promise<void> {
    const gen = this.generation
    if (this.pendingTrans) {
      await this.commitTransition()
      if (gen !== this.generation) return
    }
    const scope = this.scope()
    const items = node.items.filter((it) => !it.cond || truthy(evalExpr(it.cond, scope)))
    if (!items.length) return
    this.stage.showIndicator(false)
    const onSpan = (span: TextSpan, effect: string | undefined): void => {
      if (effect) this.applyTextEffect(effect, span)
    }
    const cfg = this.choicesConfig
    const taken = cfg.chosenStyle === 'dim' ? this.globals['sys.chosen'] : undefined
    const views: ChoiceView[] = items.map((it) => ({
      segments: this.displaySegments(parseSegments(this.choiceText(it))),
      disabled: it.disabled ? truthy(evalExpr(it.disabled, scope)) : false,
      chosen: Array.isArray(taken) && taken.includes(choiceKey(it)),
    }))
    if (views.every((v) => v.disabled)) {
      this.report({ phase: 'exec', message: 'every option of this prompt is disabled — shown enabled so the story can go on', line: node.line, node }, true)
      for (const v of views) v.disabled = false
    }
    const over = this.nextChoices ?? {}
    this.nextChoices = null
    const timer = over.timer ?? cfg.timer
    const timerDefault = over.timerDefault ?? cfg.timerDefault
    const prompt = this.stage.showChoices(views, onSpan, {
      timer: timer && timer > 0 ? timer : undefined,
      timeoutIndex: timerDefault !== undefined ? timerDefault - 1 : undefined,
    })
    // A load() during this prompt cancels it (null) to unwind this frame.
    this.choiceResolve = () => prompt.cancel()
    this.shown = { kind: 'choices', node, prompt } // park for in-place language switch
    this.fire('onChoices', items, prompt.handles)
    const picked = await prompt.chosen
    this.choiceResolve = null
    this.shown = null
    // A load() restarted us — bail before touching the (now restored) stage.
    if (gen !== this.generation || picked === null) return
    this.stage.hideChoices()
    const item = items[picked]!
    // `sys.chosen` remembers every option ever taken, by its target label (its
    // text when it has none) — `has(sys.chosen, 'secret')` in a later run.
    this.addToGlobalSet('sys.chosen', choiceKey(item))
    this.fire('onChoose', item, picked)
    if (item.target) await this.jump(item.target)
  }
}

/** What `sys.chosen` records for an option: its target label, else its key or text. */
function choiceKey(item: ChoiceItem): string {
  return item.target || item.textKey || item.text
}

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options)
}
