// Serialize the IR to NilVN's v1 DSL (the `.nvn` script the engine already parses).
// Used for live preview (IR -> DSL -> engine.loadSource) and as an interchange export.
// The grammar target is packages/engine/src/parser.ts:
//   - dialogue:   speaker(face): text   |   |narration
//   - command:    [name pos... key=value]
//   - choice:     [choice text -> label if=cond]  (consecutive ones merge)
//   - flow:       [label name] / [jump label] / [if cond -> label] / [set var = expr]
//
// Text comes from the chosen language catalog, keeping logic and text fully separate.
import type {
  AnimKeyframe,
  AnimNode,
  ChannelValue,
  CommandNode,
  ElementTrack,
  EventFrameNode,
  JumpTarget,
  Keyframe,
  Lang,
  LoopStartNode,
  LoopStopNode,
  Project,
  SceneNode,
} from './ir.js'
import type { CommandSchema } from './schema.js'
import { BUILTIN_COMMAND_MAP } from './commands.js'

export interface SerializeOptions {
  /** Which catalog to read text from; defaults to project.meta.defaultLang. */
  lang?: Lang
  /** Command schema registry: built-ins + the plugin commands the host knows
   *  (`commandRegistry(manifests)`). Defaults to the built-ins only — a plugin
   *  command absent from the registry serializes all-named, which the engine's
   *  positional reads would drop, so a host that serializes plugin commands
   *  must pass its registry. */
  commands?: Record<string, CommandSchema>
  /** Emit `[label anchorLabel]` immediately before this node id (preview-from-here). */
  anchorNodeId?: string
  /** Label name to inject at anchorNodeId; defaults to `__nilvn_here__`. */
  anchorLabel?: string
  /** Emit `@key` references instead of resolved literal text, so the engine
   *  resolves them at runtime from its catalogs (enables in-game language
   *  switching). The engine ships every language's catalog alongside this DSL. */
  keepKeys?: boolean
  /** Restrict serialization to these scene ids (in project order; unknown ids
   *  are ignored). Omitted = the whole project. The scoped output is the unit a
   *  future chunked/streaming export emits;
   *  full export is just the no-scope degenerate case of the same code path.
   *  NOTE: a scoped body may contain jumps to labels defined in OTHER scenes —
   *  resolved when the full product loads; preview must degrade such a jump
   *  gracefully rather than treat it as a parse error. */
  scenes?: string[]
  /** Chunked-export scoping: keep jump/choice targets that point at OTHER project
   *  scenes (they're cross-chunk jumps the runtime resolves via the manifest
   *  labelIndex), redirecting only genuinely-unconnected targets to the unset
   *  landing. Default (a scoped PREVIEW) redirects every out-of-scope target,
   *  since it can't play beyond the scope. Only meaningful with `scenes`. */
  crossChunk?: boolean
}

/** A serialized scope: the playable DSL plus the metadata a chunked export needs
 *  to emit. Full export = serializeChunk with no
 *  `scenes` scope (one chunk), so full and chunked share this one code path. */
export interface SerializedChunk {
  /** The `.nvn` DSL for the scope (what the engine parser consumes). */
  body: string
  /** Jump-target labels this scope DEFINES: scene ids + in-scene `label` nodes.
   *  The synthetic anchor/unset landing labels are excluded — they're preview-
   *  only / per-chunk-local, not cross-chunk targets. Feeds the export manifest's
   *  `labelIndex`. */
  labels: string[]
  /** Asset refs this scope references: per-scene command params + per-line voice.
   *  Project-level shared assets (declared resources, actor face sprites) are NOT
   *  scene-scoped and belong to the always-warm base, so they're not collected
   *  here. */
  assetRefs: string[]
}

export function serializeChunk(project: Project, opts: SerializeOptions = {}): SerializedChunk {
  const lang = opts.lang ?? project.meta.defaultLang
  const catalog = project.catalogs[lang] ?? {}
  const commands = opts.commands ?? BUILTIN_COMMAND_MAP
  // keepKeys: ship the catalog key (`@t.hello`) so text is resolved at play time;
  // otherwise inline the resolved literal from the chosen language's catalog.
  const text = opts.keepKeys
    ? (key: string): string => (key ? '@' + key : '')
    : (key: string): string => catalog[key] ?? ''

  const anchorLabel = opts.anchorLabel ?? '__nilvn_here__'
  const scenes = opts.scenes ? project.scenes.filter((s) => opts.scenes!.includes(s.id)) : project.scenes
  // When scoped, any jump/choice target that lands OUTSIDE the scope would be an
  // unknown label at play time (engine.jump throws). Precompute the in-scope sets
  // so dest() can redirect such a target to the graceful unset landing — a scoped
  // preview then ends cleanly at its boundary instead of crashing, and the editor
  // offers to continue into the real target scene. Unscoped = no redirect.
  // Scene ids are kept SEPARATE from the merged label namespace: a cross-scene
  // jump must be judged against the scene set alone, so an out-of-scope scene id
  // that happens to match an in-scope label node's name is still redirected.
  const scope: SerializeScope | null = opts.scenes ? { labels: new Set(), scenes: new Set() } : null
  if (scope) {
    // Validate targets against just the in-scope scenes (preview: an out-of-scope
    // jump can't play, so redirect it to the unset landing) OR against the whole
    // project (chunked export: a jump to another scene is a valid cross-chunk jump
    // the runtime resolves via labelIndex, so keep it — only a target that names no
    // scene/label anywhere degrades to unset).
    const validation = opts.crossChunk ? project.scenes : scenes
    for (const scene of validation) {
      scope.scenes.add(scene.id)
      scope.labels.add(scene.id)
      for (const node of scene.nodes) if (node.kind === 'label') scope.labels.add(node.name)
    }
  }
  const out: string[] = []
  const labels: string[] = []
  const assetRefs = new Set<string>()
  // A–B replay segments (Project.replays, schema v7): only segments whose BOTH
  // anchors resolve to live nodes are emitted — a dangling anchor (its node was
  // deleted) degrades to "segment not in this build" rather than a broken label.
  // Start anchors become a `[label __replay_<id>]` right before their node; end
  // anchors a `[replayend <id>]` right after theirs (segment inclusive of the end
  // node). The `[replaydef]` preamble — the gallery list the runtime shows — is
  // emitted only into the scope holding the project's FIRST scene, so a chunked
  // export declares each segment once (in the entry chunk).
  const replayStarts = new Map<string, string[]>()
  const replayEnds = new Map<string, string[]>()
  const validReplays = (project.replays ?? []).filter((r) => hasNode(project, r.start) && hasNode(project, r.end))
  for (const r of validReplays) {
    push(replayStarts, r.start.nodeId, r.id)
    push(replayEnds, r.end.nodeId, r.id)
  }
  const holdsEntry = !opts.scenes || (project.scenes[0] !== undefined && opts.scenes.includes(project.scenes[0].id))
  if (holdsEntry) {
    for (const r of validReplays) {
      out.push(`[replaydef id=${token(r.id)} title=${token(text(r.titleKey))} label=${REPLAY_LABEL_PREFIX}${r.id}]`)
      // The start label is DEFINED in whatever chunk holds the start scene; the
      // preamble only references it (labelIndex maps it to its defining chunk).
    }
    if (validReplays.length) out.push('')
  }
  for (const scene of scenes) {
    // Scene boundary doubles as a jump label so the engine can start(sceneId).
    out.push(`[label ${scene.id}]`)
    labels.push(scene.id)
    for (const node of scene.nodes) {
      if (opts.anchorNodeId && node.id === opts.anchorNodeId) out.push(`[label ${anchorLabel}]`)
      for (const segId of replayStarts.get(node.id) ?? []) {
        out.push(`[label ${REPLAY_LABEL_PREFIX}${segId}]`)
        labels.push(`${REPLAY_LABEL_PREFIX}${segId}`) // a cross-chunk start target → into labelIndex
      }
      if (node.kind === 'label') labels.push(node.name)
      collectNodeAssets(node, assetRefs)
      out.push(serializeNode(node, text, commands, scope))
      for (const segId of replayEnds.get(node.id) ?? []) out.push(`[replayend ${token(segId)}]`)
    }
    out.push('')
  }
  // A landing spot for not-yet-connected branches/jumps. Reaching it just ends
  // the script (nothing follows), so an unset target can't break parsing/preview.
  out.push(`[label ${UNSET_LABEL}]`)
  return { body: out.join('\n').trimEnd() + '\n', labels, assetRefs: [...assetRefs] }
}

/** Serialize to the `.nvn` DSL string (the common case: preview / interchange
 *  export). Thin wrapper over serializeChunk, so the scoped and full paths are
 *  identical and a caller that only wants the script stays unchanged. */
export function serializeProject(project: Project, opts: SerializeOptions = {}): string {
  return serializeChunk(project, opts).body
}

/** Matches the asset extensions the pipeline ships. Kept beside isAssetRef so the
 *  predicate is one place (the editor imports it too — no second copy to drift). */
const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|avif|mp3|ogg|opus|wav|m4a|aac|flac|mp4|webm)$/i

/** True when a value looks like an asset reference — used to pick asset paths out
 *  of arbitrary command params. Zero-dep, so it's the single shared predicate. */
export function isAssetRef(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v !== '' &&
    (v.startsWith('/') || v.startsWith('./') || v.startsWith('asset:') || ASSET_EXT.test(v))
  )
}

/** Scene-scoped asset refs: command params that look like assets + a line's voice
 *  clip. (Project-level resources / actor faces are collected elsewhere.) */
function collectNodeAssets(node: SceneNode, into: Set<string>): void {
  if (node.kind === 'command') {
    for (const v of Object.values(node.params ?? {})) if (isAssetRef(v)) into.add(v)
  } else if (node.kind === 'say' && node.voice) {
    into.add(node.voice)
  }
}

// Where a jump/choice with no chosen target points until the author connects it.
const UNSET_LABEL = '__nilvn_unset__'

/** Label prefix for A–B replay segment start anchors (`__replay_<segId>`). Shared
 *  with the engine's `playReplay` (which starts at this label) via the wire form
 *  the `[replaydef]` preamble carries — the engine never re-derives it. */
export const REPLAY_LABEL_PREFIX = '__replay_'

/** Whether an anchor's node still exists (in its scene, or anywhere if the scene
 *  itself was renamed — node ids are globally unique, so an id match suffices). */
function hasNode(project: Project, anchor: { sceneId: string; nodeId: string }): boolean {
  const scene = project.scenes.find((s) => s.id === anchor.sceneId)
  if (scene?.nodes.some((n) => n.id === anchor.nodeId)) return true
  return project.scenes.some((s) => s.nodes.some((n) => n.id === anchor.nodeId))
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/** The two in-scope sets for scoped serialization: scene ids (judging cross-scene
 *  jump targets) kept apart from the merged label namespace (scene ids + in-scene
 *  label-node names, judging label-only targets). */
interface SerializeScope {
  labels: Set<string>
  scenes: Set<string>
}

// Cross-scene jumps target the scene id (each scene emits `[label sceneId]`),
// otherwise the in-scene label. The conditional jump path also routes through here.
// An empty target routes to the unset-landing label so the DSL still parses. When
// `scope` is given (scoped serialization), a target outside the scope is likewise
// routed to the unset landing — see the scope comment in serializeChunk.
function dest(target: JumpTarget, scope: SerializeScope | null): string {
  const d = target.scene || target.label || UNSET_LABEL
  if (!scope) return d
  // A cross-scene jump is in-scope only if its SCENE is in scope (independent of
  // any label-name collision); a label-only target is judged by the label set.
  if (target.scene) return scope.scenes.has(target.scene) ? target.scene : UNSET_LABEL
  return scope.labels.has(d) ? d : UNSET_LABEL
}

function serializeNode(
  node: SceneNode,
  text: (key: string) => string,
  commands: Record<string, CommandSchema>,
  scope: SerializeScope | null = null,
): string {
  switch (node.kind) {
    case 'label':
      return `[label ${node.name}]`
    case 'say': {
      const face = node.face ? `(${node.face})` : ''
      const line = `${node.actor}${face}: ${text(node.textKey)}`
      // A per-line voice clip is queued by [voice ...] right before the dialogue;
      // the engine plays it alongside the line and mutes the synth typing blip.
      // The start-offset (correction) skips leading silence; emitted only if set.
      if (!node.voice) return line
      const off = node.voiceOffset
      const offPart = off && off > 0 ? ` offset=${off}` : ''
      return `[voice ${token(node.voice)}${offPart}]\n${line}`
    }
    case 'narrate':
      return `|${text(node.textKey)}`
    case 'choice':
      return node.options
        .map((o) => {
          const cond = o.condition ? ` if=${token(o.condition)}` : ''
          return `[choice ${token(text(o.labelKey))} -> ${dest(o.target, scope)}${cond}]`
        })
        .join('\n')
    case 'jump':
      // v1 DSL expresses a conditional jump as [if cond -> label].
      return node.condition
        ? `[if ${node.condition} -> ${dest(node.target, scope)}]`
        : `[jump ${dest(node.target, scope)}]`
    case 'set':
      return `[set ${node.var} = ${node.expr}]`
    case 'recall':
      // v1 DSL has no recall command; emit a comment the engine ignores. The recall
      // gallery is built from the IR directly, not from the runtime script.
      return `; recall ${node.recallId}`
    case 'command':
      return serializeCommand(node, commands[node.cmd])
    case 'anim':
      return serializeAnim(node)
    case 'eventframe':
      return serializeEventFrame(node)
    case 'loopstart':
      return serializeLoopStart(node)
    case 'loopstop':
      return serializeLoopStop(node)
    default: {
      const _exhaustive: never = node
      return _exhaustive
    }
  }
}

function serializeCommand(node: CommandNode, schema?: CommandSchema): string {
  const parts = [node.cmd]
  const params = node.params
  const used = new Set<string>()

  if (schema) {
    const positionals = schema.params
      .filter((p) => p.positional !== undefined)
      .sort((a, b) => a.positional! - b.positional!)

    // Emit positionals contiguously up to the last one actually provided,
    // filling any gaps with their defaults so the argument order stays intact.
    let last = -1
    positionals.forEach((p, i) => {
      if (params[p.key] !== undefined) last = i
    })
    for (let i = 0; i <= last; i++) {
      const p = positionals[i]!
      used.add(p.key)
      parts.push(token(params[p.key] ?? p.default ?? ''))
    }

    for (const p of schema.params) {
      if (p.positional !== undefined) continue
      used.add(p.key)
      const val = params[p.key]
      if (val === undefined) continue
      if (p.default !== undefined && val === p.default) continue
      parts.push(`${p.key}=${token(val)}`)
    }
  }

  // Params not described by the schema (e.g. unknown plugin command) -> key=value.
  for (const [k, v] of Object.entries(params)) {
    if (used.has(k)) continue
    parts.push(`${k}=${token(v)}`)
  }

  return `[${parts.join(' ')}]`
}

// A recorded keyframe animation (AnimNode) serializes to an `[anim …]` command the
// engine's built-in `anim` handler plays. The whole track rides one compact `kf`
// token (no whitespace / quotes / brackets, so the tokenizer carries it whole):
// frames joined by `;`, each `<t>:<code><n>,…[,e<easeCode>]` (bare `<t>` = empty),
// channel codes x / y / s(scale) / r(rotation) / o(opacity); `t` is seconds.
// The format mirrors the engine's parseAnimFrames (packages/engine/src/builtins.ts).
function serializeAnim(node: AnimNode): string {
  const parts = ['anim', `obj=${node.target}`, `dur=${compactNum(node.duration)}`]
  if (node.hold) parts.push('hold=1')
  const kf = encodeAnimFrames(node.keyframes)
  if (kf) parts.push(`kf=${kf}`)
  return `[${parts.join(' ')}]`
}

const ANIM_CODE: Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity', string> = {
  x: 'x',
  y: 'y',
  scale: 's',
  rotation: 'r',
  opacity: 'o',
}

function encodeAnimFrames(kfs: AnimKeyframe[]): string {
  return kfs
    .map((k) => {
      const ch: string[] = []
      for (const key of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
        const v = k[key]
        if (typeof v === 'number') ch.push(`${ANIM_CODE[key]}${compactNum(v)}`)
      }
      if (k.ease) ch.push(`e${k.ease}`)
      return ch.length ? `${compactNum(k.t)}:${ch.join(',')}` : compactNum(k.t)
    })
    .join(';')
}

// A recording event-frame (EventFrameNode) serializes to an `[eventframe …]`
// command played by the engine's pure-JS rAF clock. The whole choreography rides
// one compact `kf` token (no whitespace / quotes / brackets, so the tokenizer
// carries it whole). The grammar — decoded by the engine's `decodeTracks`
// (packages/engine/src/keyframes.ts), keep the two in sync:
//   kf    = TRACK ("|" TRACK)*
//   TRACK = <objId> "#" FRAME (";" FRAME)*
//   FRAME = <t> ["~" <easeCode>] [":" CH ("," CH)*]
//   CH    = <chId> "=" <value>      (number | string | "1"/"0" for booleans)
// Unlike `[anim]`, channels are addressed by their full recordable id (`scale`,
// `face`) rather than a single-letter code — the id is data, so a plugin channel
// round-trips with no shared code table (the "dynamic extraction" model).
function serializeEventFrame(node: EventFrameNode): string {
  const parts = ['eventframe', `dur=${compactNum(node.duration)}`]
  const kf = encodeTracks(node.tracks)
  if (kf) parts.push(`kf=${kf}`)
  return `[${parts.join(' ')}]`
}

function encodeTracks(tracks: ElementTrack[]): string {
  return tracks
    .filter((tr) => tr.keys.length > 0)
    .map((tr) => `${tr.objId}#${tr.keys.map(encodeKeyframe).join(';')}`)
    .join('|')
}

function encodeKeyframe(k: Keyframe): string {
  const head = k.ease ? `${compactNum(k.t)}~${k.ease}` : compactNum(k.t)
  const chs = Object.entries(k.ch).map(([id, v]) => `${id}=${encodeChannelValue(v)}`)
  return chs.length ? `${head}:${chs.join(',')}` : head
}

function encodeChannelValue(v: ChannelValue): string {
  if (typeof v === 'number') return compactNum(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return v
}

// A single-element loop (LoopStart/LoopStop) serializes to `[loopstart …]` /
// `[loopstop …]` commands played by the engine's loop runtime. The cycle `body`
// reuses the same compact frame encoding as one event-frame track (the objId rides
// `obj=` instead of an inline prefix); the anchor `entry` / settle `exit` poses are
// a bare channel set (`chId=val,…`). Each compound value is a single whitespace-
// and quote-free token, so the DSL tokenizer carries it whole (decoded by the
// engine's decodeFrames / decodeChannelSet — keep the two in sync).
function serializeLoopStart(node: LoopStartNode): string {
  const parts = ['loopstart', `obj=${node.objId}`, `dur=${compactNum(node.duration)}`]
  if (node.intoEase) parts.push(`into=${node.intoEase}`)
  const entry = encodeChannelSet(node.entry)
  if (entry) parts.push(`entry=${entry}`)
  const body = node.body.map(encodeKeyframe).join(';')
  if (body) parts.push(`body=${body}`)
  return `[${parts.join(' ')}]`
}

function serializeLoopStop(node: LoopStopNode): string {
  const parts = ['loopstop', `obj=${node.objId}`]
  if (node.outEase) parts.push(`out=${node.outEase}`)
  const exit = encodeChannelSet(node.exit)
  if (exit) parts.push(`exit=${exit}`)
  return `[${parts.join(' ')}]`
}

/** Encode a bare channel set (`entry` / `exit`) as `chId=val,chId=val`. */
function encodeChannelSet(ch: Record<string, ChannelValue>): string {
  return Object.entries(ch)
    .map(([id, v]) => `${id}=${encodeChannelValue(v)}`)
    .join(',')
}

/** A number as a compact token: round to 3 decimals, no trailing zeros. */
function compactNum(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

// Quote a token when it would otherwise break tokenization (whitespace, `]`, quotes, empty).
// The tokenizer has no escape syntax, so embedded double quotes are dropped.
function token(v: string | number | boolean): string {
  const s = String(v)
  if (s === '' || /[\s"\]]/.test(s)) return `"${s.replace(/"/g, '')}"`
  return s
}
