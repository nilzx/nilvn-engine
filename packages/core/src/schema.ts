// Declarative command & plugin schema — drives the editor UI so built-in commands and
// third-party plugin commands are edited the same way. Built-in schemas: commands.ts.

export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'asset:bg' // background picker
  | 'asset:bgm' // music picker
  | 'asset:se' // sound-effect picker
  | 'asset:sprite' // sprite-sheet picker
  | 'actor' // character picker
  | 'face' // expression picker (scoped to the chosen actor)
  | 'color' // color picker
  | 'expr' // variable expression builder

export interface ParamOption {
  value: string
  label: string
}

export interface ParamSchema {
  key: string
  label: string
  type: ParamType
  required?: boolean
  default?: string | number | boolean
  /** Choices when type === 'enum'. */
  options?: ParamOption[]
  /**
   * When set, this param serializes to a positional DSL argument at the given index
   * (e.g. [char yuki happy] => id at 0, face at 1). Otherwise it serializes as key=value.
   */
  positional?: number
  /** Tuck behind an "advanced" disclosure in the editor. */
  advanced?: boolean
}

export type CommandCategory = 'stage' | 'audio' | 'fx' | 'flow' | 'text'

export interface CommandSchema {
  name: string
  label: string
  category: CommandCategory
  /** One-line help shown in the editor. */
  hint?: string
  icon?: string
  params: ParamSchema[]
}

export interface TextEffectDef {
  name: string // used inline as {name:text}
  label?: string
  preview?: string
}

// ---- object model (editor-facing declarative mirror of the engine runtime) ----
// The engine (packages/engine/src/object.ts) owns the executable kinds/effects and
// the fixed transform schema; this is the declarative contract the editor reads to
// render a point-and-click palette. Kept separate so the editor never imports the
// engine and the engine never imports core.

/** Renderable object kind — what the editor needs to label/group stage objects.
 *  The transform schema (x/y/scale/rotation/opacity/zIndex/visible) is engine-owned
 *  and not mirrored here; the editor only addresses objects, never their transform. */
export interface ObjectKindSchema {
  id: string
  /** Display label, a t() key. */
  label: string
  /** Whether the kind exposes the transform schema (animatable). */
  transformable: boolean
  /** Emoji shown beside on-stage instances of this kind in the palette. */
  icon?: string
}

/** Built-in kinds, mirroring the engine's BUILTIN_KINDS. `character` is per-actor
 *  (the palette shows actor names), `camera`/`screen` are singletons. */
export const BUILTIN_OBJECT_KINDS: ObjectKindSchema[] = [
  { id: 'character', label: 'objectKind.character', transformable: true, icon: '🧍' },
  { id: 'camera', label: 'objectKind.camera', transformable: true, icon: '🎥' },
  { id: 'screen', label: 'objectKind.screen', transformable: false, icon: '🖥' },
  // UI windows — today the built-in `window:dialog` singleton (the dialogue box);
  // the future ui-kit plugin contributes more instances through the same kind path.
  { id: 'window', label: 'objectKind.window', transformable: true, icon: '🪟' },
]

/** A retargetable effect a plugin contributes, bound to kinds via `appliesToKinds`
 *  (matching the engine's static binding). Authors never insert an effect directly —
 *  they insert the `command` that applies it; this schema tells the editor
 *  how to offer the effect for an on-stage object and which CommandNode to produce. */
export interface EffectSchema {
  name: string
  /** Display label, a t() key. Used as the menu entry unless `fanout` is set. */
  label: string
  hint?: string
  icon?: string
  /** Kinds this effect can target. */
  appliesToKinds: string[]
  /** The command name that applies this effect (its CommandSchema drives the form). */
  command: string
  /** Per-kind params written onto the inserted command to point it at the chosen
   *  object. The sentinel '$id' is replaced with the object's instance id; a kind
   *  absent here (e.g. a singleton with an implicit default) targets implicitly. */
  targetParams?: Record<string, Record<string, string>>
  /** Name of an enum param to expand into one object-section entry per option
   *  (e.g. pose → hop/nod/shake/swing). The chosen value is written to that param. */
  fanout?: string
}

// The plugin manifest (v2) and its capability / extension-point catalogs live in
// plugin-manifest.ts; the command / effect / kind schemas above are what
// a manifest's `contributes` carries.
