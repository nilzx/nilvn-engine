// Stage-object runtime model. A StageObject is any
// addressable visible element — a character, the camera, the screen overlay —
// distinct from an IR Node. Effects operate on objects through a scoped
// `StageObjectHandle`, never touching the DOM or the engine internals.
//
// This is the dependency-free runtime half. The editor-facing declarative half
// (ParamSchema kind-props, labels/icons for the insert panel) is layered on in
// increment 2b, which is why ParamSchema lives in @nilvn/core and not here.

import type { Renderer, TransformKeyframe, TransformProp, TransformValue, AnimOpts, ObjectBand } from './renderer/types.js'
import type { ObjectKind, ObjectKindDecl, RecordableProp, StageObjectHandle, StandardChannel } from './types.js'

/** Object ids are `kind:instance` (`character:yuki`) or a bare singleton kind
 *  (`camera`, `screen`). Derive the kind id from an object id. */
export function kindOf(objId: string): string {
  const i = objId.indexOf(':')
  return i === -1 ? objId : objId.slice(0, i)
}

// ---- recordable channels ----
// Reusable channel descriptors for the fixed transform schema, so every renderable
// kind exposes the same continuous channels with no per-kind boilerplate. Discrete
// channels (visible, face, layer, sprite frame) snap at the
// keyframe time. Each reads / writes only through the scoped object handle.

/** A continuous transform channel (x / y / scale / rotation / opacity, and the
 *  camera's colour grade). The
 *  descriptor coerces the value to a number (the "descriptor coerces" rule, like
 *  `visibleChannel`): the rAF player feeds numbers straight through, while a raw
 *  wire string (a loop's `entry` / `exit` pose, a hand-authored value) is parsed.
 *  A non-finite result is dropped rather than poisoning the transform model.
 *
 *  `x` / `y` are Lengths, so a trailing `%` is KEPT rather than coerced away: a
 *  percent offset resolves against the object's own box, which for the camera (the
 *  world wrapper, sized to the stage) makes a pan resolution-independent — the same
 *  authored value frames the same shot at any output size. A bare number stays
 *  pixels, so everything authored before (and `[shake]`'s pixel rumble) is unchanged. */
function transformChannel(id: TransformProp, label?: string): RecordableProp {
  const isLength = id === 'x' || id === 'y'
  return {
    id,
    label,
    mode: 'continuous',
    read: (h) => h.get(id) as number | string | undefined,
    apply: (h, v) => {
      const n = typeof v === 'string' ? parseFloat(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n)) return
      h.set(id, isLength && typeof v === 'string' && v.trimEnd().endsWith('%') ? `${n}%` : n)
    },
  }
}

/** Visibility as a discrete channel — coerces the wire value to a boolean. */
const visibleChannel: RecordableProp = {
  id: 'visible',
  label: 'channel.visible',
  mode: 'discrete',
  read: (h) => h.get('visible') as boolean | undefined,
  apply: (h, v) => h.set('visible', v === true || v === '1' || v === 'true'),
}

/** Face (expression) as a discrete channel — a string snapped at the keyframe
 *  time. The renderer swaps the sprite art via
 *  the `faceUrl` resolver stored at `showChar`; here we only pass the name through. */
const faceChannel: RecordableProp = {
  id: 'face',
  label: 'channel.face',
  mode: 'discrete',
  read: (h) => h.getFace(),
  apply: (h, v) => h.setFace(String(v)),
}

/** Z-band (layer) as a discrete channel — `world` / `front`, snapped at the keyframe
 *  time. Wraps the existing `getBand` / `setBand` seam so an event-frame can lift a
 *  character / sprite over the dialogue at a beat. Any non-`front` wire value settles
 *  to the home `world` band. */
export const bandChannel: RecordableProp = {
  id: 'band',
  label: 'channel.band',
  mode: 'discrete',
  read: (h) => h.getBand(),
  apply: (h, v) => h.setBand(v === 'front' || v === true ? 'front' : 'world'),
}

/** The full continuous set a positioned, fadeable object exposes (characters,
 *  sprites). The camera omits opacity / visibility (it has no fade of its own). */
export const FULL_TRANSFORM_CHANNELS: RecordableProp[] = [
  transformChannel('x', 'channel.x'),
  transformChannel('y', 'channel.y'),
  transformChannel('scale', 'channel.scale'),
  transformChannel('rotation', 'channel.rotation'),
  transformChannel('opacity', 'channel.opacity'),
  visibleChannel,
]

/** The camera's colour grade — six continuous numeric channels (hue in degrees,
 *  invert / grayscale 0..1, saturate / brightness / contrast as multipliers). Only
 *  the camera paints them (see `Transform`), so they are not standard channels a
 *  plugin kind could name: a character's dim is its own CSS filter. */
export const GRADE_CHANNELS: RecordableProp[] = [
  transformChannel('hue', 'channel.hue'),
  transformChannel('invert', 'channel.invert'),
  transformChannel('saturate', 'channel.saturate'),
  transformChannel('brightness', 'channel.brightness'),
  transformChannel('contrast', 'channel.contrast'),
  transformChannel('grayscale', 'channel.grayscale'),
]

/** The standard channels by id — what an {@link ObjectKindDecl} names instead of
 *  importing descriptors (a plugin declares `recordable: ['x', 'band']`). */
export const STANDARD_CHANNELS: Record<StandardChannel, RecordableProp> = {
  x: FULL_TRANSFORM_CHANNELS[0]!,
  y: FULL_TRANSFORM_CHANNELS[1]!,
  scale: FULL_TRANSFORM_CHANNELS[2]!,
  rotation: FULL_TRANSFORM_CHANNELS[3]!,
  opacity: FULL_TRANSFORM_CHANNELS[4]!,
  visible: visibleChannel,
  face: faceChannel,
  band: bandChannel,
}

/** Resolve a declared kind into the registered form: standard channel names →
 *  their descriptors, custom descriptors as given. An unknown name is dropped
 *  (the plugin host reports it). Returns the unknown names it dropped. */
export function resolveKind(decl: ObjectKindDecl): { kind: ObjectKind; unknown: string[] } {
  const unknown: string[] = []
  const recordable: RecordableProp[] = []
  for (const r of decl.recordable ?? []) {
    if (typeof r !== 'string') recordable.push(r)
    else if (r in STANDARD_CHANNELS) recordable.push(STANDARD_CHANNELS[r])
    else unknown.push(r)
  }
  const kind: ObjectKind = { id: decl.id, transformable: decl.transformable }
  if (decl.label !== undefined) kind.label = decl.label
  if (decl.recordable) kind.recordable = recordable
  return { kind, unknown }
}

/** Built-in object kinds the engine always registers. The
 *  `objectKinds` contribution point lets plugins add more (increment 3+). */
export const BUILTIN_KINDS: ObjectKind[] = [
  { id: 'character', label: 'objectKind.character', transformable: true, recordable: [...FULL_TRANSFORM_CHANNELS, faceChannel, bandChannel] },
  {
    id: 'camera',
    label: 'objectKind.camera',
    transformable: true,
    recordable: [
      transformChannel('x', 'channel.x'),
      transformChannel('y', 'channel.y'),
      transformChannel('scale', 'channel.scale'),
      transformChannel('rotation', 'channel.rotation'),
      ...GRADE_CHANNELS,
    ],
  },
  { id: 'screen', label: 'objectKind.screen', transformable: false },
  // UI windows (today the singleton dialogue box `window:dialog`). Screen-space —
  // NOT under the camera — but records / animates exactly like any world object;
  // its skin is a kind-prop driven by the built-in `[window]` command, not a channel.
  { id: 'window', label: 'objectKind.window', transformable: true, recordable: [...FULL_TRANSFORM_CHANNELS] },
]

/** A scoped handle over the renderer's generic object surface, bound to one
 *  object id. The single capability surface an effect touches for `objects`. */
export class ObjectHandle implements StageObjectHandle {
  constructor(
    private readonly renderer: Renderer,
    readonly id: string,
    readonly kind: string,
  ) {}

  get(prop: TransformProp): TransformValue | undefined {
    return this.renderer.getProp(this.id, prop)
  }

  set(prop: TransformProp, value: TransformValue): void {
    this.renderer.setProp(this.id, prop, value)
  }

  animate(keyframes: TransformKeyframe[], opts: AnimOpts): Promise<void> {
    return this.renderer.animate(this.id, keyframes, opts)
  }

  getBand(): ObjectBand | undefined {
    return this.renderer.getBand(this.id)
  }

  setBand(band: ObjectBand): void {
    this.renderer.setBand(this.id, band)
  }

  getFace(): string | undefined {
    return this.renderer.getFace(this.id)
  }

  setFace(face: string): void {
    this.renderer.setFace(this.id, face)
  }
}
