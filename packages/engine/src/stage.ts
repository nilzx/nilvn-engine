// DOM stage: builds the layer tree and owns every visual primitive the
// engine and plugins manipulate.
//
//   .nilvn-root
//     .nilvn-camera          <- plugins shake/filter this for screen effects
//       .nilvn-bg            <- crossfading background items
//       .nilvn-chars         <- one .nilvn-char per visible character
//       .nilvn-fx            <- free overlay layer for plugins
//     .nilvn-dialog          <- name tag + typewriter text + click indicator
//     .nilvn-choices         <- choice buttons overlay
//     .nilvn-front           <- screen-space band for objects promoted over the
//                               dialogue (band='front'); empty by default
//     .nilvn-fader           <- full-screen fade for transitions

import type {
  Renderer,
  StageState,
  CharOptions,
  SpriteSpec,
  Transform,
  TransformProp,
  TransformValue,
  AnimFrame,
  AnimOpts,
  Length,
  ObjectBand,
  TransitionOpts,
  TypeLineOptions,
  ChoiceHandle,
  ChoicePrompt,
} from './renderer/types.js'
import type { Segment, TextSpan } from './types.js'

// Re-exported so existing importers (`import { StageState } from './stage.js'`) keep
// working now that the save shape lives with the renderer contract.
export type { StageState } from './renderer/types.js'

export function animate(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options?: number | KeyframeAnimationOptions,
): Promise<void> {
  const a = el.animate(keyframes, options)
  // Hidden pages throttle animations and `finished` may never resolve,
  // so race it against a wall-clock fallback that snaps to the end state.
  const duration = typeof options === 'number' ? options : typeof options?.duration === 'number' ? options.duration : 0
  const delay = typeof options === 'object' ? (options.delay ?? 0) : 0
  const iterations = typeof options === 'object' ? (options.iterations ?? 1) : 1
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      clearTimeout(timer)
      resolve()
    }
    if (iterations !== Infinity) {
      timer = setTimeout(() => {
        try {
          a.finish()
        } catch {
          /* already idle */
        }
        settle()
      }, duration * iterations + delay + 80)
    }
    a.finished.then(settle, settle)
  })
}

export async function preloadImage(url: string): Promise<void> {
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    console.warn(`[nilvn] failed to load image: ${url}`)
  }
}

const POSITIONS: Record<string, number> = { left: 25, center: 50, right: 75 }

function toLeft(at: string): string {
  if (at in POSITIONS) return `${POSITIONS[at]}%`
  const n = parseFloat(at)
  return Number.isFinite(n) ? `${n}%` : '50%'
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  return d
}

interface CharSlot {
  el: HTMLDivElement
  img: HTMLImageElement
  face?: string
  /** Unresolved script path the current image came from (saved instead of the URL). */
  ref?: string
  /** Resolve a face name to a sprite URL (from the actor's `{face}` template, with
   *  alias / asset-table resolution already applied by the engine). Lets `setFace`
   *  swap art on a recorded `face` keyframe; absent / undefined for raw-`src=`
   *  characters or an unresolvable face. */
  faceUrl?: (face: string) => string | undefined
  /** Resting transform model. Drives the generic object
   *  surface (setProp / animate); independent of `left` (the slot position). */
  transform: Transform
  /** Current z-band. Absent = home `world`. */
  band?: ObjectBand
}

interface SpriteSlot {
  el: HTMLDivElement
  /** Resting transform model — shares the generic object surface with characters;
   *  independent of the intrinsic CSS frame loop (which animates background-position). */
  transform: Transform
  /** Normalized spec it was built from (frames/fps/height resolved), for snapshot. */
  spec: SpriteSpec
  /** Current z-band. Absent = home `world`. */
  band?: ObjectBand
}

// The .nilvn-char element keeps a translateX(-50%) base transform for centering;
// every composed transform restates it (see transformStr). Character pose
// keyframes (hop / nod / swing) no longer live here — they moved into the charfx
// plugin as semantic TransformKeyframe[] and reach the DOM via `animate`.
const CHAR_BASE = 'translateX(-50%)'

/** Default resting transform — what an object reads as before any setProp. */
const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, visible: true, zIndex: null }
const freshTransform = (): Transform => ({ ...DEFAULT_TRANSFORM })

/** Parse a CSS percent ("37%") to a number, with a fallback for empty/NaN. NOT
 *  `parseFloat(...) || fallback`, which would coerce a real 0 (left/floor edge) away. */
const pctOr = (v: string, fallback: number): number => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** The non-identity resting-pose channels of a slot, for the snapshot: `y` (the
 *  CSS `bottom` % placement), `scale` / `rotation`, and — added for save model B
 * — the transform x/y offsets (`tx` / `ty`),
 *  `opacity` and `visible` a recording event-frame commits as its end pose. Each
 *  is omitted at its identity so saves stay compact and an older loader that
 *  ignores the new fields is unaffected.
 *
 *  `tx` / `ty` keep their unit, exactly as `cameraState` does: an offset authored
 *  as a percent is a fraction of the object's own box, and dropping it (as a
 *  `typeof === 'number'` gate used to) left a character standing at its unmoved
 *  position after a load — silently, since every OTHER channel came back. */
function restingState(slot: { el: HTMLElement; transform: Transform }): {
  y?: number
  scale?: number
  rotation?: number
  tx?: Length
  ty?: Length
  opacity?: number
  visible?: boolean
} {
  const out: { y?: number; scale?: number; rotation?: number; tx?: Length; ty?: Length; opacity?: number; visible?: boolean } = {}
  const y = parseFloat(slot.el.style.bottom)
  if (Number.isFinite(y) && y !== 0) out.y = y
  const t = slot.transform
  if (t.scale !== 1) out.scale = t.scale
  if (t.rotation !== 0) out.rotation = t.rotation
  if (!isZeroLen(t.x)) out.tx = t.x
  if (!isZeroLen(t.y)) out.ty = t.y
  if (t.opacity !== 1) out.opacity = t.opacity
  if (!t.visible) out.visible = false
  return out
}

/** The held full-screen cover, or undefined when the screen is clear.
 *
 *  `[transout]` / `[fadeout]` hand the screen to the fader and it STAYS there until a
 *  reveal — across dialogue, across a scene change, across everything. That latch is part
 *  of the visible stage, so a save taken under one has to come back under it; a load that
 *  cleared it would resume onto the scene the story is still hiding. Read off the INLINE
 *  opacity rather than the computed one: both fade paths set the target before animating
 *  to it, so this captures the settled state even if a save lands mid-fade. */
function coverState(fader: HTMLElement): StageState['cover'] {
  const opacity = parseFloat(fader.style.opacity)
  if (!(opacity > 0)) return undefined
  return { color: fader.style.background || '#000', opacity: Math.round(opacity * 1000) / 1000 }
}

/** The camera's non-identity resting channels for the snapshot; undefined when the
 *  camera is at identity, so pre-camera saves and loaders are byte-identical. Only
 *  numeric x/y offsets persist (mirrors restingState's tx/ty rule). opacity /
 *  visible ride along because `[fade|opacity|visibility target=screen]` resolve to
 *  the camera and PERSIST there (objectfx writes the resting model) — without them a
 *  save taken under a screen dim would come back at full brightness. */
function cameraState(t: Transform): StageState['camera'] {
  const out: NonNullable<StageState['camera']> = {}
  // Unlike restingState's tx/ty (pixels only), the camera keeps a percent pan as-is —
  // that unit IS the point of an authored shot, and dropping it would reframe the
  // picture on load at any other output size.
  if (!isZeroLen(t.x)) out.x = t.x
  if (!isZeroLen(t.y)) out.y = t.y
  if (t.scale !== 1) out.scale = t.scale
  if (t.rotation !== 0) out.rotation = t.rotation
  if (t.opacity !== 1) out.opacity = t.opacity
  if (!t.visible) out.visible = false
  return Object.keys(out).length ? out : undefined
}

/** The dialogue window's non-identity resting channels + skin for the snapshot;
 *  undefined when the window is untouched, so pre-window saves and loaders are
 *  byte-identical (same discipline as `cameraState`). Percent offsets pass through
 *  with their unit — they resolve against the window's own box on load. */
function windowsState(t: Transform, skin: string | undefined): StageState['windows'] {
  const out: NonNullable<StageState['windows']>[number] = { id: 'dialog' }
  if (!isZeroLen(t.x)) out.x = t.x
  if (!isZeroLen(t.y)) out.y = t.y
  if (t.scale !== 1) out.scale = t.scale
  if (t.rotation !== 0) out.rotation = t.rotation
  if (t.opacity !== 1) out.opacity = t.opacity
  if (!t.visible) out.visible = false
  if (skin) out.skin = skin
  return Object.keys(out).length > 1 ? [out] : undefined
}

/** A length value to CSS: a bare number is pixels, a string passes through. */
const lengthCss = (v: Length): string => (typeof v === 'number' ? `${v}px` : v)
const isZeroLen = (v: Length): boolean => v === 0 || v === '0%'

/** Compose a transform model into a CSS transform string over a base anchor. The
 *  resting default (all zero/identity) collapses to just the base, so an
 *  un-transformed object keeps its plain CSS transform (pixel-identical). */
function transformStr(base: string, t: Transform): string {
  const translate = isZeroLen(t.x) && isZeroLen(t.y) ? null : `${lengthCss(t.x)}, ${lengthCss(t.y)}`
  return composeTransform(base, translate, t.scale, t.rotation)
}

/** Compose a DELTA frame over a resting model (AnimOpts.compose = 'offset'): a
 *  transient gesture displaces the object from wherever it currently sits instead of
 *  replacing its pose. Each channel composes by its own identity — x/y add, rotation
 *  adds, scale multiplies. */
function offsetTransformStr(base: string, m: Transform, d: Partial<Transform>): string {
  const moves = !isZeroLen(m.x) || !isZeroLen(m.y) || !isZeroLen(d.x ?? 0) || !isZeroLen(d.y ?? 0)
  const translate = moves ? `${addLenCss(m.x, d.x)}, ${addLenCss(m.y, d.y)}` : null
  return composeTransform(base, translate, round5(m.scale * (d.scale ?? 1)), round5(m.rotation + (d.rotation ?? 0)))
}

/** Composing a delta does arithmetic on authored decimals, so trim the float dust
 *  (2 × 1.1 = 2.2000000000000002) before it reaches the CSS. */
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

function composeTransform(base: string, translate: string | null, scale: number, rotation: number): string {
  const parts: string[] = []
  if (base) parts.push(base)
  if (translate !== null) parts.push(`translate(${translate})`)
  if (scale !== 1) parts.push(`scale(${scale})`)
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`)
  return parts.join(' ') || 'none'
}

/** CSS for a delta length over a base length. Same units add numerically; mixed ones
 *  (a percent camera pan displaced by a pixel rumble) hand the sum to CSS `calc`,
 *  which resolves it against the same box the percent already refers to. */
function addLenCss(base: Length, delta: Length | undefined): string {
  if (delta === undefined || isZeroLen(delta)) return lengthCss(base)
  if (isZeroLen(base)) return lengthCss(delta)
  if (typeof base === 'number' && typeof delta === 'number') return `${round5(base + delta)}px`
  if (typeof base === 'string' && typeof delta === 'string') return `${round5(parseFloat(base) + parseFloat(delta))}%`
  const n = typeof delta === 'number' ? delta : parseFloat(delta)
  const unit = typeof delta === 'number' ? 'px' : '%'
  // Split the sign out rather than emitting `calc(10px + -3px)` — the spec allows it,
  // but the readable form is also the one every engine has always parsed.
  return `calc(${lengthCss(base)} ${n < 0 ? '-' : '+'} ${Math.abs(n)}${unit})`
}

/** A renderer-resolved object: the DOM element, its base anchor, and its model. */
interface ObjRef {
  el: HTMLElement
  base: string
  model: Transform
}

const BASE_CSS = `
.nilvn-root{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;user-select:none;cursor:pointer;container-type:size;color:#f4f5fa}
.nilvn-layer{position:absolute;inset:0}
.nilvn-camera{position:absolute;inset:0}
.nilvn-bg-item{position:absolute;inset:0;background-size:cover;background-position:center}
.nilvn-fx{pointer-events:none}
.nilvn-front{pointer-events:none}
.nilvn-sprites{pointer-events:none}
.nilvn-char{position:absolute;bottom:0;height:88%;transform:translateX(-50%);transition:left .45s ease,filter .35s ease}
.nilvn-char img{height:100%;width:auto;display:block;pointer-events:none}
.nilvn-char.nilvn-dim{filter:brightness(.55) saturate(.7)}
.nilvn-sprite{position:absolute;bottom:0;transform:translateX(-50%);background-repeat:no-repeat;background-position:0 0;pointer-events:none}
.nilvn-editing .nilvn-sprite{pointer-events:auto}
.nilvn-editing .nilvn-char{transition:none}
.nilvn-dialog{position:absolute;left:3.5%;bottom:3.5cqh;width:93%;min-height:24cqh;box-sizing:border-box;border-radius:1.8cqh;padding:3.6cqh 3cqw 2cqh;background:linear-gradient(180deg,rgba(22,26,42,.82),rgba(10,12,22,.92));border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px);transition:opacity .3s}
.nilvn-dialog.nilvn-hidden{opacity:0!important;pointer-events:none}
.nilvn-name{position:absolute;top:-2cqh;left:2.4cqw;background:var(--name-color,#7c5cff);color:#fff;font-weight:700;font-size:2.7cqh;line-height:1;padding:1.1cqh 1.6cqw;border-radius:99px;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.nilvn-name.nilvn-hidden{display:none}
.nilvn-text{font-size:3.4cqh;line-height:1.75;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.nilvn-ch{opacity:0;display:inline-block;white-space:pre}
.nilvn-ch.on{opacity:1}
.nilvn-indicator{position:absolute;right:2.4cqw;bottom:1.8cqh;width:0;height:0;border-left:.9cqh solid transparent;border-right:.9cqh solid transparent;border-top:1.4cqh solid rgba(255,255,255,.85);opacity:0}
.nilvn-indicator.on{opacity:1;animation:nilvn-blink 1s ease-in-out infinite}
@keyframes nilvn-blink{50%{transform:translateY(.5cqh);opacity:.3}}
.nilvn-choices{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2.6cqh;background:rgba(5,6,12,.35)}
.nilvn-choices.on{display:flex}
.nilvn-choice{min-width:38cqw;padding:2cqh 3cqw;font:inherit;font-size:3cqh;color:#fff;text-align:center;background:linear-gradient(180deg,rgba(40,46,74,.92),rgba(24,28,48,.92));border:1px solid rgba(255,255,255,.2);border-radius:99px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
.nilvn-choice:hover{transform:translateY(-2px) scale(1.02);border-color:rgba(140,160,255,.9);box-shadow:0 6px 24px rgba(80,100,255,.25)}
.nilvn-fader{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
`

/**
 * The stable, renderer-agnostic surface the director-style editor uses to
 * decorate and hit-test the live stage. It hides the engine's internal DOM
 * structure — the `.nilvn-*` class names and the exact dialog/name/text layout —
 * so the editor never reaches into Stage's concrete shape. A future non-DOM
 * renderer (WebGL / Live2D) can satisfy the same contract.
 *
 * The three dialogue regions are real DOM elements on purpose: inline text
 * editing (contentEditable, caret placement, ResizeObserver) and pixel-anchored
 * overlays need the actual nodes. This is the one deliberate DOM escape hatch —
 * even a WebGL renderer would float the editable dialogue in the DOM above the
 * canvas. Everything else (character hit-testing, containment) goes through
 * methods, so the class/structure contract stays hidden.
 */
export interface EditStage {
  /** Stage root — host for the editor's overlay layer and the bounding box for
   *  pointer hit-testing. */
  readonly root: HTMLElement
  /** Dialogue box container — the editor mounts its toolbars here and makes the
   *  box click-to-edit. */
  readonly dialogBox: HTMLElement
  /** Speaker name tag — clickable to switch / append a speaker. */
  readonly nameTag: HTMLElement
  /** Whether the speaker name tag is currently shown (the editor positions its
   *  toolbar relative to it). Hides the engine's visibility mechanism. */
  nameVisible(): boolean
  /** Dialogue text body — the editor makes this contentEditable for inline
   *  authoring. */
  readonly textBody: HTMLElement
  /** On-stage sprite element for an actor id, or null when not shown. */
  charElement(id: string): HTMLElement | null
  /** Actor id of the on-stage character at/under a pointer target (the target
   *  may be a child node such as the sprite `<img>`), or null. */
  charIdAt(target: EventTarget | null): string | null
  /** Full object id (`character:<id>` / `sprite:<id>`) of the on-stage object
   *  at/under a pointer target, or null. Generalizes `charIdAt` to any bandable
   *  kind so the editor can select / manipulate sprites too. */
  objectIdAt(target: EventTarget | null): string | null
  /** DOM element for an object id (`character:<id>` / `sprite:<id>`), or null —
   *  the box the editor measures to anchor selection / handles. */
  objectElement(objId: string): HTMLElement | null
  /** Every live addressable transformable object, world objects first, then the
   *  screen-space singletons (`camera`, `window:dialog`). The editor's generic
   *  enumeration seam: the recording palette lists these instead of hardcoding
   *  kinds, so a new kind (a future ui-kit control) appears with zero palette
   *  changes. */
  objectIds(): string[]
  /** Toggle pointer hit-testing for normally non-interactive stage objects. During
   *  play sprites are `pointer-events:none` so clicks advance the story; the editor
   *  turns them on in edit mode to select / drag them. */
  setObjectsInteractive(on: boolean): void
  /** Generic transform read/write (the object surface). The editor drives these for
   *  live scale / rotate preview while dragging a handle, before committing the value
   *  to the object's birth command params. */
  setProp(objId: string, prop: TransformProp, value: TransformValue): void
  getProp(objId: string, prop: TransformProp): TransformValue | undefined
  /** Any on-stage character element, for first-run coachmarks; null if none. */
  firstCharElement(): HTMLElement | null
  /** Whether a pointer target lies within the dialogue box (including the
   *  editor's own toolbars nested inside it), so the text layer can claim it. */
  isDialogTarget(target: EventTarget | null): boolean
}

export class DomRenderer implements Renderer, EditStage {
  readonly root: HTMLDivElement
  readonly camera: HTMLDivElement
  readonly bgLayer: HTMLDivElement
  readonly charLayer: HTMLDivElement
  /** Layer holding sprite-frame objects, above characters, below the free fx layer */
  readonly spriteLayer: HTMLDivElement
  /** Free overlay layer (pointer-events: none) for plugin visuals */
  readonly fxLayer: HTMLDivElement
  readonly dialog: HTMLDivElement
  readonly nameEl: HTMLDivElement
  readonly textEl: HTMLDivElement
  readonly indicator: HTMLDivElement
  readonly choicesEl: HTMLDivElement
  /** Screen-space band hosting objects promoted over the dialogue (band='front').
   *  Sits above dialogue/choices, below the transition fader; empty by default. */
  readonly frontLayer: HTMLDivElement
  readonly fader: HTMLDivElement

  private chars = new Map<string, CharSlot>()
  private sprites = new Map<string, SpriteSlot>()
  /** Resting transform for the `camera` object (singleton, always present). */
  private cameraModel = freshTransform()
  /** Resting transform for the `window:dialog` object (singleton, always present).
   *  The dialog's CSS centering is layout-based (`left:3.5%` = (100−width 93%)/2) on
   *  purpose: `transform` belongs to this pose model EXCLUSIVELY — mixing layout into
   *  the composed transform is what broke camera animation once. */
  private windowModel = freshTransform()
  /** Current skin URL on the dialogue window; undefined = default chrome. */
  private windowSkin: string | undefined
  /** The skin's unresolved ref, saved in place of the URL when known. */
  private windowSkinRef: string | undefined
  /** The background image's unresolved ref (saved in place of the CSS). */
  private bgRef: string | undefined
  /** Bumped by every `restore` — a wholesale repaint of the stage from a save. An
   *  in-flight screen transition compares it across its awaits so a load / restart /
   *  replay that lands mid-`[transout]` isn't blacked out by the transition finishing
   *  into the freshly restored screen. */
  private restoreGen = 0

  constructor(container: HTMLElement) {
    this.root = div('nilvn-root')
    this.camera = div('nilvn-camera')
    this.bgLayer = div('nilvn-layer nilvn-bg')
    this.charLayer = div('nilvn-layer nilvn-chars')
    this.spriteLayer = div('nilvn-layer nilvn-sprites')
    this.fxLayer = div('nilvn-layer nilvn-fx')
    this.camera.append(this.bgLayer, this.charLayer, this.spriteLayer, this.fxLayer)

    this.dialog = div('nilvn-dialog nilvn-hidden')
    this.nameEl = div('nilvn-name nilvn-hidden')
    this.textEl = div('nilvn-text')
    this.indicator = div('nilvn-indicator')
    this.dialog.append(this.nameEl, this.textEl, this.indicator)

    this.choicesEl = div('nilvn-choices')
    this.choicesEl.addEventListener('click', (e) => e.stopPropagation())

    this.frontLayer = div('nilvn-layer nilvn-front')
    this.fader = div('nilvn-fader')

    this.root.append(this.camera, this.dialog, this.choicesEl, this.frontLayer, this.fader)
    container.append(this.root)
    this.injectStyle(BASE_CSS, 'nilvn-base-style')
  }

  /** Inject a stylesheet once; pass an id to dedupe (plugins use plugin name).
   *  Engine-internal: NOT on the `Renderer` interface, so plugins can't inject
   *  arbitrary CSS at runtime (the `addStyle` DOM leak was sealed in 2a — plugins
   *  declare `styles` declaratively and the engine drives this). A non-DOM backend
   *  has no equivalent; plugin CSS is meaningful only for the DOM dialogue layer. */
  injectStyle(css: string, id?: string, attrs?: Record<string, string>): void {
    if (id && document.getElementById(id)) return
    const style = document.createElement('style')
    if (id) style.id = id
    for (const [k, v] of Object.entries(attrs ?? {})) style.setAttribute(k, v)
    style.textContent = css
    document.head.append(style)
  }

  /** Remove a stylesheet injected with an id (a deactivated plugin's `styles`). */
  removeStyle(id: string): void {
    document.getElementById(id)?.remove()
  }

  async setBackground(opts: { url?: string; color?: string; ref?: string }, fadeSec = 0): Promise<void> {
    const item = div('nilvn-bg-item')
    if (opts.url) {
      await preloadImage(opts.url)
      item.style.backgroundImage = `url("${opts.url}")`
      this.bgRef = opts.ref
    } else {
      item.style.background = opts.color ?? '#000'
      this.bgRef = undefined
    }
    const old = [...this.bgLayer.children]
    this.bgLayer.append(item)
    if (fadeSec > 0) await animate(item, [{ opacity: 0 }, { opacity: 1 }], { duration: fadeSec * 1000, easing: 'ease' })
    for (const n of old) n.remove()
  }

  /** Apply a birth transform carried by a show command: the vertical slot offset
   *  (`y` → CSS `bottom`, mirroring `at` → `left`) plus the resting transform's
   *  scale / rotation channels. Each is applied only when present, so a bare update
   *  command (e.g. `[char yuki happy]`) never resets a value an effect changed
   *. */
  private applyBirthTransform(
    el: HTMLElement,
    model: Transform,
    opts: { y?: number; scale?: number; rotation?: number },
  ): void {
    if (opts.y !== undefined) el.style.bottom = `${opts.y}%`
    if (opts.scale !== undefined) model.scale = opts.scale
    if (opts.rotation !== undefined) model.rotation = opts.rotation
    this.applyModel({ el, base: CHAR_BASE, model })
  }

  async showChar(id: string, url: string, opts: CharOptions = {}): Promise<void> {
    await preloadImage(url)
    let slot = this.chars.get(id)
    if (!slot) {
      const img = new Image()
      img.src = url
      img.draggable = false
      const el = div('nilvn-char')
      el.dataset.id = id
      el.style.left = toLeft(opts.at ?? 'center')
      el.append(img)
      this.charLayer.append(el)
      slot = { el, img, face: opts.face, faceUrl: opts.faceUrl, ref: opts.ref, transform: freshTransform() }
      this.chars.set(id, slot)
      this.applyBirthTransform(el, slot.transform, opts)
      const fade = opts.fade ?? 0.3
      if (fade > 0) await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: fade * 1000, easing: 'ease' })
      return
    }
    if (slot.img.src !== url) {
      slot.img.src = url
      slot.ref = opts.ref
      void animate(slot.img, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 160 })
    } else if (opts.ref !== undefined) slot.ref = opts.ref
    if (opts.face) slot.face = opts.face
    if (opts.faceUrl) slot.faceUrl = opts.faceUrl
    if (opts.at) slot.el.style.left = toLeft(opts.at)
    this.applyBirthTransform(slot.el, slot.transform, opts)
  }

  async moveChar(id: string, at: string, timeSec = 0.45): Promise<void> {
    const slot = this.chars.get(id)
    if (!slot) return
    slot.el.style.transitionDuration = `${timeSec}s`
    slot.el.style.left = toLeft(at)
    await new Promise((r) => setTimeout(r, timeSec * 1000))
    slot.el.style.transitionDuration = ''
  }

  async hideChar(id: string, fadeSec = 0.3): Promise<void> {
    const slot = this.chars.get(id)
    if (!slot) return
    this.chars.delete(id)
    if (fadeSec > 0) await animate(slot.el, [{ opacity: 1 }, { opacity: 0 }], { duration: fadeSec * 1000, easing: 'ease' })
    slot.el.remove()
  }

  async clearChars(fadeSec = 0.3): Promise<void> {
    await Promise.all([...this.chars.keys()].map((id) => this.hideChar(id, fadeSec)))
  }

  hasChar(id: string): boolean {
    return this.chars.has(id)
  }

  charFace(id: string): string | undefined {
    return this.chars.get(id)?.face
  }

  // ---- sprite-frame objects ----
  // The renderer-owned frame-stepping primitive backing the `spriteanim` plugin's
  // `sprite` kind. A single-row sheet is played by animating background-position-x
  // with CSS `steps()` — DOM-native, GPU-cheap, and runs even on a hidden page
  // (unlike WAAPI/rAF). The sprite is a transformable object, so it joins the
  // generic transform surface (resolveObject) and reuses the same setProp/animate.

  /** Inject (once) the keyframes that step a `cols`-frame single-row sheet (with
   *  background-size-x = cols*100%) and return their name. Two idioms, because the
   *  wrapped vs. held frame differs:
   *  - **loop**: sweep background-position-x 0% → cols/(cols-1)*100% under
   *    `steps(cols)` (jump-end). Playback lands exactly on frames 0…cols-1; the
   *    endpoint (cols/(cols-1)*100% = frame `cols`, off the strip) is only the wrap
   *    target, instantly replaced by frame 0 on the next iteration — never shown.
   *  - **once**: sweep 0% → 100% under `steps(cols, jump-none)`, whose last sampled
   *    step IS frame cols-1; `forwards` then holds that real frame. (Reusing the loop
   *    idiom here would instead hold the off-strip endpoint — a blank frame.) */
  private spriteKeyframes(cols: number, loop: boolean): string {
    const id = loop ? `nilvn-sprite-${cols}` : `nilvn-sprite-once-${cols}`
    if (cols > 1 && !document.getElementById(`${id}-kf`)) {
      const to = loop ? ((cols / (cols - 1)) * 100).toFixed(4) : '100'
      this.injectStyle(`@keyframes ${id}{from{background-position-x:0%}to{background-position-x:${to}%}}`, `${id}-kf`)
    }
    return id
  }

  async showSprite(id: string, spec: SpriteSpec, fadeSec = 0.3): Promise<void> {
    const cols = Math.max(1, Math.round(spec.frames || 1))
    const fps = spec.fps > 0 ? spec.fps : 12
    const height = spec.height ?? 30
    // Measure the sheet so the element box is exactly one frame (width follows the
    // per-frame aspect ratio); decode failures fall back to a square frame.
    const probe = new Image()
    probe.src = spec.url
    try {
      await probe.decode()
    } catch {
      console.warn(`[nilvn] failed to load sprite sheet: ${spec.url}`)
    }
    const frameRatio = probe.naturalWidth && probe.naturalHeight ? probe.naturalWidth / cols / probe.naturalHeight : 1

    let slot = this.sprites.get(id)
    const fresh = !slot
    const prev = slot?.spec // previous frame-spec, captured before the overwrite below
    if (!slot) {
      const el = div('nilvn-sprite')
      el.dataset.id = id
      this.spriteLayer.append(el)
      slot = { el, transform: freshTransform(), spec: { ...spec, frames: cols, fps, height } }
      this.sprites.set(id, slot)
    } else {
      slot.spec = { ...spec, frames: cols, fps, height }
    }
    const el = slot.el
    el.style.left = toLeft(spec.at ?? 'center')
    el.style.height = `${height}%`
    el.style.aspectRatio = String(frameRatio)
    el.style.backgroundImage = `url("${spec.url}")`
    el.style.backgroundSize = `${cols * 100}% 100%`
    // (Re)start the frame loop from frame 0 ONLY when the frame parameters change.
    // The editor reconciles by re-showing every sprite on each refresh; re-showing
    // an unchanged sprite must NOT snap a running animation back to frame 0. Position
    // / height / transform updates above are cheap and frame-loop-neutral.
    const frameChanged =
      fresh || !prev || prev.url !== spec.url || prev.frames !== cols || prev.fps !== fps || prev.loop !== spec.loop
    if (frameChanged) {
      el.style.animation = 'none'
      void el.offsetWidth
      if (cols > 1) {
        const kf = this.spriteKeyframes(cols, spec.loop)
        const dur = (cols / fps).toFixed(3)
        el.style.animation = spec.loop
          ? `${kf} ${dur}s steps(${cols}) infinite`
          : `${kf} ${dur}s steps(${cols}, jump-none) 1 forwards`
      } else {
        el.style.animation = ''
      }
    }
    // Seed any birth transform (y / scale / rotation), restate the centering base,
    // and fade a fresh sprite in.
    this.applyBirthTransform(el, slot.transform, spec)
    if (fresh && fadeSec > 0) await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: fadeSec * 1000, easing: 'ease' })
  }

  async hideSprite(id: string, fadeSec = 0.3): Promise<void> {
    const slot = this.sprites.get(id)
    if (!slot) return
    this.sprites.delete(id)
    if (fadeSec > 0) await animate(slot.el, [{ opacity: 1 }, { opacity: 0 }], { duration: fadeSec * 1000, easing: 'ease' })
    slot.el.remove()
  }

  /** Remove every sprite-frame object (used by restore). */
  async clearSprites(fadeSec = 0): Promise<void> {
    await Promise.all([...this.sprites.keys()].map((id) => this.hideSprite(id, fadeSec)))
  }

  // ---- generic object transform surface ----
  // Effects address objects by id and read/write only the fixed transform schema
  // through these; the bespoke shakeCamera / shakeChar / animateChar verbs were
  // collapsed into built-in effects that feed semantic TransformKeyframe[] here.
  // A non-DOM backend reimplements just this surface (camera matrix, sprite
  // transform)

  /** Resolve an object id to its DOM element, base anchor, and transform model;
   *  null for the non-transformable `screen` and unknown ids. */
  private resolveObject(objId: string): ObjRef | null {
    if (objId === 'camera') return { el: this.camera, base: '', model: this.cameraModel }
    // The dialogue window is a screen-space singleton like the camera: always present,
    // its element laid out by CSS, its transform owned entirely by the pose model.
    if (objId === 'window:dialog') return { el: this.dialog, base: '', model: this.windowModel }
    if (objId.startsWith('character:')) {
      const slot = this.chars.get(objId.slice('character:'.length))
      return slot ? { el: slot.el, base: CHAR_BASE, model: slot.transform } : null
    }
    if (objId.startsWith('sprite:')) {
      const slot = this.sprites.get(objId.slice('sprite:'.length))
      return slot ? { el: slot.el, base: CHAR_BASE, model: slot.transform } : null
    }
    return null
  }

  hasObject(objId: string): boolean {
    if (objId === 'camera' || objId === 'screen' || objId === 'window:dialog') return true
    if (objId.startsWith('character:')) return this.chars.has(objId.slice('character:'.length))
    if (objId.startsWith('sprite:')) return this.sprites.has(objId.slice('sprite:'.length))
    return false
  }

  getProp(objId: string, prop: TransformProp): TransformValue | undefined {
    return this.resolveObject(objId)?.model[prop]
  }

  setProp(objId: string, prop: TransformProp, value: TransformValue): void {
    const ref = this.resolveObject(objId)
    if (!ref) return
    // Writing through a union-keyed object needs a mutable-record view.
    ;(ref.model as Record<TransformProp, TransformValue>)[prop] = value
    this.applyModel(ref)
  }

  /** Paint a resolved object's resting model onto its element (immediate, no
   *  animation). Only touches transform / opacity / visibility / z-index. */
  private applyModel(ref: ObjRef): void {
    const { el, base, model } = ref
    // The dialog's CSS opacity transition serves the show/hide class toggle; while a
    // pose owns opacity (a recorded window fade, a rAF loop writing it per frame) the
    // transition would smear every write, so it stands down until the pose releases.
    if (el === this.dialog) el.style.transitionProperty = model.opacity === 1 ? '' : 'none'
    el.style.transform = transformStr(base, model)
    el.style.opacity = model.opacity === 1 ? '' : String(model.opacity)
    el.style.visibility = model.visible ? '' : 'hidden'
    el.style.zIndex = model.zIndex === null ? '' : String(model.zIndex)
  }

  async animate(objId: string, keyframes: AnimFrame[], opts: AnimOpts): Promise<void> {
    const ref = this.resolveObject(objId)
    if (!ref || keyframes.length === 0) return
    // Animate only the channels some keyframe actually touches, so a transform-
    // only effect (hop / shake) doesn't redundantly tween opacity. Each frame
    // composes over the resting model, so an animation respects a prior setProp.
    const touchesTransform = keyframes.some((k) => k.x !== undefined || k.y !== undefined || k.scale !== undefined || k.rotation !== undefined)
    const touchesOpacity = keyframes.some((k) => k.opacity !== undefined)
    // 'offset' frames are DELTAS over the resting pose (a transient gesture); the
    // default 'absolute' replaces the channels it names (a state change). See AnimOpts.
    const offsetMode = opts.compose === 'offset'
    const frames: Keyframe[] = keyframes.map((k) => {
      // Pull the WAAPI timing fields off; the rest are transform channels composed
      // over the resting model (so an animation respects a prior setProp).
      const { offset, easing, ...channels } = k
      const m: Transform = offsetMode ? ref.model : { ...ref.model, ...channels }
      const frame: Keyframe = {}
      if (touchesTransform) frame.transform = offsetMode ? offsetTransformStr(ref.base, ref.model, channels) : transformStr(ref.base, m)
      if (touchesOpacity) frame.opacity = offsetMode ? m.opacity * (channels.opacity ?? 1) : m.opacity
      if (offset !== undefined) frame.offset = offset
      if (easing !== undefined) frame.easing = easing
      return frame
    })
    await animate(ref.el, frames, { duration: opts.durationSec * 1000, easing: opts.easing ?? 'ease', iterations: opts.iterations ?? 1 })
  }

  // ---- fixed z-bands ----
  // A band is a *structural* placement: which layer container an element is
  // parented to, not a transform — hence its own seam, not a Transform prop. Only
  // character / sprite are bandable (the camera IS the world wrapper; the screen
  // overlay has no element). Promoting to `front` reparents the element out of the
  // camera into the screen-space front layer, so it paints over the dialogue and
  // stops following camera shake / zoom. Reparenting (not z-index) is required: a
  // shaken camera has a `transform`, forming a stacking context the dialogue — a
  // camera sibling — sits outside, so no in-camera z-index can rise above it.

  /** The home (world-space, in-camera) container for a bandable kind. */
  private homeBandEl(kind: string): HTMLElement {
    return kind === 'character' ? this.charLayer : this.spriteLayer
  }

  /** Resolve a bandable object id to its slot + kind; null for camera / screen /
   *  absent objects (which have no movable element). */
  private bandSlot(objId: string): { slot: CharSlot | SpriteSlot; kind: string } | null {
    if (objId.startsWith('character:')) {
      const slot = this.chars.get(objId.slice('character:'.length))
      return slot ? { slot, kind: 'character' } : null
    }
    if (objId.startsWith('sprite:')) {
      const slot = this.sprites.get(objId.slice('sprite:'.length))
      return slot ? { slot, kind: 'sprite' } : null
    }
    return null
  }

  getBand(objId: string): ObjectBand | undefined {
    const b = this.bandSlot(objId)
    return b ? (b.slot.band ?? 'world') : undefined
  }

  setBand(objId: string, band: ObjectBand): void {
    const b = this.bandSlot(objId)
    if (!b) return
    b.slot.band = band === 'front' ? 'front' : undefined
    const target = band === 'front' ? this.frontLayer : this.homeBandEl(b.kind)
    if (b.slot.el.parentElement !== target) target.append(b.slot.el)
  }

  // ---- character face (a discrete recordable channel —) ----
  // Only the `character` kind has a face; sprites / camera are faceless. The art swap
  // reuses the `faceUrl` resolver captured at showChar (the engine owns path / asset
  // resolution), so a recorded `face` keyframe works in single-file exports too.

  getFace(objId: string): string | undefined {
    if (!objId.startsWith('character:')) return undefined
    return this.chars.get(objId.slice('character:'.length))?.face
  }

  setFace(objId: string, face: string): void {
    if (!objId.startsWith('character:')) return
    const slot = this.chars.get(objId.slice('character:'.length))
    if (!slot) return
    slot.face = face
    // Snap the image (discrete = no tween); only when a resolver and a real change exist.
    const url = slot.faceUrl?.(face)
    if (url && slot.img.src !== url) slot.img.src = url
  }

  /** Full-screen color flash that fades out. A transient overlay primitive (not a
   *  transform on a persistent object); it backs the built-in `flash` effect. */
  async flash(color: string, durationSec: number): Promise<void> {
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${color}`
    this.fxLayer.append(overlay)
    await animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: durationSec * 1000, easing: 'ease-out' })
    overlay.remove()
  }

  // ---- edit surface (EditStage) ----
  // The stable handle the editor decorates / hit-tests against (see EditStage).
  // These wrap the internal DOM fields and `.nilvn-*` class contract so the
  // editor never names them directly.

  get dialogBox(): HTMLElement {
    return this.dialog
  }

  get nameTag(): HTMLElement {
    return this.nameEl
  }

  nameVisible(): boolean {
    return !this.nameEl.classList.contains('nilvn-hidden')
  }

  get textBody(): HTMLElement {
    return this.textEl
  }

  charElement(id: string): HTMLElement | null {
    return this.chars.get(id)?.el ?? null
  }

  charIdAt(target: EventTarget | null): string | null {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('.nilvn-char')
    const id = el?.dataset.id
    return id !== undefined && this.chars.has(id) ? id : null
  }

  objectIdAt(target: EventTarget | null): string | null {
    const node = target as HTMLElement | null
    const ch = node?.closest<HTMLElement>('.nilvn-char')?.dataset.id
    if (ch !== undefined && this.chars.has(ch)) return `character:${ch}`
    const sp = node?.closest<HTMLElement>('.nilvn-sprite')?.dataset.id
    if (sp !== undefined && this.sprites.has(sp)) return `sprite:${sp}`
    // The dialogue box doubles as the `window:dialog` stage object. Checked LAST so
    // an object promoted to the front band (over the dialogue) still wins the hit.
    // The editor arbitrates when this answer applies (its text layer owns dialog
    // clicks except while a timeline window lane claims them); runtime clicks never
    // come through here.
    if (node?.closest('.nilvn-dialog')) return 'window:dialog'
    return null
  }

  objectElement(objId: string): HTMLElement | null {
    if (objId.startsWith('character:')) return this.chars.get(objId.slice('character:'.length))?.el ?? null
    if (objId.startsWith('sprite:')) return this.sprites.get(objId.slice('sprite:'.length))?.el ?? null
    // The camera is the world wrapper — always present. Exposing its element lets
    // the editor anchor a full-stage selection box for camera keyframing (the box
    // rect tracks the camera's live transform, i.e. where the world is).
    if (objId === 'camera') return this.camera
    if (objId === 'window:dialog') return this.dialog
    return null
  }

  objectIds(): string[] {
    return [
      ...[...this.chars.keys()].map((id) => `character:${id}`),
      ...[...this.sprites.keys()].map((id) => `sprite:${id}`),
      'camera',
      'window:dialog',
    ]
  }

  setObjectsInteractive(on: boolean): void {
    this.root.classList.toggle('nilvn-editing', on)
  }

  firstCharElement(): HTMLElement | null {
    for (const slot of this.chars.values()) return slot.el
    return null
  }

  isDialogTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.dialog.contains(target)
  }

  /** Dim everyone except the speaker (no-op when the speaker has no sprite) */
  focusChar(speaker: string | null): void {
    const active = speaker !== null && this.chars.has(speaker)
    for (const [id, slot] of this.chars) slot.el.classList.toggle('nilvn-dim', active && id !== speaker)
  }

  setName(name?: string, color?: string): void {
    if (!name) {
      this.nameEl.classList.add('nilvn-hidden')
      return
    }
    this.nameEl.classList.remove('nilvn-hidden')
    this.nameEl.textContent = name
    this.nameEl.style.setProperty('--name-color', color ?? '#7c5cff')
  }

  showDialog(show: boolean): void {
    this.dialog.classList.toggle('nilvn-hidden', !show)
  }

  setWindowSkin(objId: string, url: string | undefined, ref?: string): void {
    if (objId !== 'window:dialog') return
    this.windowSkin = url
    this.windowSkinRef = url ? ref : undefined
    if (url) {
      // Inline background-image overrides the stylesheet's gradient shorthand; the
      // border yields to the artwork. v1 stretches the whole image; nine-slice
      // border-image is the reserved extension.
      this.dialog.style.backgroundImage = `url("${url}")`
      this.dialog.style.backgroundSize = '100% 100%'
      this.dialog.style.borderColor = 'transparent'
    } else {
      this.dialog.style.backgroundImage = ''
      this.dialog.style.backgroundSize = ''
      this.dialog.style.borderColor = ''
    }
  }

  // ---- dialogue layer: typewriter + choices (Renderer.typeLine / showChoices) ----
  // The engine owns pacing policy and per-character side effects (text effects,
  // reveal hooks); the DOM — spans, buttons, classes — stays in here.

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  /** Sleep that ends early once the player taps to skip typing. */
  private async skippableSleep(ms: number, skip: () => boolean): Promise<void> {
    const step = 30
    for (let t = 0; t < ms && !skip(); t += step) await this.sleep(Math.min(step, ms - t))
  }

  /** Build the per-character spans for `segments` under `parent` (hidden until
   *  revealed unless `revealed`), returning the reveal plan: one item per span,
   *  interleaved with the `{w:}` pauses. `onSpan` runs for revealed spans at once. */
  private layoutSegments(
    parent: HTMLElement,
    segments: Segment[],
    revealed: boolean,
    onSpan?: (span: TextSpan, effect: string | undefined) => void,
  ): { span?: HTMLSpanElement; handle?: TextSpan; effect?: string; pause?: number }[] {
    parent.replaceChildren()
    const items: { span?: HTMLSpanElement; handle?: TextSpan; effect?: string; pause?: number }[] = []
    let index = 0
    for (const seg of segments) {
      if (seg.kind === 'br') {
        parent.append(document.createElement('br'))
        continue
      }
      if (seg.kind === 'pause') {
        if (!revealed) items.push({ pause: seg.sec })
        continue
      }
      for (const ch of seg.text) {
        const span = document.createElement('span')
        span.className = revealed ? 'nilvn-ch on' : 'nilvn-ch'
        span.textContent = ch
        span.style.setProperty('--i', String(index))
        parent.append(span)
        const handle: TextSpan = { index, char: ch, addClass: (name) => span.classList.add(name) }
        if (revealed) onSpan?.(handle, seg.effect)
        else items.push({ span, handle, effect: seg.effect })
        index++
      }
    }
    return items
  }

  async typeLine(segments: Segment[], opts: TypeLineOptions): Promise<void> {
    const items = this.layoutSegments(this.textEl, segments, false)
    for (const item of items) {
      if (!opts.alive()) return
      if (item.pause !== undefined) {
        await this.skippableSleep(item.pause * 1000, opts.skip)
        continue
      }
      item.span!.classList.add('on')
      opts.onReveal?.(item.handle!, item.effect)
      const cps = opts.cps()
      if (!opts.skip() && cps > 0) await this.skippableSleep(1000 / cps, opts.skip)
    }
  }

  setLine(segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): void {
    this.layoutSegments(this.textEl, segments, true, onSpan)
  }

  showChoices(items: Segment[][], onSpan?: (span: TextSpan, effect: string | undefined) => void): ChoicePrompt {
    this.choicesEl.replaceChildren()
    let resolve: (i: number | null) => void = () => {}
    const chosen = new Promise<number | null>((r) => {
      resolve = r
    })
    const buttons: HTMLButtonElement[] = []
    const handles: ChoiceHandle[] = items.map((segments, index) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'nilvn-choice'
      this.layoutSegments(btn, segments, true, onSpan)
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        resolve(index)
      })
      this.choicesEl.append(btn)
      buttons.push(btn)
      return { index, addClass: (name) => btn.classList.add(name), setVar: (name, value) => btn.style.setProperty(name, value) }
    })
    this.choicesEl.classList.add('on')
    return {
      handles,
      chosen,
      cancel: () => resolve(null),
      relabel: (index, segments, on) => {
        const btn = buttons[index]
        if (btn) this.layoutSegments(btn, segments, true, on ?? onSpan)
      },
    }
  }

  hideChoices(): void {
    this.choicesEl.classList.remove('on')
    this.choicesEl.replaceChildren()
  }

  showIndicator(on: boolean): void {
    this.indicator.classList.toggle('on', on)
  }

  /** Animate the full-screen fader to the given opacity (1 = covered) */
  async fadeScreen(to: number, sec: number, color = '#000'): Promise<void> {
    this.fader.style.background = color
    const from = parseFloat(getComputedStyle(this.fader).opacity) || 0
    this.fader.style.opacity = String(to)
    if (sec > 0) await animate(this.fader, [{ opacity: from }, { opacity: to }], { duration: sec * 1000, easing: 'ease' })
  }

  /** Shaped full-screen transition (wipe / circle iris / blinds). A transient
   *  overlay appended after the fader (so it paints above it) animates the shape;
   *  a cover (`to`=1) then hands the covered screen off to the fader — the same
   *  element `fadeScreen` drives — so `[fadein]`, a reveal, and the restore reset
   *  all clear it. A reveal (`to`=0) drops the fader behind the fully-covering
   *  overlay first, then plays the shape backwards. */
  async transitionScreen(to: 0 | 1, sec: number, opts?: TransitionOpts): Promise<void> {
    const cover = to >= 0.5
    const shape = opts?.shape ?? 'wipe'
    const color = opts?.color ?? '#000'
    const dur = Math.max(0, sec) * 1000
    const gen = this.restoreGen
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${color}`
    this.root.append(overlay) // after the fader → paints above it
    // Revealing: the overlay fully covers the screen at its start state, so the
    // fader underneath can vanish instantly without a visible pop.
    if (!cover) this.fader.style.opacity = '0'
    if (shape === 'blinds') {
      overlay.style.background = 'none'
      const slats = 6
      const anims: Promise<void>[] = []
      for (let i = 0; i < slats; i++) {
        const slat = document.createElement('div')
        // +0.1% overlap hides sub-pixel seams between adjacent slats.
        slat.style.cssText = `position:absolute;top:0;bottom:0;left:${(i / slats) * 100}%;width:${100 / slats + 0.1}%;background:${color};transform-origin:left;transform:scaleX(${cover ? 0 : 1})`
        overlay.append(slat)
        const frames = cover ? [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }] : [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }]
        // Stagger the slats across 30% of the duration; each animates over the rest.
        anims.push(animate(slat, frames, { duration: dur * 0.7, delay: (i / slats) * dur * 0.3, easing: 'ease-in-out', fill: 'forwards' }))
      }
      await Promise.all(anims)
    } else {
      // circle: % resolves against the reference-box diagonal/√2, so 71% touches the
      // corners exactly — 75% adds margin. Wipe insets: the closed state keeps a
      // zero-size region at the edge the cover grows FROM (dir = travel direction).
      const closed =
        shape === 'circle'
          ? 'circle(0% at 50% 50%)'
          : { right: 'inset(0 100% 0 0)', left: 'inset(0 0 0 100%)', down: 'inset(0 0 100% 0)', up: 'inset(100% 0 0 0)' }[opts?.dir ?? 'right']
      const open = shape === 'circle' ? 'circle(75% at 50% 50%)' : 'inset(0 0 0 0)'
      const [from, until] = cover ? [closed, open] : [open, closed]
      overlay.style.clipPath = until
      await animate(overlay, [{ clipPath: from }, { clipPath: until }], { duration: dur, easing: 'ease-in-out' })
    }
    // Hand the covered screen to the fader — but only if this transition still owns the
    // screen. A restore during the animation (load / restart / entering a replay) has
    // already repainted and cleared the fader; re-blackening it here would leave the
    // player staring at the colour this run was covering with. The overlay always goes,
    // whoever won.
    if (cover && this.restoreGen === gen) {
      this.fader.style.background = color
      this.fader.style.opacity = '1'
    }
    overlay.remove()
  }

  // ---- save / load support ----

  /** Re-apply a saved resting end pose (save model B,):
   *  the transform x/y px offsets, opacity and visibility a recording event-frame
   *  committed. `showChar` / `showSprite` already seed the placement `y` (bottom %)
   *  and scale / rotation; these channels are layered on through the generic
   *  surface so a load restores the end pose directly without replaying. */
  private applyRestingPose(objId: string, s: { tx?: Length; ty?: Length; opacity?: number; visible?: boolean }): void {
    if (s.tx !== undefined) this.setProp(objId, 'x', s.tx)
    if (s.ty !== undefined) this.setProp(objId, 'y', s.ty)
    if (s.opacity !== undefined) this.setProp(objId, 'opacity', s.opacity)
    if (s.visible === false) this.setProp(objId, 'visible', false)
  }

  /** Capture the current visible stage as a plain object. */
  snapshot(): StageState {
    const lastBg = this.bgLayer.lastElementChild as HTMLElement | null
    return {
      // With a ref the CSS (which may embed a data: URL) is redundant — and the
      // whole point of refs is to keep base64 out of saves — so it is omitted;
      // colour / editor-painted / ref-less backgrounds keep the legacy form.
      bgCss: this.bgRef ? undefined : lastBg?.style.cssText || undefined,
      bgRef: this.bgRef,
      chars: [...this.chars].map(([id, slot]) => ({
        id,
        src: slot.ref ?? slot.img.src,
        at: pctOr(slot.el.style.left, 50),
        face: slot.face,
        band: slot.band,
        ...restingState(slot),
      })),
      sprites: this.sprites.size
        ? [...this.sprites].map(([id, slot]) => ({
            id,
            url: slot.spec.ref ?? slot.spec.url,
            frames: slot.spec.frames,
            fps: slot.spec.fps,
            loop: slot.spec.loop,
            at: pctOr(slot.el.style.left, 50),
            height: slot.spec.height,
            band: slot.band,
            ...restingState(slot),
          }))
        : undefined,
      windows: windowsState(this.windowModel, this.windowSkinRef ?? this.windowSkin),
      camera: cameraState(this.cameraModel),
      cover: coverState(this.fader),
      name: this.nameEl.classList.contains('nilvn-hidden') ? undefined : (this.nameEl.textContent ?? undefined),
      nameColor: this.nameEl.style.getPropertyValue('--name-color') || undefined,
      text: this.textEl.textContent ?? '',
      dialog: !this.dialog.classList.contains('nilvn-hidden'),
    }
  }

  /** Repaint the stage from a snapshot, instantly (no fades). */
  async restore(
    state: StageState,
    faceUrl?: (charId: string, face: string) => string | undefined,
    resolveUrl?: (src: string) => string,
  ): Promise<void> {
    this.restoreGen++ // invalidate any in-flight screen transition (see transitionScreen)
    const url = (src: string): string => (resolveUrl ? resolveUrl(src) : src)
    this.bgLayer.replaceChildren()
    this.bgRef = undefined
    if (state.bgRef && resolveUrl) {
      // A ref-form save: re-resolve through the engine.
      const item = div('nilvn-bg-item')
      item.style.backgroundImage = `url("${url(state.bgRef)}")`
      this.bgLayer.append(item)
      this.bgRef = state.bgRef
    } else if (state.bgCss) {
      const item = div('nilvn-bg-item')
      item.style.cssText = state.bgCss
      this.bgLayer.append(item)
    }
    await this.clearChars(0)
    for (const c of state.chars) {
      // `src` is a ref in new saves and a resolved URL in older ones; the resolver
      // passes a URL through unchanged, so both paint.
      await this.showChar(c.id, url(c.src), {
        at: String(c.at),
        face: c.face,
        ref: c.src,
        faceUrl: faceUrl ? (f) => faceUrl(c.id, f) : undefined,
        fade: 0,
        y: c.y,
        scale: c.scale,
        rotation: c.rotation,
      })
      this.applyRestingPose(`character:${c.id}`, c)
      if (c.band && c.band !== 'world') this.setBand(`character:${c.id}`, c.band)
    }
    // Sprites restart their frame loop from frame 0 on restore (their exact phase
    // is not part of the save shape). Clearing handles the blank-stage restore too.
    await this.clearSprites(0)
    for (const s of state.sprites ?? []) {
      await this.showSprite(
        s.id,
        { url: url(s.url), ref: s.url, frames: s.frames, fps: s.fps, loop: s.loop, at: String(s.at), height: s.height, y: s.y, scale: s.scale, rotation: s.rotation },
        0,
      )
      this.applyRestingPose(`sprite:${s.id}`, s)
      if (s.band && s.band !== 'world') this.setBand(`sprite:${s.id}`, s.band)
    }
    // Camera resting transform: always reset to identity first (a restore to a
    // point before any camera work must not keep a later pan/zoom), then layer
    // the saved channels on. Fixes the pre-camera-support gap where a load /
    // restart kept whatever transform the camera happened to have.
    this.cameraModel = freshTransform()
    const cam = state.camera
    if (cam) {
      if (cam.x !== undefined) this.cameraModel.x = cam.x
      if (cam.y !== undefined) this.cameraModel.y = cam.y
      if (cam.scale !== undefined) this.cameraModel.scale = cam.scale
      if (cam.rotation !== undefined) this.cameraModel.rotation = cam.rotation
      if (cam.opacity !== undefined) this.cameraModel.opacity = cam.opacity
      if (cam.visible !== undefined) this.cameraModel.visible = cam.visible
    }
    this.applyModel({ el: this.camera, base: '', model: this.cameraModel })
    // Window resting pose + skin: reset-then-layer, exactly like the camera — a
    // restore to a point before any window work must not keep a later pose or skin.
    this.windowModel = freshTransform()
    this.setWindowSkin('window:dialog', undefined)
    const win = state.windows?.find((w) => w.id === 'dialog')
    if (win) {
      if (win.x !== undefined) this.windowModel.x = win.x
      if (win.y !== undefined) this.windowModel.y = win.y
      if (win.scale !== undefined) this.windowModel.scale = win.scale
      if (win.rotation !== undefined) this.windowModel.rotation = win.rotation
      if (win.opacity !== undefined) this.windowModel.opacity = win.opacity
      if (win.visible !== undefined) this.windowModel.visible = win.visible
      if (win.skin) this.setWindowSkin('window:dialog', url(win.skin), win.skin)
    }
    this.applyModel({ el: this.dialog, base: '', model: this.windowModel })
    this.setName(state.name, state.nameColor)
    this.textEl.textContent = state.text
    this.showDialog(state.dialog)
    this.showIndicator(state.dialog)
    this.choicesEl.classList.remove('on')
    this.choicesEl.replaceChildren()
    // The full-screen cover is part of the saved stage, so restore it rather than always
    // clearing: a save taken between [transout] and [transin] must come back covered, or
    // the load resumes onto the scene the story is still hiding. No cover in the state
    // means the screen was clear — which also drops the black left by [end]/[fadeout] on
    // a restart (`restore({chars:[], …})`), the case the old unconditional reset existed
    // for.
    this.fader.style.background = state.cover?.color ?? '#000'
    this.fader.style.opacity = state.cover ? String(state.cover.opacity) : '0'
  }

  destroy(): void {
    this.root.remove()
  }
}

