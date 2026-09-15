// NilVN editor document model (IR) — the single source of truth for the creator studio.
// Consumed by the editor, AI generation, the engine (via compile) and the bundler.

// Value import (not type-only): resolvePluginId is used by
// migrateProject below. plugins.ts imports only *types* from here, so there's no
// runtime import cycle.
import { resolvePluginId } from './plugins.js'

export type Lang = string // 'zh' | 'en' | 'ja' | ...

/** textKey -> localized string. Values may carry inline markup ({wave:..}, {w:0.5}, {br}). */
export type TextCatalog = Record<string, string>

export interface Project {
  meta: ProjectMeta
  actors: Record<string, Actor> // actorId -> Actor
  variables: VariableDef[]
  resources: ResourceRegistry
  plugins: PluginRef[]
  scenes: Scene[]
  catalogs: Record<Lang, TextCatalog>
  /** Project-level reusable loop cycles (the loop library). Authoring metadata only — these never serialize into the playable
   *  script (a `LoopStartNode` inlines its own body). Optional: older projects and
   *  freshly-created ones simply have none. */
  loopClips?: LoopClip[]
  /** Authored A–B replay segments (the replay gallery, schema v7). Each records
   *  two node position ids; the serializer emits a start label + an end marker, and
   *  the engine unlocks a segment when normal play passes its end. Optional: older
   *  projects simply have none. */
  replays?: ReplaySegment[]
}

/** A node position id: which scene, which node — the timeline's stable locator
 *  (`NodeBase.id` is minted once and survives edits around it). */
export interface NodeAnchor {
  sceneId: string
  nodeId: string
}

/** An authored A–B replay segment: plays from the `start` node through the `end`
 *  node (inclusive). Unlocked for the player's replay gallery once normal play
 *  passes the end marker. The end anchor should be a node normal flow actually
 *  passes THROUGH (a dialogue / command) — a choice or jump node leaves before
 *  the marker after it would run. */
export interface ReplaySegment {
  id: string
  /** Localized gallery title (catalog key, like scene titles). */
  titleKey: string
  start: NodeAnchor
  end: NodeAnchor
}

/** Current IR / project format version. Bump when the on-disk IR shape changes
 *  in a way that needs a migration. Independent of the studio app version and of
 *  `ProjectMeta.version` (the author's own content version).
 *
 *  v2: `plugins` became the authoritative enabled-set (empty = all disabled).
 *      Pre-v2 projects always ran every bundled plugin, so the migration fills
 *      an empty `plugins` with all bundled plugins enabled. See migrateProject.
 *  v3: `resources.spritesheets` added (sprite-frame animation).
 *  v4: `AnimNode` (recorded keyframe animations) joined the SceneNode union — a
 *      pure addition (older projects simply have none), so no data migration; the
 *      bump only marks the format so an older reader knows it's newer.
 *  v5: the recording animation redesign joined the union:
 *      `EventFrameNode` (scene-level event-frame) and `LoopStartNode` /
 *      `LoopStopNode` (single-element async loops), plus the project-level
 *      `loopClips` loop library. All pure additions (older projects have none), so no
 *      data migration; the bump only stamps the format. The whole redesign ships as
 *      one unreleased batch, hence one schema version covering every new node kind
 *      (and the loop library) rather than a bump per increment.
 *  v6: asset provenance metadata — optional `provenance` /
 *      `box` / `canonicalName` on `AssetRef`, and optional `origin` on `Actor`. The
 *      groundwork for the Web→Pro conversion (where a vector SVG placeholder is the
 *      registration template a raster replacement aligns onto). All pure additions
 *      (older projects / assets simply have none = unknown source), so no data
 *      migration; the bump only stamps the format. Authoring-only metadata — it
 *      never serializes into the playable script (the DSL carries only the resolved
 *      asset path; see serialize.ts).
 *  v7: `Project.replays` — authored A–B replay segments (two node
 *      position ids each). A pure optional addition (older projects have none), so
 *      no data migration; the bump only stamps the format. Unlike most authoring
 *      metadata these DO reach the runtime script: serialize.ts emits a
 *      `[replaydef]` preamble, a start label and an end marker per segment.
 *  v8–v10: the pluginization backfills (abreplay / animstudio / voicerecord became
 *      plugins) — see the migration table.
 *  v11: plugin platform v2 — `PluginRef`
 *      is `{ id, version?, config? }` keyed by the plugin's reverse-DNS id; the
 *      migration maps bundled short names (`textfx` → `app.nilvn.textfx`) and keeps
 *      unknown names verbatim (the editor reports them, nothing is dropped). */
export const CURRENT_SCHEMA_VERSION = 11

/** Context shared by every migration step of one `migrateProject` call. */
interface MigrationContext {
  /** Whether the author participates in the plugin system with anything enabled —
   *  sampled ONCE, before the pluginization backfills mutate the set, so a
   *  usage-forced addition in one step can't smuggle the next feature past a
   *  deliberate all-off. */
  hadPlugins: boolean
}

/** One schema step: runs when the loaded project is older than `to`. Steps whose
 *  bump was a pure addition (nothing to backfill) are listed with a comment only
 *  — the version stamp at the end records them. */
interface Migration {
  to: number
  run(project: Project, ctx: MigrationContext): void
}

/** A pre-v11 ref (`{ name, entry }`) or a v11 one (`{ id }`), as the table steps
 *  below meet them: the pluginization backfills (v8–v10) run on old projects
 *  whose refs still carry `name`, and the v11 step normalizes everything. */
type AnyPluginRef = Partial<PluginRef> & { name?: string; entry?: string }

/** The stable id a ref (of either shape) points at. */
function refId(r: AnyPluginRef): string | undefined {
  const raw = r.id ?? r.name
  return raw ? resolvePluginId(raw) : undefined
}

function hasPlugin(p: Project, id: string): boolean {
  return (p.plugins as AnyPluginRef[]).some((x) => refId(x) === id)
}

/** The migration table, oldest first. Each schema bump adds one entry here (or a
 *  comment when it is a pure addition). Table-driven so the
 *  steps read as data. */
/** The content plugins a pre-v2 project (empty enabled set = "everything on") is
 *  backfilled with. FROZEN history: this is what "all first-party content
 *  plugins" meant when the migration was written, by id — the live first-party
 *  inventory lives in @nilvn/plugins and must not steer a migration. */
const LEGACY_DEFAULT_PLUGINS = [
  'app.nilvn.textfx',
  'app.nilvn.charfx',
  'app.nilvn.choicefx',
  'app.nilvn.screenfx',
  'app.nilvn.objectfx',
  'app.nilvn.spriteanim',
  'app.nilvn.voicefx',
  'app.nilvn.voicerecord',
  'app.nilvn.animstudio',
  'app.nilvn.abreplay',
]

const MIGRATIONS: Migration[] = [
  // v1 -> v2: `plugins` is now the enabled-set. Pre-v2 always ran every bundled
  // plugin, so an empty list then meant "all on" — fill it to preserve behavior.
  // (At v2+ an empty list legitimately means "all disabled" and is left alone.)
  { to: 2, run: (p) => { if (p.plugins.length === 0) p.plugins = LEGACY_DEFAULT_PLUGINS.map((id) => ({ id })) } },
  // v2 -> v3: `resources.spritesheets` is a new asset category (sprite-frame
  // animation). Pre-v3 projects have no field — backfill an empty list so every
  // reader can assume it exists.
  { to: 3, run: (p) => { p.resources.spritesheets ??= [] } },
  // v3 -> v4: `AnimNode` joined the SceneNode union. Pure addition — nothing to backfill.
  // v4 -> v5: the recording animation redesign joined the union (`EventFrameNode`,
  // `LoopStartNode`, `LoopStopNode`). Pure additions.
  // v5 -> v6: asset provenance metadata (provenance/box/canonicalName on AssetRef,
  // origin on Actor). Optional pure additions — a missing field just means "unknown source".
  // v6 -> v7: `Project.replays` (A–B replay segments). Optional pure addition.
  // v7 -> v8: A–B replay became the `abreplay` plugin; before v8 it was
  // always-on. Projects that USE it (authored `replays`) get it enabled
  // unconditionally — their exported gallery/unlocks must keep working. Projects
  // that don't get it only when their enabled set is non-empty (keeping the
  // replay tab they were used to seeing); a deliberately emptied set stays
  // authoritative all-off, as it has been since v2.
  {
    to: 8,
    run: (p, ctx) => {
      if ((p.replays?.length || ctx.hadPlugins) && !hasPlugin(p, 'app.nilvn.abreplay')) {
        p.plugins.push({ id: 'app.nilvn.abreplay' })
      }
    },
  },
  // v8 -> v9: keyframe animation became the `animstudio` plugin, same policy as
  // v7→v8 — usage is "any animation node in any scene".
  {
    to: 9,
    run: (p, ctx) => {
      if (hasPlugin(p, 'app.nilvn.animstudio')) return
      const animKinds = new Set(['anim', 'eventframe', 'loopstart', 'loopstop'])
      const used = p.scenes.some((s) => s.nodes.some((n) => animKinds.has(n.kind)))
      if (used || ctx.hadPlugins) p.plugins.push({ id: 'app.nilvn.animstudio' })
    },
  },
  // v9 -> v10: the per-line voice authoring UI became the editor-only
  // `voicerecord` plugin, same policy again. Only the popover is gated —
  // [voice] playback stays core — so the backfill is about keeping the voice
  // button visible where the author was using or could see it.
  {
    to: 10,
    run: (p, ctx) => {
      if (hasPlugin(p, 'app.nilvn.voicerecord')) return
      const used = p.scenes.some((s) => s.nodes.some((n) => n.kind === 'say' && !!n.voice))
      if (used || ctx.hadPlugins) p.plugins.push({ id: 'app.nilvn.voicerecord' })
    },
  },
  // v10 -> v11: plugin platform v2. Refs are keyed by reverse-DNS id; a dotless
  // (short) name maps into the first-party namespace through resolvePluginId —
  // a first-party short name becomes its id, anything else a valid id the
  // editor's load-time validation reports as unknown (data is never dropped);
  // an id passes verbatim, `entry` is gone (entries live in the manifest),
  // duplicates collapse.
  {
    to: 11,
    run: (p) => {
      const seen = new Set<string>()
      const next: PluginRef[] = []
      for (const raw of p.plugins as AnyPluginRef[]) {
        const id = refId(raw)
        if (!id || seen.has(id)) continue
        seen.add(id)
        const ref: PluginRef = { id }
        if (raw.version !== undefined) ref.version = raw.version
        if (raw.config !== undefined) ref.config = raw.config
        next.push(ref)
      }
      p.plugins = next
    },
  },
]

/** Bring a loaded project up to CURRENT_SCHEMA_VERSION in place (then return it).
 *  Call once on load, after reading from disk. Runs every table step the project
 *  predates, in order, then stamps the current version. */
export function migrateProject(project: Project): Project {
  const from = project.meta.schemaVersion ?? 1
  const ctx: MigrationContext = { hadPlugins: project.plugins.length > 0 }
  for (const m of MIGRATIONS) if (from < m.to) m.run(project, ctx)
  project.meta.schemaVersion = CURRENT_SCHEMA_VERSION
  return project
}

export interface ProjectMeta {
  id: string
  title: string
  /** The author's own content version of their work (not the format/app version). */
  version: string
  defaultLang: Lang
  languages: Lang[]
  /** Default typewriter speed in characters per second. */
  textSpeed?: number
  /** Release resolution imported images are compressed to (default 1440p). */
  shipRes?: '1080p' | '1440p' | '2160p'
  /** Editor-only UI state. It does not affect playback semantics. */
  editor?: EditorProjectMeta
  /** IR / project format version, for gating future format migrations.
   *  Backfilled to CURRENT_SCHEMA_VERSION on load when absent. */
  schemaVersion?: number
}

export interface EditorProjectMeta {
  sceneMap?: {
    positions?: Record<string, { x: number; y: number }>
    chapters?: SceneMapChapter[]
  }
}

export interface SceneMapChapter {
  id: string
  title: string
  sceneIds: string[]
  collapsed?: boolean
}

export interface Actor {
  id: string
  /** Display name is localizable, hence a catalog key. */
  nameKey: string
  color?: string
  /** Sprite URL template; `{face}` is replaced by the current face. */
  sprites: string
  /** Available faces, for the editor's expression picker. */
  faces: string[]
  defaultFace?: string
  /** Base pitch (Hz) for the voicefx plugin. */
  voice?: number
  /** The character's reproducible recipe (provenance):
   *  typically `source:'face-creator'`, carrying the whole def so any pose can be
   *  re-rendered at conversion time (the expression-set "registration template" a
   *  raster sprite later aligns onto). Authoring-only and optional; absent = unknown
   *  origin. Never reaches the engine wire format. */
  origin?: AssetProvenance
}

export interface VariableDef {
  name: string
  type: 'number' | 'boolean' | 'string'
  default: number | boolean | string
  /** Display name in the editor. */
  label?: string
}

export interface ResourceRegistry {
  backgrounds: AssetRef[]
  audio: AudioRef[]
  /** Sprite-frame animation sheets (single-row strips), imported losslessly.
   *  Added at schema v3; older projects backfill an empty list on migrate. */
  spritesheets: AssetRef[]
}

// ---- asset provenance ----
// Authoring / transfer metadata recording where an asset came from and how to
// re-render or replace it — the groundwork for the Web→Pro conversion, where a clean
// vector SVG placeholder doubles as the "registration template" a raster replacement
// aligns onto pixel-for-pixel. Every field below is OPTIONAL and AUTHORING-ONLY: it
// lives purely in the project JSON and NEVER serializes into the engine DSL (which
// carries only the resolved asset path; see serialize.ts). An older project, or any
// asset that predates this, simply has none (= unknown source) — nothing to backfill.

/** A face-creator character recipe — the `buildCharacterDef` product
 *  (`format:'nilvn-face-character'` + base selection/colors + included poses). Core
 *  treats it as an OPAQUE payload: it only carries the recipe so the editor /
 *  face-creator can re-render any pose later (`applyPose` derives all 8 expressions),
 *  and never interprets its internals. Kept structural (not imported from the
 *  face-creator package) so @nilvn/core stays zero-dependency and decoupled — the
 *  face-creator is a separate sibling whose consumption (vendor / publish / symlink)
 *  is still undecided (STRATEGY §8). */
export interface FaceRecipe {
  format: 'nilvn-face-character'
  [k: string]: unknown
}

/** Where an asset's bytes came from. A discriminated union so the Web→Pro converter
 *  can offer the right replacement lane per source (re-render from a recipe, re-run /
 *  condition an AI prompt, swap a library id, or accept a manual raster drop). */
export type AssetProvenance =
  | { source: 'face-creator'; def: FaceRecipe } // a face-creator recipe — any pose re-renderable
  | { source: 'ai-svg'; prompt: string; model?: string } // AI-generated; prompt re-runnable / feeds structure conditioning
  | { source: 'builtin'; libId: string } // from the built-in asset library
  | { source: 'imported' } // user-imported bytes (Pro; already raster)

/** An asset's intrinsic render box — its native canvas plus an optional anchor — so a
 *  replacement can be scaled and positioned to land exactly where the SVG placeholder
 *  sat (alignment is where asset replacement most easily breaks; STRATEGY §6). */
export interface RenderBox {
  /** Intrinsic canvas size (a character = the face-creator 600×1100). */
  w: number
  h: number
  /** Anchor in canvas coords (a character's feet / center; from face-creator ANCHOR). */
  anchor?: { x: number; y: number }
}

export interface AssetRef {
  id: string
  path: string
  thumb?: string
  /** Where this asset came from (provenance,). Optional and
   *  authoring-only; absent = unknown source. */
  provenance?: AssetProvenance
  /** Intrinsic render box, for aligning a replacement onto this asset. */
  box?: RenderBox
  /** Canonical filename (e.g. `yuki__happy.png`) so a commission pack's files
   *  auto-match back to their slots with no manual mapping (STRATEGY §6). */
  canonicalName?: string
}

export interface AudioRef extends AssetRef {
  kind: 'bgm' | 'se'
}

/** One enabled plugin (schema v11, plugin platform v2). `id` is the manifest's
 *  reverse-DNS id (`app.nilvn.textfx`); the hosts resolve bundled ids from their
 *  registries and third-party ones from the project's plugin packages. */
export interface PluginRef {
  id: string
  /** The version the project was authored against (informational; the host
   *  loads whatever version it has and reports a mismatch). */
  version?: string
  config?: Record<string, unknown>
}

export interface Scene {
  id: string
  titleKey: string
  nodes: SceneNode[]
}

// A scene's content is a flat list of nodes. Named `SceneNode` (not `Node`) to avoid
// colliding with the DOM `Node` global in consumers such as the web app.
export type SceneNode =
  | SayNode
  | NarrateNode
  | CommandNode
  | ChoiceNode
  | SetNode
  | JumpNode
  | LabelNode
  | RecallNode
  | AnimNode
  | EventFrameNode
  | LoopStartNode
  | LoopStopNode

export type NodeKind = SceneNode['kind']

interface NodeBase {
  /** Stable id generated by the editor; jumps/references point at it. */
  id: string
  /** Optional guard expression over project variables; node runs only when truthy. */
  condition?: string
}

export interface SayNode extends NodeBase {
  kind: 'say'
  actor: string // actorId
  face?: string
  textKey: string
  /** Optional per-line voice clip (an AssetPath). Plays as the line appears;
   *  serialized to a `[voice <path> offset=<sec>]` just before the dialogue, so
   *  the engine plays it alongside the line and mutes the synth typing blip. */
  voice?: string
  /** Start-time correction (seconds) for the voice clip: playback seeks here to
   *  skip leading silence. Defaults to 0. */
  voiceOffset?: number
}

export interface NarrateNode extends NodeBase {
  kind: 'narrate'
  textKey: string
}

export interface CommandNode extends NodeBase {
  kind: 'command'
  cmd: string // 'bg' | 'char' | 'bgm' | … | plugin command
  /** Named values; described and validated by the command schema (see schema.ts). */
  params: Record<string, string | number | boolean>
}

export interface ChoiceNode extends NodeBase {
  kind: 'choice'
  options: ChoiceOption[]
}

export interface ChoiceOption {
  labelKey: string
  target: JumpTarget
  /** Shown only when truthy. */
  condition?: string
}

export interface SetNode extends NodeBase {
  kind: 'set'
  var: string
  expr: string
}

export interface JumpNode extends NodeBase {
  kind: 'jump'
  target: JumpTarget
}

export interface LabelNode extends NodeBase {
  kind: 'label'
  name: string
}

/** Recollection / CG-gallery marker; the editor builds the replay list from these. */
export interface RecallNode extends NodeBase {
  kind: 'recall'
  recallId: string
  titleKey: string
  thumb?: string
}

/** One keyframe of an AnimNode. `t` is seconds from the clip start. The transform
 *  channels mirror the engine's fixed schema: `x` / `y` are pixel translate offsets
 *  from the object's birth position, `scale` / `rotation` / `opacity` are absolute.
 *  Every keyframe of a clip carries the same channel set (the recorded tracks), so
 *  playback never carries a value forward. `ease` is a short easing code for the
 *  segment INTO the next keyframe (expanded by the engine; see builtins `[anim]`). */
export interface AnimKeyframe {
  t: number
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  ease?: string
}

/** A recorded keyframe animation played on one stage object. A first-class node with its own editor (not a CommandNode);
 *  serializes to an `[anim …]` command for the engine. `hold` persists the end pose
 *  into the object's resting transform; absent = transient, snaps back. */
export interface AnimNode extends NodeBase {
  kind: 'anim'
  /** Target stage object id: `character:<id>` / `sprite:<id>` / `camera`. */
  target: string
  /** Total clip length in seconds; keyframe `t` values lie in [0, duration]. */
  duration: number
  keyframes: AnimKeyframe[]
  /** Persist the end pose. Absent / false = transient, snaps back. */
  hold?: boolean
}

// ---- recording event-frame ----
// A scene-level, time-based, multi-element keyframe choreography. Supersedes the
// per-element AnimNode recorder; AnimNode/[anim] remain as a low-level primitive.

/** A recordable channel's value. Continuous channels (x/y/scale/rotation/opacity)
 *  carry numbers and are interpolated; discrete channels (visible/face/layer/…)
 *  carry strings or booleans and snap at the keyframe time. Which channels a kind
 *  exposes is declared by the engine's `ObjectKind.recordable` ("dynamic
 *  extraction"), so new object types become keyframable with no IR change. */
export type ChannelValue = number | string | boolean

/** One keyframe of an `ElementTrack`. `t` is seconds from the event-frame start.
 *  `ch` is SPARSE — only the channels changed at this keyframe (a missing channel
 *  carries the previous keyframe's value). Unlike `[anim]`'s decimation, identity values
 *  are kept, so re-editing knows which channels were recorded. `ease` is the
 *  easing code for the segment INTO the next keyframe of the SAME channel
 *  (continuous channels only; discrete channels snap regardless). */
export interface Keyframe {
  t: number
  ch: Record<string, ChannelValue>
  ease?: string
}

/** One stage object's keyframe track inside an `EventFrameNode`. */
export interface ElementTrack {
  objId: string
  keys: Keyframe[]
}

/** A scene-level "recording event-frame": a one-shot, blocking, multi-element
 *  keyframe choreography over a real time-track. Each
 *  track's `keys[0]` is kf0 — the full state snapshot captured when recording
 *  began. A first-class node with its own editor (not a CommandNode); serializes
 *  to an `[eventframe …]` command the engine plays through a pure-JS rAF clock.
 *  The save only records the node position (the event-frame is atomic), so a
 *  load jumps to kf0 — mid-play progress is never persisted. */
export interface EventFrameNode extends NodeBase {
  kind: 'eventframe'
  /** Total clip length in seconds; keyframe `t` values lie in [0, duration]. */
  duration: number
  tracks: ElementTrack[]
}

/** Begin a single-element loop: an async,
 *  non-blocking, repeating animation on one stage object that runs across later
 *  beats until a matching `LoopStopNode` (or a new loop on the same object, or a
 *  load / restart). Three parts, split so the cycle can be reused independently:
 *  `entry` (the anchor pose set when the loop begins) + `body` (the reusable cycle,
 *  played on repeat) + the `exit` carried by the stop node. Serializes to a
 *  `[loopstart …]` command. */
export interface LoopStartNode extends NodeBase {
  kind: 'loopstart'
  /** Target stage object id: `character:<id>` / `sprite:<id>` / `camera`. */
  objId: string
  /** Cycle length in seconds; `body` keyframe `t` values lie in [0, duration].
   *  Continuous channels wrap seamlessly when `body[0]` equals `body[last]`. */
  duration: number
  /** The loop's anchor pose — channel values the object is set to when the loop
   *  begins (typically equal to `body[0]`, plus any channels the body holds
   *  constant). Continuous values are numbers, discrete values strings/booleans. */
  entry: Record<string, ChannelValue>
  /** The reusable cycle: sparse keyframes (same grammar as an `ElementTrack`),
   *  played on repeat. Kept structurally separate from `entry` so the same body can
   *  drive a project-level named-loop library in a later increment. */
  body: Keyframe[]
  /** Easing code for the bridge from the current pose into `entry` (reserved for
   *  the bridge-in tween; the runtime snaps to `entry` until that lands). */
  intoEase?: string
}

/** Stop the single-element loop running on `objId` and settle it. Serializes to a `[loopstop …]` command. */
export interface LoopStopNode extends NodeBase {
  kind: 'loopstop'
  /** Which running loop to stop (by target object id). */
  objId: string
  /** The pose the object settles to when the loop stops; committed to the resting
   *  model so it persists. */
  exit: Record<string, ChannelValue>
  /** Easing code for the bridge from the loop pose out to `exit` (reserved for the
   *  bridge-out tween; the runtime snaps to `exit` until that lands). */
  outEase?: string
}

/** A reusable recorded loop cycle (the project-level loop library). Authoring-only metadata — it is NOT part of the engine wire format:
 *  a `LoopStartNode` inlines its own absolute `body`, so a clip is just the source the
 *  editor materializes that body from. Persists with the project (so the author can
 *  pick it on later beats), but never serializes into the playable script.
 *
 *  `body` keyframes hold values **relative to the recording's start pose** (deltas, with
 *  `body[0]` at delta 0). On insert the editor rebases them onto the target element's
 *  current pose — `entry[ch] + delta` — so one clip drives the same motion wherever (and
 *  on whichever recordable element) it is dropped (this is what "the current state is the first frame"
 *  means in practice). Only continuous channels are captured today (a drag samples
 *  x/y/scale/rotation/opacity); discrete loops are a later addition. */
export interface LoopClip {
  id: string
  /** Author-facing label, shown in the insert picker (auto "Loop N", editable). */
  name: string
  /** Cycle length in seconds; `body` keyframe `t` values lie in [0, duration]. */
  duration: number
  /** Sparse delta keyframes (same grammar as an `ElementTrack`'s keys). */
  body: Keyframe[]
}

export interface JumpTarget {
  /** Omitted = current scene; set = cross-scene (cross-file) jump. */
  scene?: string
  /** Target LabelNode.name. */
  label: string
}
