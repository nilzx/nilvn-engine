import type { Engine, SaveState } from './engine.js'
import type { SaveStore } from './save-store.js'
import type { AnimOpts, ChoiceHandle, ObjectBand, Renderer, TransformKeyframe, TransformProp, TransformValue } from './renderer/types.js'
import type { DecodedFrame, DecodedTrack } from './keyframes.js'
import type { SavedLoop } from './loop-runtime.js'
import type { TrackOptions } from './audio-bus.js'
// Chunked-streaming contract + plugin manifest v2. Type-only
// import: verbatimModuleSyntax + `import type` ⇒ esbuild erases it, so the prebuilt
// IIFE carries zero @nilvn/core runtime code; only tsc resolves these. The engine is
// the CONSUMER of the same manifest the editor produces, so both reference core's
// single definition.
import type { ChunkManifest, ContentLoader, Permission, PluginManifest } from '@nilvn/core'
export type { Permission, PluginManifest } from '@nilvn/core'

/** Actor metadata declared via [actor id name=... color=... sprites=path/{face}.png] */
export interface ActorDef {
  name?: string
  /** Catalog key for the display name. When set and the engine has catalogs, the
   *  name is resolved from the current language at render time (so it follows a
   *  language switch); otherwise `name` is used. */
  nameKey?: string
  /** Name-tag BACKGROUND colour (the theme's `name-bg` when absent). */
  color?: string
  /** Name-tag TEXT colour (the theme's `name-color` when absent). */
  textColor?: string
  /** Sprite URL template; `{face}` is replaced by the current face name */
  sprites?: string
  defaultFace?: string
  /** Layered sprite: the shared canvas the layers align on, in image pixels
   *  (`[600, 1100]`). Layers whose images are cropped position by `offset`
   *  within it; a full-size layer image needs no offset. */
  canvas?: [number, number]
  /** Layered sprite: named layers composed bottom to top in declaration order.
   *  `face` is the layer `[char id face]` / `speaker(face):` drive; the others
   *  change through `[char id body=casual extra=blush]`. Wins over `sprites`. */
  layers?: Record<string, ActorLayerDef>
  /** @deprecated (0.15) — a plugin's actor field: the engine moves it into
   *  `ext['app.nilvn.voicefx'].voice` once that plugin's manifest declares the
   *  field (`contributes.actorFields`); read through `ctx.actorField()`. */
  voice?: number
  /** Plugin-declared fields by plugin id (`contributes.actorFields`): what an
   *  `[actors.<id>]` table or an `[actor …]` line carried for that plugin. */
  ext?: Record<string, Record<string, unknown>>
}

/** One layer of a layered sprite (`ActorDef.layers`). */
export interface ActorLayerDef {
  /** Image path template; `{<layer name>}` is replaced by the layer's value
   *  (`"@char/yuki/face-{face}.png"`). */
  src: string
  /** The value used until a command sets one. */
  default?: string
  /** Where a cropped layer image sits on the canvas, in canvas pixels. */
  offset?: [number, number]
  /** An optional layer is left out when it has no value (`extra=none` clears it). */
  optional?: boolean
}

/** A piece of dialogue text produced by inline markup like {wave:hi} or {w:0.5} */
export type Segment =
  | { kind: 'text'; text: string; effect?: string }
  | { kind: 'pause'; sec: number }
  | { kind: 'br' }
  /** `{p}` — a page break: the text so far waits for a tap, then the box clears. */
  | { kind: 'page' }

export interface ChoiceItem {
  text: string
  /** Catalog key for the label; resolved from the current language at render
   *  time when set, otherwise `text` (a literal) is used. */
  textKey?: string
  target: string
  /** Optional condition expression; the choice is hidden when falsy */
  cond?: string
  /** Optional condition expression; the choice is shown greyed and unpickable when truthy. */
  disabled?: string
}

export interface DialogueNode {
  type: 'dialogue'
  speaker?: string
  face?: string
  /** Literal text segments. Empty when `textKey` is set — then the text is
   *  resolved from the current language catalog at display time instead. */
  segments: Segment[]
  /** Catalog key for the line text; enables runtime language switching. */
  textKey?: string
  line: number
}

/** One played dialogue/narration line, kept in the engine's session-only backlog
 *. `text` and `speaker` are the display values captured at play
 *  time in `lang` — the entry is a language-stamped snapshot, not re-localized on a
 *  later switch. `voiceRef` is the raw `[voice ...]` asset ref (NOT a resolved URL),
 *  so replay re-resolves it by ref even after its source chunk was released. Never
 *  persisted in a SaveState. */
export interface BacklogEntry {
  speaker: string
  /** The speaking actor's id (when the line named a declared actor), so the
   *  backlog can draw the name in that actor's colours. */
  actor?: string
  text: string
  voiceRef?: string
  /** Leading-silence trim (seconds) from `[voice … offset=]`, so replay seeks the
   *  same as live play. Only set alongside `voiceRef`. */
  offset?: number
  lang: string
}

export interface CommandNode {
  type: 'command'
  name: string
  args: string[]
  params: Record<string, string>
  /** Raw inner text of the tag, including the command name */
  raw: string
  line: number
}

export interface LabelNode {
  type: 'label'
  name: string
  line: number
}

export interface ChoicesNode {
  type: 'choices'
  items: ChoiceItem[]
  line: number
}

export type ScriptNode = DialogueNode | CommandNode | LabelNode | ChoicesNode

export type AnimateFn = (
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options?: number | KeyframeAnimationOptions,
) => Promise<void>

/** Everything a plugin's script command gets to work with (plugin platform v2):
 *  the parsed tag plus the owning plugin's capability context. Nothing here
 *  reaches the engine or the DOM — stage / audio / vars come through
 *  `ctx.plugin.*`, present exactly when the plugin declared (and was granted)
 *  the matching permission. */
export interface CommandContext {
  name: string
  /** Positional arguments, e.g. [shake 12] -> ['12'] */
  args: string[]
  /** Named parameters, e.g. [shake strength=12] -> { strength: '12' } */
  params: Record<string, string>
  /** Raw tag text including the command name (useful for free-form commands) */
  raw: string
  /** Get an argument by index (positional) or key (named) */
  str<D extends string | undefined = undefined>(key: string | number, def?: D): string | D
  /** Numeric argument; `def` (default 0) when absent or not a number. */
  num(key: string | number, def?: number): number
  /** Numeric argument, or undefined when absent / not a number — for params whose
   *  absence must leave a value untouched (a birth pose an effect changed). */
  numOpt(key: string | number): number | undefined
  /** Resolve a path relative to the script's base URL */
  resolve(path: string): string
  wait(sec: number): Promise<void>
  /** The owning plugin's capability context. */
  plugin: PluginContext
}

/** The context the engine's own built-in commands run with: the plugin surface
 *  plus the engine itself (built-ins ARE engine code). Never handed to a plugin —
 *  exported only because `builtins` (public) is typed against it. Deliberately NOT
 *  marked internal: stripInternal would leave the shipped builtins.d.ts dangling. */
export interface BuiltinContext extends CommandContext {
  engine: Engine
  stage: Renderer
  /** WAAPI helper that resolves when the animation finishes */
  animate: AnimateFn
}

export type CommandFn = (ctx: CommandContext) => void | Promise<void>

/** A semantic handle to one revealed character span, handed to text effects in
 *  place of the raw `HTMLElement`. Sealing this DOM leak (batch 3 inc. 2a) lets a
 *  non-DOM dialogue renderer satisfy the same contract. The five bundled effects
 *  (and custom ones) only ever tag the span with their own CSS class declared in
 *  the plugin's `styles`; the styling itself lives in CSS, keyed off the class. */
export interface TextSpan {
  /** Zero-based index of this character within the line (drives staggering). */
  readonly index: number
  /** The single character this span renders. */
  readonly char: string
  /** Apply a CSS class (declared in the plugin's `styles`) to this character. */
  addClass(name: string): void
}

/** Called for each revealed character span of a dialogue line. `ctx` is the
 *  owning plugin's capability context. */
export type TextEffectFn = (span: TextSpan, index: number, ctx: PluginContext) => void

// ---- object kinds & effects ----

/** A scoped, renderer-clean handle to one stage object, handed to an effect's
 *  `apply`. The constrained surface an effect operates through: the fixed
 *  transform schema + keyframe animation, addressed at one object — no DOM, no
 *  raw engine. (In 2a the effect still also receives a `CommandContext` escape
 *  hatch; tightening to handle-only is a future constraint —) */
export interface StageObjectHandle {
  /** Full object id, e.g. `character:yuki`, `camera`, `screen`. */
  readonly id: string
  /** The object's kind id (`character` / `camera` / `screen` / …). */
  readonly kind: string
  /** Read a resting transform prop (undefined if off this kind's schema). */
  get(prop: TransformProp): TransformValue | undefined
  /** Set a transform prop immediately. */
  set(prop: TransformProp, value: TransformValue): void
  /** Animate this object's transform through keyframes, resolving on finish. */
  animate(keyframes: TransformKeyframe[], opts: AnimOpts): Promise<void>
  /** Read the object's z-band, or undefined if its kind isn't bandable. */
  getBand(): ObjectBand | undefined
  /** Move the object between fixed z-bands. */
  setBand(band: ObjectBand): void
  /** Read the object's current face name, or undefined for faceless kinds. */
  getFace(): string | undefined
  /** Swap the object's face (instant); no-op for faceless kinds. */
  setFace(face: string): void
}

/** Parameters an invoking command parses out and hands to an effect. */
export type EffectParams = Record<string, string | number | boolean>

/** An effect's implementation: a named, reusable operation bound to one or more
 *  object kinds. Receives the target object's handle, parsed params, and the
 *  OWNING plugin's capability context (an effect runs with its owner's grants,
 *  whichever plugin's command invoked it). Most effects touch only the handle;
 *  screen-level ones reach the renderer through `ctx.stage` (e.g. `flash`). */
export type EffectFn = (handle: StageObjectHandle, params: EffectParams, ctx: PluginContext) => void | Promise<void>

export interface EffectDef {
  /** Object kinds this effect can be applied to. An effect
   *  works on any object of these kinds, regardless of which plugin created it. */
  appliesToKinds: string[]
  apply: EffectFn
}

/** A recordable channel's value: a number (continuous channels), or a string /
 *  boolean (discrete channels). Mirrors core's `ChannelValue`. */
export type RecordableValue = number | string | boolean

/** One mutable channel of an object kind that a recording event-frame can
 *  key. Each kind declares its full recordable set, and
 *  the recorder / player consume whatever is declared — so a new object type or
 *  property becomes keyframable with no recorder change ("dynamic extraction").
 *  - `continuous`: numeric, interpolated between keyframes (x / scale / …).
 *  - `discrete`: snapped at the keyframe time, no interpolation (visible / face).
 *  `read` captures the current value (recorder, kf0); `apply` writes a value
 *  (player, scrub). Both operate only through the scoped object handle. */
export interface RecordableProp {
  /** Channel id; also the wire id used by the `[eventframe]` encoding. */
  id: string
  /** Stable i18n id for the channel (`channel.x` …), optional; hosts render it
   *  through their own catalogs — the engine ships no display strings here. */
  label?: string
  mode: 'continuous' | 'discrete'
  read(handle: StageObjectHandle): RecordableValue | undefined
  apply(handle: StageObjectHandle, value: RecordableValue): void
}

/** The engine's standard recordable channels, declarable by name in an
 *  {@link ObjectKindDecl}: the five continuous transform channels, and the
 *  discrete visibility / face / z-band channels. A plugin kind that says
 *  `recordable: ['x', 'y', 'scale', 'rotation', 'opacity', 'visible', 'band']`
 *  gets the same descriptors the built-in kinds use, with no engine import. */
export type StandardChannel = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'visible' | 'face' | 'band'

/** An object kind as a plugin (or the engine) DECLARES it: `recordable` may name
 *  standard channels by id next to custom descriptors; the host resolves the
 *  names into {@link RecordableProp}s at registration (→ {@link ObjectKind}). */
export interface ObjectKindDecl {
  id: string
  label?: string
  transformable: boolean
  recordable?: (RecordableProp | StandardChannel)[]
}

/** An addressable stage-object type contributed by the engine or a plugin. The
 *  runtime contract (2a), as REGISTERED — every recordable channel resolved to a
 *  descriptor. The editor-facing declarative metadata (label / icon /
 *  `ParamSchema` kind-props) is layered on in 2b — kept out of the engine so it
 *  stays dependency-free. */
export interface ObjectKind {
  /** Unique kind id, e.g. `character`. */
  id: string
  /** Stable i18n id for the kind (`objectKind.character` …), optional; the
   *  editor renders core's schema labels, never this string directly. */
  label?: string
  /** Whether this kind honors the fixed transform schema (renderable). Non-
   *  positional UI kinds (dialogue / choices) set this false. */
  transformable: boolean
  /** Channels a recording event-frame can key on objects of this
   *  kind. Add-only; absent = nothing recordable. */
  recordable?: RecordableProp[]
}

/** Where a diagnostic was raised. */
export type DiagnosticPhase = 'parse' | 'load' | 'exec' | 'jump' | 'plugin'

/** One reported content problem. The engine never throws on CONTENT — it reports
 *  here (EngineHooks.onError / EngineOptions.onError / engine.diagnostics) and
 *  degrades: a bad line is skipped, a missing plugin's commands become no-ops, an
 *  unknown jump target stays in place, a chunk that fails to load ends the script
 *  cleanly. Host programming errors (no script AND no package at start()) still throw. */
export interface EngineDiagnostic {
  phase: DiagnosticPhase
  message: string
  /** Script line (1-based) when known — parse / exec / jump. */
  line?: number
  /** The node that was executing (exec / jump). */
  node?: ScriptNode
  /** Owning plugin (plugin phase, or the exec of a plugin-contributed command). */
  plugin?: string
  /** Chunk id (load phase). */
  chunk?: string
  /** The underlying exception, when one was thrown. */
  error?: unknown
}

/** Where the session is: nothing running (`idle`), on the title screen, playing,
 *  or on an ending screen. */
export type SessionState = 'idle' | 'title' | 'playing' | 'ending'

/** What `onSettingsChange` reports: the typewriter speed, a channel volume,
 *  the language, the auto / skip modes and their tuning, the chrome sliders. */
export type SettingKey = 'textSpeed' | `volume:${VolumeChannel}` | 'lang' | 'auto' | 'skip' | 'autoDelay' | 'skipMode' | 'dialogOpacity' | 'uiScale'

export interface EngineHooks {
  /** Content and plugins are in place (once per engine): a host may show its
   *  title screen. Fired by `prepare()` — which `start()` calls first. */
  onReady?: (ctx: PluginContext) => void
  /** The session moved between idle / title / playing / ending. */
  onSessionChange?: (state: SessionState, prev: SessionState, ctx: PluginContext) => void
  /** The playhead reached a `[label]` (by falling through, a jump, or a start
   *  at it) — the anchor for chapter tracking, achievements, galleries. */
  onLabel?: (label: string, ctx: PluginContext) => void
  onDialogue?: (node: DialogueNode, ctx: PluginContext) => void
  onDialogueDone?: (node: DialogueNode, ctx: PluginContext) => void
  /** Fired as each character is revealed by the typewriter (e.g. voice blips) */
  onReveal?: (char: string, index: number, speaker: string | undefined, ctx: PluginContext) => void
  /** A choices prompt was shown: one sealed handle per visible option (style /
   *  stagger an entrance — never the element). */
  onChoices?: (items: ChoiceItem[], choices: ChoiceHandle[], ctx: PluginContext) => void
  /** The player picked an option (before the engine follows its target). */
  onChoose?: (item: ChoiceItem, index: number, ctx: PluginContext) => void
  /** A command is about to run (built-in or plugin): its name and parsed tag. */
  onCommand?: (name: string, args: readonly string[], params: Readonly<Record<string, string>>, ctx: PluginContext) => void
  onEnd?: (ctx: PluginContext) => void
  /** `saveState()` produced a snapshot (a slot UI is about to persist it). */
  onSaved?: (state: SaveState, ctx: PluginContext) => void
  /** `restoreState()` accepted a snapshot and play resumed from it. */
  onRestored?: (state: SaveState, ctx: PluginContext) => void
  /** A player setting changed: text speed, a channel volume, the language. */
  onSettingsChange?: (key: SettingKey, value: number | string, ctx: PluginContext) => void
  /** A script variable was written (`[set]`, `vars.set`). A restore replaces the
   *  whole table silently — read `vars.all()` in `onRestored`. */
  onVarChange?: (name: string, value: unknown, ctx: PluginContext) => void
  /** One asset of a preload batch finished (`done` of `total`; `ref` is the asset). */
  onPreload?: (done: number, total: number, ref: string, ctx: PluginContext) => void
  /** A content problem was reported (see EngineDiagnostic). Never fired for a
   *  problem inside an onError hook itself. */
  onError?: (info: EngineDiagnostic, ctx: PluginContext) => void
}

// ---- plugin platform v2 ----

export type VolumeChannel = 'bgm' | 'ambience' | 'se' | 'voice'

/** The stage capability (`stage.read` / `stage.write`). Read verbs are always
 *  real once either permission is held; with only `stage.read` the write verbs
 *  are degraded stubs (one `plugin` diagnostic, no effect) — a plugin never gets
 *  an exception for a permission it lacks, it gets nothing. The dialogue layer
 *  (typeLine / choices) and the renderer's lifecycle are NOT part of this surface. */
export interface StageCap
  extends Pick<
    Renderer,
    | 'hasObject'
    | 'getProp'
    | 'getBand'
    | 'getFace'
    | 'hasChar'
    | 'charFace'
    | 'snapshot'
    | 'setBackground'
    | 'showChar'
    | 'moveChar'
    | 'hideChar'
    | 'clearChars'
    | 'focusChar'
    | 'showSprite'
    | 'hideSprite'
    | 'clearSprites'
    | 'setProp'
    | 'animate'
    | 'setBand'
    | 'setFace'
    | 'setName'
    | 'showDialog'
    | 'showIndicator'
    | 'setWindowSkin'
    | 'fadeScreen'
    | 'transitionScreen'
    | 'flash'
  > {
  /** Apply a registered effect (any plugin's) to a stage object — see Engine.applyEffect. */
  applyEffect(name: string, objId: string, params: EffectParams): Promise<void>
  /** Show a character (or update its face / slot) through the actor sprite table. */
  showActor(id: string, face?: string, opts?: { at?: string; fade?: number; src?: string; y?: number; scale?: number; rotation?: number }): Promise<void>
  /** Play a recording event-frame to completion (blocking). `tracks` is either
   *  decoded, or the `kf` wire token as the serializer writes it
   *  (`obj#t:ch=v,…;t~ease:…|obj2#…`) — the engine owns the codec. */
  playFrames(durationSec: number, tracks: DecodedTrack[] | string): Promise<void>
  /** Abort an in-flight event-frame without touching running loops. */
  stopFrames(): void
  /** Begin (or replace) a single-element loop on an object (non-blocking).
   *  `entry` / `body` accept the wire forms (`ch=v,…` / `t:ch=v;…`). */
  startLoop(objId: string, durationSec: number, entry: Record<string, string> | string, body: DecodedFrame[] | string, intoEase?: string, bridge?: boolean): void
  /** Stop the loop running on `objId`, settling it to `exit` (a channel set or
   *  its `ch=v,…` wire form). */
  stopLoop(objId: string, exit: Record<string, string> | string, outEase?: string): void
  /** The defining data of every loop running now. */
  runningLoops(): SavedLoop[]
}

/** `audio.play`. */
export interface AudioCap {
  playTrack(track: string, url: string, opts?: TrackOptions): void
  stopTrack(track: string, fadeSec?: number): void
  stopAllTracks(fadeSec?: number): void
  playSe(url: string, volume?: number): void
  /** The user master volume of a channel (0..1). */
  volume(channel: VolumeChannel): number
  /** True while a real per-line voice clip is playing (synth blips yield to it). */
  readonly voicePlaying: boolean
}

/** `vars.read` (+ `vars.write` for `set`; without it `set` is a degraded stub). */
export interface VarsCap {
  get(name: string): unknown
  has(name: string): boolean
  all(): Readonly<Record<string, unknown>>
  set(name: string, value: unknown): void
}

/** `session.save`: the finished-game shell's save / load / restart. */
export interface SavesCap {
  saveState(): SaveState
  restoreState(state: SaveState): Promise<boolean>
  restart(): Promise<void>
  /** Per-work id to namespace persisted saves / settings by. */
  readonly saveKey: string | undefined
  /** The tool version that produced the loaded work. */
  readonly buildInfo: string | undefined
}

/** `session.settings`: text speed, channel volumes, language. */
export interface SettingsCap {
  textSpeed: number
  getVolume(channel: VolumeChannel): number
  /** Set a channel's master volume (0..1) and re-apply it to what's playing. */
  setVolume(channel: VolumeChannel, value: number): void
  readonly lang: string
  readonly languages: readonly string[]
  /** Display name of a language code for a switcher (its native name, e.g. `ja` → 日本語); the code
   *  itself when the engine knows no name. */
  languageName(lang: string): string
  setLanguage(lang: string): Promise<void>
  /** Subscribe to language switches; disposed with the plugin. */
  onLanguageChange(fn: (lang: string) => void): () => void
  /** Resolve a content catalog key in the current language. */
  resolveText(key: string): string
}

/** `session.backlog`: the dialogue history and voice replay. */
export interface BacklogCap {
  entries(): BacklogEntry[]
  replayVoice(ref: string, offset?: number): Promise<void>
}

export interface ReplayDef {
  id: string
  title: string
  label: string
}

/** `session.replay`: A–B replay segments. */
export interface ReplayCap {
  list(): ReplayDef[]
  isReplaying(): string | null
  play(segId: string): Promise<boolean>
  /** The segment being replayed is over (its end marker). */
  end(): void
  /** Normal play passed a segment's end marker — fire the unlock signal. */
  fireSeen(segId: string): void
  /** Subscribe to the unlock signal; disposed with the plugin. */
  onSeen(fn: (segId: string) => void): () => void
  /** Install the orchestrator for a replay's end (null to clear); cleared on dispose. */
  onEnd(fn: (() => void) | null): void
}

/** `ui.layer`: host containers inside the stage root, removed on dispose. Same-
 *  realm first-party plugins receive the element itself; a sandboxed plugin
 *  would receive a container id. */
export interface UiCap {
  layer(className?: string): HTMLElement
  /** Listen to input on the stage surface (the wheel-to-open-backlog affordance);
   *  removed on dispose. */
  onStage<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions | boolean): () => void
}

/** Always present (no permission): the effective theme overrides — the
 *  `--nilvn-*` token contract (`THEME_TOKENS` has the defaults). Plugin CSS
 *  draws with `var(--nilvn-…)` rather than colour literals so it follows the
 *  work's theme; `get` / `onChange` are for plugins that paint in JS. */
export interface ThemeCap {
  /** An override's value, or undefined when the token is at its default. */
  get(token: string): string | undefined
  /** Every override (base + script layer). */
  all(): Readonly<Record<string, string>>
  /** Subscribe to theme changes (either layer); disposed with the plugin. */
  onChange(fn: (theme: Readonly<Record<string, string>>) => void): () => void
}

/** `storage.local`: a key-value store namespaced per work AND plugin (the
 *  engine's SaveStore underneath — localStorage by default, a shell's own file
 *  store when it substitutes one). Async, JSON values. */
export interface StorageCap {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** Always present (no permission): the plugin's own settings, resolved
 *  schema default ← the author's `[plugins.<id>]` value ← the player's value
 *  (a `scope: player` field the player changed in the settings panel). */
export interface ConfigCap {
  get<T = unknown>(key: string): T | undefined
  all(): Readonly<Record<string, unknown>>
  /** A value changed (the host / the settings panel); disposed with the plugin. */
  onChange(fn: (key: string, value: unknown) => void): () => void
}

/** `ui.screen`: full-stage screens and chrome entries — everything a plugin adds
 *  to the finished game's shell. Each registration is released on dispose. */
export interface ScreenCap {
  /** Open a full-stage panel (the same chrome as the backlog / settings): `render`
   *  fills its body; Esc or the close button closes it. One plugin screen at a time. */
  open(id: string, title: string, render: (body: HTMLElement, close: () => void) => void): void
  close(id?: string): void
  /** Wire a `contributes.menuItems` entry (its label comes from the manifest). */
  menuItem(id: string, onSelect: () => void): () => void
  /** Wire a `contributes.titleItems` entry: a button on the title page. */
  titleItem(id: string, onSelect: () => void): () => void
  /** A `contributes.hud` widget's container in its corner (shown while playing). */
  hud(id: string): HTMLElement
}

/** `ui.dialog`: in-engine boxes, never the browser's. */
export interface DialogCap {
  confirm(message: string): Promise<boolean>
  alert(message: string): Promise<void>
  /** A one-line text box (what `[input]` shows): the trimmed text on OK, `null`
   *  on cancel. `pattern` is a regular expression the whole value must match. */
  prompt(message: string, opts?: { default?: string; maxlength?: number; pattern?: string }): Promise<string | null>
  toast(message: string): void
}

/** `timer`: timers and frames, all cleared on dispose. */
export interface TimerCap {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
  setInterval(fn: () => void, ms: number): number
  clearInterval(id: number): void
  requestAnimationFrame(fn: (t: number) => void): number
  cancelAnimationFrame(id: number): void
}

/** What a plugin gets instead of the engine: its identity, a few read-only facts,
 *  disposable registration, and one capability object per GRANTED permission
 *  (undefined otherwise — a denied capability is absent, never an exception).
 *  Everything registered through the context is released by the host when the
 *  plugin is deactivated, which is what makes hot-plugging deterministic. */
export interface PluginContext {
  readonly id: string
  /** Permissions the host actually granted. */
  readonly permissions: readonly Permission[]
  /** The work's current content language. */
  readonly lang: string
  /** The actor table (read-only view). */
  readonly actors: Readonly<Record<string, ActorDef>>
  /** Resolve a resource path (aliases / by-ref asset table / base URL). */
  resolve(path: string): string
  /** A chrome string: the plugin's own `messages` first, then the engine's
   *  catalog, in the work's language. `{name}` placeholders are filled from `params`. */
  t(id: string, params?: Record<string, string | number>): string
  /** Report a problem as a `plugin` diagnostic attributed to this plugin. */
  report(message: string, error?: unknown): void
  /** Add an event listener that is removed on dispose. Returns the remover. */
  listen(target: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions | boolean): () => void
  /** Run `fn` when the plugin is deactivated. */
  onDispose(fn: () => void): void
  // ---- dynamic registration (the declarative module fields are registered the same way) ----
  registerCommand(name: string, fn: CommandFn): void
  registerTextEffect(name: string, fn: TextEffectFn): void
  registerEffect(name: string, def: EffectDef): void
  registerKind(kind: ObjectKindDecl): void
  on<K extends keyof EngineHooks>(hook: K, fn: NonNullable<EngineHooks[K]>): () => void
  /** Inject a stylesheet, removed on dispose. */
  addStyle(css: string): void
  /** The work's theme overrides (no permission needed). */
  readonly theme: ThemeCap
  /** This plugin's settings (no permission needed; see `contributes.config`). */
  readonly config: ConfigCap
  /** A plugin-declared actor field (`contributes.actorFields`) for `actorId`;
   *  undefined when absent. No permission needed. */
  actorField(actorId: string, key: string): unknown
  // ---- capability objects, present iff granted ----
  readonly stage?: StageCap
  readonly audio?: AudioCap
  readonly vars?: VarsCap
  readonly saves?: SavesCap
  readonly settings?: SettingsCap
  readonly backlog?: BacklogCap
  readonly replay?: ReplayCap
  readonly ui?: UiCap
  readonly timer?: TimerCap
  readonly storage?: StorageCap
  readonly screen?: ScreenCap
  readonly dialog?: DialogCap
}

/** The runtime half of a plugin (plugin platform v2). Declarative contributions
 *  (commands / text effects / kinds / effects / hooks / styles) are registered by
 *  the host on activation and released on deactivation; `activate` / `deactivate`
 *  bracket whatever else the plugin acquires, through the context only. */
export interface EnginePlugin {
  /** Reverse-DNS id (`app.nilvn.textfx`). Must equal the manifest's when one accompanies the module. */
  id: string
  /** Capabilities the runtime half needs. Authoritative when no manifest accompanies
   *  the module; must equal the manifest's `permissions` when one does. */
  permissions?: Permission[]
  version?: string
  dependencies?: Record<string, string>
  activation?: 'eager' | 'onCommand' | 'manual'
  reload?: 'hot' | 'restart'
  /** CSS injected while the plugin is active. */
  styles?: string
  /** New script commands: [myCommand ...] */
  commands?: Record<string, CommandFn>
  /** Text effects usable inline as {name:text} */
  textEffects?: Record<string, TextEffectFn>
  /** New addressable object kinds. */
  objectKinds?: ObjectKindDecl[]
  /** Named effects bound to kinds via `appliesToKinds`. */
  effects?: Record<string, EffectDef>
  hooks?: EngineHooks
  /** Called once per activation (install, enable, reload). May be async; a
   *  rejection isolates the plugin. */
  activate?(ctx: PluginContext): void | Promise<void>
  /** Called before the host disposes everything registered through `ctx`. */
  deactivate?(ctx: PluginContext): void
  /** Save-state slice (needs `save.slice`): a non-undefined return is stored
   *  under `SaveState.ext[id]`. Keep it JSON-serializable. */
  saveState?(ctx: PluginContext): unknown
  /** Restore this plugin's `ext[id]` slice, AFTER the stage is restored and before
   *  play resumes. A slice whose plugin is not active is carried through untouched. */
  restoreState?(ctx: PluginContext, data: unknown): void
}

/** Host seam for loading plugins by URL — a `plugin.json` package or a bare
 *  module. The default uses `fetch` + dynamic `import()`; a desktop shell or a
 *  sandboxing host substitutes its own. */
export interface PluginLoader {
  fetchManifest(url: string): Promise<unknown>
  importModule(url: string): Promise<unknown>
  /** Stylesheets listed in a package manifest (default: `fetch(url).text()`). */
  fetchText?(url: string): Promise<string>
}

/** What `pluginState()` reports for a registered plugin. */
export type PluginState = 'registered' | 'active' | 'isolated' | 'blocked'

export interface EngineOptions {
  container: HTMLElement
  /** Base URL for assets & plugin paths; defaults to the loaded script's directory */
  baseUrl?: string
  /** Typewriter speed in characters per second (default 40) */
  textSpeed?: number
  /** Plugins installed (activated) immediately — the host's own code, so every
   *  permission they declare is granted unless `grant` says otherwise. */
  plugins?: EnginePlugin[]
  /** Extra plugins made available to [use id] (registered, not activated). */
  registry?: EnginePlugin[]
  /** Manifests for registry / `[use]` plugins. When a plugin has one, its
   *  `permissions` / `dependencies` / `activation` are authoritative over the
   *  module's inline fields. */
  manifests?: PluginManifest[]
  /** Globally enabled plugins, auto-loaded at start() — same entries as [use ...] */
  use?: string[]
  /** Host authorization: which of a plugin's requested permissions to grant.
   *  Default = every requested permission the engine can honor. A denied
   *  capability is simply absent from the plugin's context. */
  grant?: (id: string, requested: Permission[]) => Permission[]
  /** How `[use ./x/plugin.json]` and `[use ./x.js]` fetch / import (default:
   *  `fetch` + dynamic `import()`). */
  pluginLoader?: PluginLoader
  /** Path prefix aliases applied to every resource path, e.g. { '@bg': 'assets/bg' } */
  alias?: Record<string, string>
  /** Global actor declarations, extendable in-script via [actor ...] */
  actors?: Record<string, ActorDef>
  /** Current content language. Defaults to `defaultLang`. Drives both the text
   *  resolved from `catalogs` and the engine chrome (menu) language. */
  lang?: string
  /** Fallback content language when a key is missing in the current `lang`.
   *  Defaults to 'en'. */
  defaultLang?: string
  /** Languages offered by the in-game language switcher (those that ship a
   *  catalog). The switcher is hidden when there are fewer than two. */
  languages?: string[]
  /** Localized content text: catalogs[lang][key] -> string. Values carry the
   *  same inline markup as serialized literal text ({w:..}, {wave:..}, {br}).
   *  Dialogue / choice / actor-name keys are resolved against this at runtime. */
  catalogs?: Record<string, Record<string, string>>
  /** Command macros: name -> expansion line(s), e.g. { bg_street: 'bg @bg/street.svg' } */
  macros?: Record<string, string>
  /** Per-command default params, e.g. { bg: { fade: 1 } } */
  defaults?: Record<string, Record<string, string | number | boolean>>
  /** Theme overrides (the BASE layer): token → value, e.g. `{ 'name-bg': '#0b1c2e' }`.
   *  See `THEME_TOKENS` for the contract and `[theme]` in config.md. */
  theme?: Record<string, string | number>
  /** The title page (same keys as the config's `[title]`). */
  title?: TitleConfig
  /** Ending pages by id (the config's `[ending.<id>]`). */
  endings?: Record<string, EndingConfig>
  saves?: SavesConfig
  menu?: MenuConfig
  settings?: SettingsConfig
  /** Keyboard bindings (the config's `[keys]`); see {@link KeysConfig}. */
  keys?: KeysConfig
  /** Chrome string overrides: `{ zh: { 'ui.title.new': '开始' } }`. */
  messages?: Record<string, Record<string, string>>
  /** Plugin settings by plugin id (the config file's `[plugins.<id>]` tables):
   *  `{ 'app.nilvn.voicefx': { volume: 0.5 } }`. Short first-party names work too. */
  pluginConfig?: Record<string, Record<string, unknown>>
  /** `false` = the engine draws no chrome at all (a host that owns its own,
   *  the studio's preview); per piece otherwise. Default: all on. */
  screens?: false | { title?: boolean; ending?: boolean; menu?: boolean; loading?: boolean }
  /** Where saves and settings persist (default: `localStorage`, namespaced by
   *  `saveKey`). */
  saveStore?: SaveStore
  /**
   * Virtual asset table mapping resolved paths to inline URLs (e.g. data URIs).
   * Used by single-file bundles so resources need no network fetch.
   */
  assets?: Record<string, string>
  onEnd?: () => void
  /** Content and plugins are in place (see `Engine.prepare` / `ready`). */
  onReady?: () => void
  /** The session moved between idle / title / playing / ending. */
  onSessionChange?: (state: SessionState, prev: SessionState) => void
  /** Host-level diagnostic sink (same info as the `onError` plugin hook). */
  onError?: (info: EngineDiagnostic) => void
  /** Strict mode = the editor's preview: every diagnostic is logged with
   *  console.error each time it occurs (lenient mode dedupes by message and logs
   *  a warning). Strictness never changes playback behavior — neither mode throws. */
  strict?: boolean
  /** Consecutive command failures after which a plugin is quarantined (its
   *  commands become no-ops until the engine is recreated). Default 3. */
  pluginFailureLimit?: number
  /** Per-work id the menu plugin namespaces saves / settings by. A loaded
   *  package supplies its own (`nilvn.json` saveKey); this is the fallback for
   *  script-only play. */
  saveKey?: string
  /** Tool version label shown by the menu (a package supplies its `engine`). */
  buildInfo?: string
  /** Chunked-streaming manifest. When present (with `loader`), play is
   *  chunked: scenes load on demand through the loader. Absent ⇒ today's path —
   *  the whole script is already in `this.nodes` via loadSource/load. */
  manifest?: ChunkManifest
  /** Byte source for chunked play: fetches + decodes chunks/locale slices and
   *  resolves assets by ref. The Web loader fetches static files; a future Tauri
   *  loader reads + decrypts natively. Ignored without a `manifest`. */
  loader?: ContentLoader
  /** Optional memory ceiling for chunked play: the max number of
   *  script chunks kept resident at once. When set, chunks beyond the current one +
   *  its fall-through/branch neighbourhood are evicted least-recently-used first
   *  (their node objects freed; re-parsed on demand if revisited). Undefined ⇒ no
   *  ceiling — every visited chunk stays resident (append-only), byte-identical to
   *  today. Ignored without a `manifest`+`loader`. */
  maxResidentChunks?: number
}

/** Shape of nilvn.config.toml — every section is optional */
export interface AdvConfig {
  game?: {
    /** Sets document.title when present */
    title?: string
    /** Typewriter speed in characters per second */
    textSpeed?: number
    /** Script auto-loaded by start() when none was loaded explicitly */
    entry?: string
    /** Fallback content language (`createEngine({ defaultLang })` from the file). */
    defaultLang?: string
    /** Several script files played in order, each a chunk: labels are global
     *  (a jump or call reaches any file), the files fall through in list order,
     *  saves address the file's chunk. Takes precedence over `entry`. */
    scripts?: string[]
  }
  plugins?: {
    /** Same entries as [use ...]: bundled names or JS module paths */
    use?: string[]
    /** `[plugins.<id>]` — a plugin's settings table (see `contributes.config`). */
    [pluginId: string]: string[] | Record<string, unknown> | undefined
  }
  /** Path prefix aliases, e.g. "@bg" = "assets/bg" */
  path?: Record<string, string>
  /** Actor declarations keyed by id */
  actors?: Record<string, ActorDef>
  /** Per-command default params, e.g. [defaults] bg = { fade = 1.2 } */
  defaults?: Record<string, Record<string, string | number | boolean>>
  /** Command macros: [macros] bg_street = "bg @bg/street.svg" */
  macros?: Record<string, string>
  /** Theme overrides: [theme] name-bg = "#0b1c2e" (token names without the `--nilvn-` prefix). */
  theme?: Record<string, string | number>
  /** Dialogue-box shorthand: [window] skin = "@ui/box.png", position = "top" … — sugar over `[theme]`. */
  window?: WindowConfig
  /** The title page. */
  title?: TitleConfig
  /** Ending pages by id: [ending.default] / [ending.true_end]. */
  ending?: Record<string, EndingConfig>
  saves?: SavesConfig
  menu?: MenuConfig
  settings?: SettingsConfig
  /** Keyboard bindings: [keys] auto = "a", quicksave = "F5" … */
  keys?: KeysConfig
  /** Persistent variables with their first-run defaults: [persist] player = "", runs = 0. */
  persist?: Record<string, unknown>
  /** The `[input]` command's box: skin, position, button labels. */
  input?: InputConfig
  /** The choices prompt: position, layout, skin, chosen / disabled looks, timer. */
  choices?: ChoicesConfig
  /** Assets warmed before play, and the loading page. */
  preload?: PreloadConfig
  /** Declarative panels: [ui.<id>] — a HUD or a window of data-bound widgets. */
  ui?: Record<string, UiPanelConfig>
  /** Chrome string overrides by language: [strings.zh] "ui.title.new" = "开始". */
  strings?: Record<string, Record<string, string>>
}

/** `[title]` in nilvn.config.toml — the built-in title page. */
export interface TitleConfig {
  /** `false` = the engine draws no title page (the host does; the `title` session state still exists). */
  enabled?: boolean
  /** Heading text (`@key` resolves through the catalogs). Default: `[game] title`. */
  heading?: string
  subtitle?: string
  /** An image shown above the heading. */
  logo?: string
  /** Its width (a CSS length such as `"40cqw"`; a number = px). Default: at most 70% of the stage's width. */
  logoWidth?: string | number
  /** An image path, or a CSS colour / gradient. */
  background?: string
  bgm?: string
  bgmVolume?: number
  /** Button ids in order: `new`, `continue` (shown when an autosave exists),
   *  `load`, `settings` (once those screens exist). Default `["new", "continue"]`. */
  buttons?: string[]
  layout?: 'center' | 'left' | 'right' | 'bottom'
  /** Show the tool version in a corner (default true when `buildInfo` is known). */
  version?: boolean
}

/** `[ending.<id>]` in nilvn.config.toml — an ending page (`[ending id]` / `[end]` = `default`). */
export interface EndingConfig {
  /** `false` = no page for this ending (the session still enters `ending`). */
  enabled?: boolean
  /** Default: the chrome string `ui.ending.title`. */
  heading?: string
  subtitle?: string
  background?: string
  bgm?: string
  bgmVolume?: number
  /** Rolling credits: a multi-line string or a list of lines (`@key` per line ok). */
  credits?: string | string[]
  /** Seconds the roll takes (default from the line count). */
  creditsDuration?: number
  /** What happens when the roll ends: nothing (default), back to title, or restart. */
  after?: 'title' | 'restart' | 'none'
  /** `false` hides the Back-to-title / Play-again buttons. */
  buttons?: boolean
}

/** `[saves]` in nilvn.config.toml. */
export interface SavesConfig {
  /** When the autosave (the title page's Continue) is written: at every
   *  `[label]` (default), at every line, or never. */
  autosave?: 'label' | 'line' | false
  /** Slot pages × slots per page (default 10 × 10). */
  pages?: number
  slotsPerPage?: number
  /** Show the scene background in a slot (default `bg`); `none` for text only. */
  thumbnail?: 'bg' | 'none'
}

/** `[menu]` in nilvn.config.toml — the in-game system menu. */
export interface MenuConfig {
  /** `false` = no menu (a host draws its own over `engine.saveSlot()` & co). */
  enabled?: boolean
  /** Where the ☰ entry sits; `hidden` keeps the Esc key and gestures only. */
  entry?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'hidden'
  /** Item ids in order: `save`, `load`, `quicksave`, `quickload`, `backlog`,
   *  `auto`, `skip`, `settings`, `replays`, `title`, `restart`. Default: all. */
  items?: string[]
  /** Wheel-up over the stage opens the backlog (default true). */
  wheelBacklog?: boolean
}

/** `[settings]` in nilvn.config.toml — the settings panel and the players'
 *  defaults (each is persisted per work once the player changes it). */
export interface SettingsConfig {
  /** Seconds auto mode waits after a line (plus per-character time). Default 1.5. */
  autoDelay?: number
  /** What skip mode passes: read lines only (default) or everything. */
  skipMode?: 'read' | 'all'
  /** Rows to show, in order: `textSpeed`, `autoDelay`, `skipMode`, `volumes`,
   *  `language`, `fullscreen`, `dialogOpacity`, `uiScale`. Default: all. */
  show?: string[]
  /** The text-speed slider's range in characters per second, slowest to fastest
   *  (default `[10, 100]`). One notch past the fastest is "instant" (`textSpeed = 0`). */
  textSpeedRange?: [number, number]
}

/** One key binding: a `KeyboardEvent.key` name (`a`, `F5`, `Escape`, `Space`,
 *  `Enter`, `Tab`, `Control`), optionally with `Ctrl+` / `Shift+` / `Alt+` /
 *  `Meta+` in front (`Ctrl+S`); an array binds several keys; `false` unbinds. */
export type KeyBinding = string | string[] | false

/** `[keys]` in nilvn.config.toml — the keyboard. `advance`, `menu` and `skipHold`
 *  always work; the rest are the system menu's actions and apply while the menu
 *  exists (a host that draws its own chrome binds its own keys). Defaults:
 *  `advance = ["Space", "Enter"]`, `menu = "Escape"`, `skipHold = "Control"`,
 *  `skip = "Tab"`, `auto = "a"`, `quicksave = "F5"`, `quickload = "F9"`; the
 *  others are unbound. Keys are ignored while a text field has focus. */
export interface KeysConfig {
  /** Advance the story (also ends auto / skip). */
  advance?: KeyBinding
  /** Open / close the system menu (closes the topmost panel first). */
  menu?: KeyBinding
  /** Skip while held. */
  skipHold?: KeyBinding
  /** Toggle skip mode. */
  skip?: KeyBinding
  /** Toggle auto mode. */
  auto?: KeyBinding
  quicksave?: KeyBinding
  quickload?: KeyBinding
  /** Open the backlog / save / load / settings panel. */
  backlog?: KeyBinding
  save?: KeyBinding
  load?: KeyBinding
  settings?: KeyBinding
  /** Toggle fullscreen. */
  fullscreen?: KeyBinding
}
export type KeyAction = keyof KeysConfig

/** `[input]` in nilvn.config.toml — the box the `[input]` command shows. The
 *  look keys map onto `input-*` theme tokens (config.ts `inputTheme`); the box
 *  defaults to the panel look. Every key optional. */
export interface InputConfig {
  /** Image behind the box (whole-image stretch, or nine-slice with `slice`) —
   *  clears the default panel background and border unless they are given. */
  skin?: string
  /** Nine-slice inset in image pixels (as CSS `border-image-slice`). */
  slice?: number | string
  /** How wide the nine-slice edges draw (a CSS length; default: the inset in px). */
  sliceWidth?: string | number
  /** `input-box-bg` / `input-box-border` / `input-box-radius`. */
  background?: string
  border?: string
  radius?: string | number
  /** The text field: `input-bg` / `input-color` / `input-border` / `input-radius` / `input-size`. */
  fieldBackground?: string
  fieldColor?: string
  fieldBorder?: string
  fieldRadius?: string | number
  fieldSize?: string | number
  /** Where the box sits on the stage. Default `center`. */
  position?: 'center' | 'top' | 'bottom'
  /** Button labels (`@key` resolves through the catalogs). Default: the chrome's OK / Cancel. */
  ok?: string
  cancel?: string
}

/** `[ui.<id>]` in nilvn.config.toml — a panel the engine draws from widgets. */
export interface UiPanelConfig {
  /** `hud` (default): pinned to an anchor, small; `window`: a titled box. */
  kind?: 'hud' | 'window'
  /** One of the nine anchors (`top-left` … `bottom-right`, `center`). Default:
   *  `top-left` for a HUD, `center` for a window. */
  anchor?: string
  /** When the panel shows: `playing` (default) while the story plays, `always`,
   *  or `manual` (only after `[ui show id]`). `[ui show|hide|toggle]` overrides. */
  show?: 'playing' | 'always' | 'manual'
  /** A window's title (`@key` or literal; also its menu / title-button label). */
  title?: string
  /** CSS lengths (`"40cqw"`). */
  width?: string | number
  height?: string | number
  widgets?: UiWidget[]
}

/** A widget of a `[ui.<id>]` panel. Every widget takes `if` — a condition that
 *  hides it when false. Strings resolve like config strings (`@key`, `{$var}`). */
export type UiWidget =
  /** A line of text: `text` (with `{$var}` placeholders), or a variable's value. */
  | { type: 'text'; text?: string; var?: string; if?: string }
  /** A progress bar for a numeric variable between `min` (0) and `max` (100). */
  | { type: 'bar'; var: string; max?: number | string; min?: number | string; label?: string; if?: string }
  /** An image (`src` resolves like an asset path). */
  | { type: 'image'; src: string; width?: string | number; if?: string }
  /** A list of a variable's items (a list, or a comma-separated string); `empty` when there are none. */
  | { type: 'list'; var: string; empty?: string; if?: string }
  /** A button whose click runs `onclick` — script commands, one per line. */
  | { type: 'button'; label: string; onclick: string; if?: string }

/** `[preload]` in nilvn.config.toml — what `prepare()` warms before play (the
 *  built-in loading page shows meanwhile) and what `[preload …]` does mid-story. */
export interface PreloadConfig {
  /** Asset refs to warm (paths as the script writes them: aliases resolve). */
  assets?: string[]
  /** Also warm what the loaded script references: the resident nodes' assets
   *  (in chunked play: the entry chunk's and its successors' manifest lists). */
  auto?: boolean
  /** Parallel fetches (default 4). */
  concurrency?: number
  /** Show the loading page while warming (default true; a host also has
   *  `screens.loading`). */
  screen?: boolean
  /** The loading page's heading (`@key` or literal; default `ui.loading.title`)
   *  and background (a colour, gradient or image path). */
  heading?: string
  background?: string
}

/** `[choices]` in nilvn.config.toml — the choices prompt. Look keys map onto
 *  `choice-*` tokens (config.ts `choicesTheme`); the rest is layout and behaviour. */
export interface ChoicesConfig {
  /** Where the buttons sit. Default `center`; `bottom` keeps clear of the dialogue box. */
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  /** `column` (default) or `grid` with `columns` per row (default 2). */
  layout?: 'column' | 'grid'
  columns?: number
  /** `choices-gap` — space between buttons. */
  gap?: string | number
  /** `choice-width` — each button's minimum width. */
  width?: string | number
  /** Button image (stretched, or nine-sliced with `slice`) — `choice-skin` /
   *  `choice-skin-slice`; clears the default gradient and border unless given. */
  skin?: string
  slice?: number | string
  sliceWidth?: string | number
  /** `choice-bg` / `choice-border` / `choice-radius` / `choice-color` / `choice-size` / `choice-hover`. */
  background?: string
  border?: string
  radius?: string | number
  color?: string
  size?: string | number
  hover?: string
  /** How an option taken in an earlier run (`sys.chosen`) is drawn: `dim`
   *  (`choice-chosen-bg` / `choice-chosen-color`) or `none` (default). */
  chosenStyle?: 'none' | 'dim'
  chosenBackground?: string
  chosenColor?: string
  /** `choice-disabled-bg` / `choice-disabled-color` (`[choice … disabled=cond]`). */
  disabledBackground?: string
  disabledColor?: string
  /** Seconds a prompt waits before picking `timerDefault` by itself; a bar shows the time left. */
  timer?: number
  /** The option a timeout picks, counted from 1 among the shown options (default: the first enabled one). */
  timerDefault?: number
  /** `choice-timer-bg` / `choice-timer-color`. */
  timerBackground?: string
  timerColor?: string
}

/** `[window]` in nilvn.config.toml — dialogue-box settings that map onto theme
 *  tokens (config.ts `windowTheme`). Every key optional. */
export interface WindowConfig {
  /** Image drawn under the text (whole-image stretch, or nine-slice with `slice`)
   *  — sets `dialog-skin` and clears the default gradient and border unless
   *  they are given too. */
  skin?: string
  /** Nine-slice the skin instead of stretching it: the inset of the slice lines
   *  in image pixels (one number, or up to four as in CSS `border-image-slice`).
   *  Sets `dialog-skin-slice`. */
  slice?: number | string
  /** How wide the nine-slice edges draw on the stage (a CSS length; default:
   *  the slice inset in `px`). */
  sliceWidth?: string | number
  /** `dialog-bg` — any CSS background (colour, gradient). */
  background?: string
  /** `dialog-border` — a CSS border shorthand, or `none`. */
  border?: string
  /** `dialog-radius`. */
  radius?: string | number
  /** `dialog-opacity` — 0..1, the default chrome's opacity (a skin carries its own alpha). */
  opacity?: number
  /** Which edge the box sits on. */
  position?: 'bottom' | 'top'
  /** What a line does when it does not fit the box: `grow` the box (default),
   *  `page` (wait for a tap, then continue in a cleared box) or `shrink` the
   *  text. `{p}` pages explicitly in every mode. */
  overflow?: 'grow' | 'page' | 'shrink'
  /** Distance from that edge (`dialog-bottom` / `dialog-top`). */
  offset?: string | number
  /** Left / right inset (`dialog-inset`). */
  inset?: string | number
  /** Minimum height (`dialog-height`). */
  height?: string | number
  /** `dialog-padding`. */
  padding?: string
  /** `font` (the whole stage). */
  font?: string
  /** `text-size` / `text-color` / `text-line-height` / `text-shadow`. */
  textSize?: string | number
  textColor?: string
  lineHeight?: string | number
  textShadow?: string
  /** `name-bg` / `name-color` / `name-size`. */
  nameBackground?: string
  nameColor?: string
  nameSize?: string | number
  /** `indicator-color`. */
  indicatorColor?: string
}
