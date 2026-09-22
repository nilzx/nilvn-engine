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

import { cleanTheme, themeDefaultsCss, themeVar } from './theme.js'
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
  ChoicePrompt, ChromeRenderer, ScreenId, ScreenModel, ChoiceView, ChoicesPromptOptions, ChoicesLayout, OverflowMode, TransitionKind, SceneTransitionOpts, CharLayer, HotspotSpec } from './renderer/types.js'
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
  /** The single sprite image; absent for a layered sprite. */
  img?: HTMLImageElement
  /** Layered sprite: the composition box and each layer's image and value. */
  box?: HTMLDivElement
  layers?: Map<string, { img: HTMLImageElement; value: string; ref?: string }>
  layerUrl?: (layer: string, value: string) => string | undefined
  face?: string
  /** Unresolved script path the current image came from (saved instead of the URL). */
  ref?: string
  /** Resolve a face name to a sprite URL (from the actor's `{face}` template, with
   *  alias / asset-table resolution already applied by the engine). Lets `setFace`
   *  swap art on a recorded `face` keyframe; absent / undefined for raw-`src=`
   *  characters or an unresolvable face. */
  faceUrl?: (face: string) => string | undefined
  /** Layered sprite: the shared canvas (image px) the layers align on. */
  canvas?: [number, number]
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
.nilvn-root{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden;font-family:var(--nilvn-font);user-select:none;cursor:pointer;container-type:size;color:var(--nilvn-text)}
.nilvn-layer{position:absolute;inset:0}
.nilvn-camera{position:absolute;inset:0}
.nilvn-bg-item{position:absolute;inset:0;background-size:cover;background-position:center}
.nilvn-fx{pointer-events:none}
.nilvn-front{pointer-events:none}
.nilvn-sprites{pointer-events:none}
.nilvn-back{pointer-events:none}
.nilvn-char{position:absolute;bottom:0;height:88%;transform:translateX(-50%);transition:left .45s ease,filter .35s ease}
.nilvn-char img{height:100%;width:auto;display:block;pointer-events:none}
.nilvn-char__layers{position:relative;height:100%;aspect-ratio:var(--canvas-w,600)/var(--canvas-h,1100)}
.nilvn-char__layers img{position:absolute;left:0;top:0;width:100%;height:auto}
.nilvn-snapshot{pointer-events:none}
.nilvn-sprite.nilvn-clickable{pointer-events:auto;cursor:pointer}
.nilvn-hotspot{position:absolute;pointer-events:auto;cursor:pointer}
.nilvn-editing .nilvn-hotspot{outline:1px dashed rgba(255,255,255,.5)}
.nilvn-ui{position:absolute;z-index:44;pointer-events:auto;box-sizing:border-box;font-size:calc(var(--nilvn-hud-size)*var(--nilvn-ui-scale));color:var(--nilvn-hud-color);background:var(--nilvn-hud-bg);border:var(--nilvn-hud-border);border-radius:var(--nilvn-hud-radius);padding:var(--nilvn-hud-padding);cursor:default}
.nilvn-ui--window{z-index:46;min-width:var(--nilvn-window-width);font-size:calc(2.6cqh*var(--nilvn-ui-scale));color:var(--nilvn-window-color);background:var(--nilvn-window-bg);border:var(--nilvn-window-border);border-radius:var(--nilvn-window-radius);padding:var(--nilvn-window-padding);box-shadow:0 1.2cqh 4cqh rgba(0,0,0,.45)}
.nilvn-ui--top-left{top:1.6cqh;left:1.6cqw}.nilvn-ui--top{top:1.6cqh;left:50%;transform:translateX(-50%)}.nilvn-ui--top-right{top:1.6cqh;right:8cqw}
.nilvn-ui--left{top:50%;left:1.6cqw;transform:translateY(-50%)}.nilvn-ui--center{top:50%;left:50%;transform:translate(-50%,-50%)}.nilvn-ui--right{top:50%;right:1.6cqw;transform:translateY(-50%)}
.nilvn-ui--bottom-left{bottom:30cqh;left:1.6cqw}.nilvn-ui--bottom{bottom:30cqh;left:50%;transform:translateX(-50%)}.nilvn-ui--bottom-right{bottom:30cqh;right:1.6cqw}
.nilvn-ui__title{font-weight:700;margin-bottom:1.6cqh}
.nilvn-ui__body{display:flex;flex-direction:column;gap:1cqh}
.nilvn-ui__text{white-space:pre-wrap}
.nilvn-ui__empty{opacity:.6}
.nilvn-ui__bar-label{margin-bottom:.4cqh}
.nilvn-ui__bar-track{height:var(--nilvn-bar-height);border-radius:99px;background:var(--nilvn-bar-bg);overflow:hidden;min-width:12cqw}
.nilvn-ui__bar-fill{height:100%;background:var(--nilvn-bar-color);transition:width .3s ease}
.nilvn-ui__image{display:block;max-width:100%;height:auto}
.nilvn-ui__list{margin:0;padding-left:1.4em}
.nilvn-ui__button{align-self:center;font-size:inherit;padding:1cqh 2.4cqw}
.nilvn-char.nilvn-dim{filter:brightness(.55) saturate(.7)}
.nilvn-sprite{position:absolute;bottom:0;transform:translateX(-50%);background-repeat:no-repeat;background-position:0 0;pointer-events:none}
.nilvn-editing .nilvn-sprite{pointer-events:auto}
.nilvn-editing .nilvn-char{transition:none}
.nilvn-dialog{position:absolute;left:var(--nilvn-dialog-inset);right:var(--nilvn-dialog-inset);top:var(--nilvn-dialog-top);bottom:var(--nilvn-dialog-bottom);min-height:var(--nilvn-dialog-height);box-sizing:border-box;border-radius:var(--nilvn-dialog-radius);padding:var(--nilvn-dialog-padding);border:var(--nilvn-dialog-border);backdrop-filter:blur(6px);isolation:isolate;transition:opacity .3s}
.nilvn-dialog::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--nilvn-dialog-skin) center/100% 100% no-repeat,var(--nilvn-dialog-bg);border:0 solid transparent;border-image:var(--nilvn-dialog-skin-slice);opacity:var(--nilvn-dialog-opacity)}
.nilvn-dialog.nilvn-hidden{opacity:0!important;pointer-events:none}
.nilvn-name{position:absolute;top:-2cqh;left:var(--nilvn-name-offset);background:var(--nilvn-name-bg);color:var(--nilvn-name-color);font-weight:700;font-size:calc(var(--nilvn-name-size)*var(--nilvn-ui-scale));line-height:1;padding:1.1cqh 1.6cqw;border-radius:99px;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.nilvn-name.nilvn-hidden{display:none}
.nilvn-text{font-size:calc(var(--nilvn-text-size)*var(--nilvn-ui-scale));line-height:var(--nilvn-text-line-height);letter-spacing:.02em;color:var(--nilvn-text-color);text-shadow:var(--nilvn-text-shadow)}
.nilvn-ch{opacity:0;display:inline-block;white-space:pre}
.nilvn-word{display:inline-block;white-space:nowrap}
.nilvn-ch.on{opacity:1}
.nilvn-off{display:none!important}
.nilvn-dialog--fixed{height:var(--nilvn-dialog-height)}
.nilvn-dialog--fixed .nilvn-text{height:100%;overflow:hidden}
.nilvn-indicator{position:absolute;right:2.4cqw;bottom:1.8cqh;width:0;height:0;border-left:calc(var(--nilvn-indicator-size)*.64) solid transparent;border-right:calc(var(--nilvn-indicator-size)*.64) solid transparent;border-top:var(--nilvn-indicator-size) solid var(--nilvn-indicator-color);opacity:0}
.nilvn-indicator.on{opacity:1;animation:nilvn-blink 1s ease-in-out infinite}
@keyframes nilvn-blink{50%{transform:translateY(.5cqh);opacity:.3}}
.nilvn-choices{position:absolute;inset:0;display:none;align-items:center;justify-content:center;box-sizing:border-box;padding:5cqh 5cqw;background:var(--nilvn-choices-backdrop)}
.nilvn-choices.on{display:flex}
.nilvn-choices--top{align-items:flex-start}
.nilvn-choices--bottom{align-items:flex-end;padding-bottom:calc(var(--nilvn-dialog-height) + var(--nilvn-dialog-bottom) + 3cqh)}
.nilvn-choices--left{justify-content:flex-start}
.nilvn-choices--right{justify-content:flex-end}
.nilvn-choices__list{display:flex;flex-direction:column;align-items:stretch;gap:var(--nilvn-choices-gap);max-width:90cqw}
.nilvn-choices__list--grid{display:grid;grid-template-columns:repeat(var(--choices-columns,2),minmax(0,1fr))}
.nilvn-choice{min-width:var(--nilvn-choice-width);padding:2cqh 3cqw;font:inherit;font-size:calc(var(--nilvn-choice-size)*var(--nilvn-ui-scale));color:var(--nilvn-choice-color);text-align:center;background:var(--nilvn-choice-skin) center/100% 100% no-repeat,var(--nilvn-choice-bg);border:var(--nilvn-choice-border);border-image:var(--nilvn-choice-skin-slice);border-radius:var(--nilvn-choice-radius);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
.nilvn-choice:hover:not(:disabled){transform:translateY(-2px) scale(1.02);border-color:var(--nilvn-choice-hover);box-shadow:0 6px 24px rgba(80,100,255,.25)}
.nilvn-choice.chosen{background:var(--nilvn-choice-skin) center/100% 100% no-repeat,var(--nilvn-choice-chosen-bg);color:var(--nilvn-choice-chosen-color)}
.nilvn-choice:disabled{background:var(--nilvn-choice-skin) center/100% 100% no-repeat,var(--nilvn-choice-disabled-bg);color:var(--nilvn-choice-disabled-color);cursor:default}
.nilvn-choices__timer{grid-column:1/-1;height:.8cqh;border-radius:99px;background:var(--nilvn-choice-timer-bg);overflow:hidden}
.nilvn-choices__timer::before{content:"";display:block;height:100%;background:var(--nilvn-choice-timer-color);animation:nilvn-timer var(--choices-timer,5s) linear forwards}
@keyframes nilvn-timer{from{width:100%}to{width:0}}
.nilvn-fader{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.nilvn-screens{pointer-events:none;z-index:40}
.nilvn-screen{position:absolute;inset:0;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.4cqh;padding:6cqh 6cqw;box-sizing:border-box;color:var(--nilvn-panel-color);cursor:default;text-align:center;overflow:hidden}
.nilvn-screen__bg{position:absolute;inset:0;z-index:-1;background:var(--screen-bg,rgba(8,10,18,.92)) center/cover no-repeat}
.nilvn-screen--left{align-items:flex-start;text-align:left;padding-left:10cqw}
.nilvn-screen--right{align-items:flex-end;text-align:right;padding-right:10cqw}
.nilvn-screen--bottom{justify-content:flex-end;padding-bottom:8cqh}
.nilvn-screen__logo{max-height:34cqh;max-width:70cqw;display:block}
.nilvn-screen__heading{margin:0;font-size:calc(8cqh*var(--nilvn-ui-scale));font-weight:800;letter-spacing:.04em;text-shadow:0 2px 12px rgba(0,0,0,.5)}
.nilvn-screen__subtitle{margin:0;font-size:calc(3cqh*var(--nilvn-ui-scale));opacity:.8}
.nilvn-screen__progress{width:min(50cqw,100%);height:1.2cqh;border-radius:99px;background:var(--nilvn-progress-bg);overflow:hidden}
.nilvn-screen__progress::before{content:"";display:block;height:100%;width:calc(var(--progress,0)*100%);background:var(--nilvn-progress-color);transition:width .15s ease}
.nilvn-screen__buttons{display:flex;flex-direction:column;gap:1.6cqh;margin-top:2cqh;min-width:28cqw}
.nilvn-screen__button{font:inherit;font-size:calc(3.2cqh*var(--nilvn-ui-scale));padding:1.6cqh 3cqw;color:var(--nilvn-button-color);background:var(--nilvn-button-bg);border:var(--nilvn-button-border);border-radius:99px;cursor:pointer;transition:background .15s ease,transform .15s ease}
.nilvn-screen__button:hover,.nilvn-screen__button:focus-visible{background:var(--nilvn-button-hover);transform:translateY(-1px);outline:none}
.nilvn-screen__button--primary{background:var(--nilvn-button-on-bg);color:var(--nilvn-button-on-color);border-color:transparent}
.nilvn-screen__credits{position:relative;width:min(70cqw,100%);height:40cqh;overflow:hidden;mask-image:linear-gradient(transparent,#000 12%,#000 88%,transparent)}
.nilvn-screen__roll{position:absolute;left:0;right:0;top:100%;font-size:calc(2.8cqh*var(--nilvn-ui-scale));line-height:1.9;white-space:pre-wrap;animation:nilvn-roll var(--roll-duration,12s) linear forwards}
@keyframes nilvn-roll{to{transform:translateY(calc(-100% - 40cqh))}}
.nilvn-screen__version{position:absolute;right:2cqw;bottom:1.6cqh;font-size:1.8cqh;opacity:.55}
.nilvn-menu{position:absolute;z-index:50;font-size:2.6cqh;pointer-events:auto}
.nilvn-menu--top-right{top:1.6cqh;right:1.6cqw}
.nilvn-menu--top-left{top:1.6cqh;left:1.6cqw}
.nilvn-menu--bottom-right{bottom:1.6cqh;right:1.6cqw}
.nilvn-menu--bottom-left{bottom:1.6cqh;left:1.6cqw}
.nilvn-menu--hidden .nilvn-menu__btn{display:none}
.nilvn-menu__btn{width:5cqh;height:5cqh;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color);cursor:pointer;backdrop-filter:blur(4px);line-height:1;font:inherit}
.nilvn-menu__btn:hover{background:var(--nilvn-button-hover)}
.nilvn-menu__panel{position:absolute;width:30cqw;display:none;flex-direction:column;gap:1.2cqh;padding:2cqh;border-radius:1.4cqh;background:var(--nilvn-panel-bg);border:var(--nilvn-panel-border);color:var(--nilvn-panel-color);box-shadow:0 1.2cqh 4cqh rgba(0,0,0,.5)}
.nilvn-menu--top-right .nilvn-menu__panel,.nilvn-menu--top-left .nilvn-menu__panel{top:6cqh}
.nilvn-menu--bottom-right .nilvn-menu__panel,.nilvn-menu--bottom-left .nilvn-menu__panel{bottom:6cqh}
.nilvn-menu--top-right .nilvn-menu__panel,.nilvn-menu--bottom-right .nilvn-menu__panel{right:0}
.nilvn-menu--top-left .nilvn-menu__panel,.nilvn-menu--bottom-left .nilvn-menu__panel{left:0}
.nilvn-menu--hidden .nilvn-menu__panel{top:6cqh;right:1.6cqw}
.nilvn-menu.on .nilvn-menu__panel{display:flex}
.nilvn-menu__item{padding:1.2cqh 1.6cqw;border-radius:.9cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color);font:inherit;font-size:calc(2.4cqh*var(--nilvn-ui-scale));cursor:pointer;text-align:center}
.nilvn-menu__item:hover{background:var(--nilvn-button-hover)}
.nilvn-menu__item.on{background:var(--nilvn-button-on-bg);color:var(--nilvn-button-on-color);border-color:transparent}
.nilvn-menu__item:disabled{opacity:.45;cursor:default}
.nilvn-menu__grid{display:grid;grid-template-columns:minmax(0,max-content) minmax(6cqw,1fr) max-content;align-items:center;gap:1.2cqh 1cqw;font-size:calc(2.1cqh*var(--nilvn-ui-scale));color:var(--nilvn-panel-color);padding:0 5cqw 3cqh}
.nilvn-menu__row{display:contents}
.nilvn-menu__head{grid-column:1/-1;margin-top:1.2cqh;padding-top:1.2cqh;border-top:1px solid rgba(255,255,255,.1);font-weight:700;opacity:.85}
.nilvn-menu__text{grid-column:2/-1;font:inherit;font-size:calc(2.1cqh*var(--nilvn-ui-scale));padding:.6cqh 1cqw;border-radius:.8cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color)}
.nilvn-menu__row>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nilvn-menu__seg{grid-column:2/-1;display:flex;gap:.8cqw}
.nilvn-menu__seg button{flex:1;padding:.8cqh 0;border-radius:.8cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color);font:inherit;font-size:calc(2.1cqh*var(--nilvn-ui-scale));cursor:pointer}
.nilvn-menu__seg button.on{background:var(--nilvn-button-on-bg);color:var(--nilvn-button-on-color);border-color:transparent}
.nilvn-menu__vol{flex:1;min-width:0;accent-color:var(--nilvn-accent);cursor:pointer}
.nilvn-menu__pct{width:7cqw;text-align:right;font-size:1.9cqh;opacity:.7;font-variant-numeric:tabular-nums}
.nilvn-menu__tip{min-height:2.2cqh;font-size:1.9cqh;opacity:.7;text-align:center}
.nilvn-menu__ver{margin-top:.4cqh;padding-top:1cqh;border-top:1px solid rgba(255,255,255,.1);font-size:1.7cqh;opacity:.55;text-align:center}
.nilvn-backlog{position:absolute;inset:0;z-index:60;display:none;flex-direction:column;background:var(--nilvn-panel-bg);color:var(--nilvn-panel-color);backdrop-filter:blur(3px);pointer-events:auto;cursor:default}
.nilvn-backlog.on{display:flex}
.nilvn-backlog__bar{flex:none;display:flex;justify-content:flex-end;gap:1cqw;padding:1.6cqh 1.6cqw}
.nilvn-backlog__close{padding:1cqh 2.4cqw;border-radius:.9cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color);font:inherit;font-size:2.2cqh;cursor:pointer}
.nilvn-backlog__close:hover{background:var(--nilvn-button-hover)}
.nilvn-backlog__list{flex:1;min-height:0;overflow-y:auto;padding:0 5cqw 3cqh;display:flex;flex-direction:column;gap:1.4cqh}
.nilvn-backlog__empty{margin:auto;opacity:.7;font-size:2.4cqh}
.nilvn-backlog__row{display:flex;gap:1.4cqw;align-items:flex-start;padding:1.4cqh 1.8cqw;border-radius:1cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border)}
.nilvn-backlog__voice{flex:none;width:4.4cqh;height:4.4cqh;margin-top:.3cqh;border-radius:50%;background:var(--nilvn-accent);border:none;color:var(--nilvn-button-color);font-size:2cqh;cursor:pointer;line-height:1}
.nilvn-backlog__body{flex:1;min-width:0}
.nilvn-backlog__who{display:inline-block;font-size:calc(2cqh*var(--nilvn-ui-scale));line-height:1;padding:.7cqh 1.4cqw;border-radius:99px;background:var(--nilvn-name-bg);color:var(--nilvn-name-color);margin-bottom:.7cqh;font-weight:600}
.nilvn-backlog__text{font-size:calc(2.3cqh*var(--nilvn-ui-scale));line-height:1.5;white-space:pre-wrap;word-break:break-word}
.nilvn-saves__title{margin-right:auto;align-self:center;font-size:2.8cqh;font-weight:700}
.nilvn-saves__body{flex:1;min-height:0;display:flex;flex-direction:column}
.nilvn-saves__pages{flex:none;display:flex;gap:.8cqw;padding:0 5cqw 1.2cqh}
.nilvn-saves__page{flex:1;padding:.9cqh 0;border-radius:.8cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-button-color);font:inherit;font-size:2.1cqh;cursor:pointer;opacity:.75}
.nilvn-saves__page.on{background:var(--nilvn-button-on-bg);color:var(--nilvn-button-on-color);border-color:transparent;opacity:1}
.nilvn-saves__grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:1.2cqh 1.2cqw;padding:0 5cqw 3cqh;align-content:start}
.nilvn-saves__slot{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:.4cqh;padding:1.3cqh 1.6cqw 1.3cqh 1.6cqw;border-radius:1cqh;background:var(--nilvn-button-bg);border:var(--nilvn-button-border);color:var(--nilvn-panel-color);font:inherit;text-align:left;cursor:pointer;min-height:9cqh;opacity:.7;overflow:hidden}
.nilvn-saves__slot:hover{background:var(--nilvn-button-hover)}
.nilvn-saves__slot.has-data{opacity:1}
.nilvn-saves__slot--special{border-color:var(--nilvn-accent)}
.nilvn-saves__thumb{position:absolute;right:0;top:0;bottom:0;width:32%;background:center/cover no-repeat;opacity:.55;mask-image:linear-gradient(90deg,transparent,#000 40%)}
.nilvn-saves__no{font-size:1.9cqh;font-weight:700;opacity:.8}
.nilvn-saves__when{font-size:2cqh}
.nilvn-saves__preview{font-size:2.1cqh;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.nilvn-saves__del{position:absolute;right:.8cqw;top:.6cqh;width:3cqh;height:3cqh;border-radius:50%;border:none;background:rgba(0,0,0,.35);color:var(--nilvn-button-color);font:inherit;font-size:1.8cqh;cursor:pointer;line-height:1}
.nilvn-saves__del:hover{background:var(--nilvn-accent)}
.nilvn-modal{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);pointer-events:auto;cursor:default}
.nilvn-modal__box{min-width:36cqw;max-width:70cqw;padding:3cqh 3cqw;border-radius:1.4cqh;background:var(--nilvn-panel-bg);border:var(--nilvn-panel-border);color:var(--nilvn-panel-color);box-shadow:0 1.2cqh 4cqh rgba(0,0,0,.5);text-align:center}
.nilvn-modal__msg{font-size:calc(2.6cqh*var(--nilvn-ui-scale));line-height:1.6;margin-bottom:2.4cqh}
.nilvn-modal__buttons{display:flex;gap:1.2cqw;justify-content:center}
.nilvn-modal--top{align-items:flex-start;padding-top:8cqh}
.nilvn-modal--bottom{align-items:flex-end;padding-bottom:8cqh}
.nilvn-modal--input .nilvn-modal__box{background:var(--nilvn-input-box-skin) center/100% 100% no-repeat,var(--nilvn-input-box-bg);border:var(--nilvn-input-box-border);border-image:var(--nilvn-input-box-skin-slice);border-radius:var(--nilvn-input-box-radius)}
.nilvn-modal__input{display:block;width:100%;box-sizing:border-box;margin:0 0 2.4cqh;padding:1.2cqh 1.6cqw;font:inherit;font-size:calc(var(--nilvn-input-size)*var(--nilvn-ui-scale));text-align:center;color:var(--nilvn-input-color);background:var(--nilvn-input-bg);border:var(--nilvn-input-border);border-radius:var(--nilvn-input-radius);outline:none}
.nilvn-modal__input:focus{box-shadow:0 0 0 2px var(--nilvn-accent)}
.nilvn-modal__input[aria-invalid="true"]{box-shadow:0 0 0 2px #e05555}
.nilvn-screen__button:disabled{opacity:.45;cursor:default}
.nilvn-toast{position:absolute;left:50%;bottom:30cqh;transform:translate(-50%,1cqh);z-index:65;padding:1.2cqh 2.4cqw;border-radius:99px;background:var(--nilvn-panel-bg);border:var(--nilvn-panel-border);color:var(--nilvn-panel-color);font-size:calc(2.2cqh*var(--nilvn-ui-scale));opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}
.nilvn-toast.on{opacity:1;transform:translate(-50%,0)}
.nilvn-hud{position:absolute;z-index:45;pointer-events:auto;font-size:calc(2.2cqh*var(--nilvn-ui-scale));color:var(--nilvn-panel-color)}
.nilvn-hud--top-left{top:1.6cqh;left:1.6cqw}
.nilvn-hud--top-right{top:1.6cqh;right:8cqw}
.nilvn-hud--bottom-left{bottom:30cqh;left:1.6cqw}
.nilvn-hud--bottom-right{bottom:30cqh;right:1.6cqw}
.nilvn-screen-plugin .nilvn-backlog__list{display:block}
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
/** Set a CSS mask on an element (both spellings, for WebKit). */
function setMask(el: HTMLElement, image: string, size: string, repeat: string): void {
  for (const prefix of ['', '-webkit-']) {
    el.style.setProperty(`${prefix}mask-image`, image)
    el.style.setProperty(`${prefix}mask-size`, size)
    el.style.setProperty(`${prefix}mask-repeat`, repeat)
  }
}

/** Run `step(t)` every frame for `ms`, t from 0 to 1 (1 guaranteed last); stops
 *  early when `stale()` says the picture moved on. */
function driveFrames(ms: number, step: (t: number) => void, stale: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const frame = (): void => {
      if (stale()) return resolve()
      const t = ms > 0 ? Math.min(1, (performance.now() - start) / ms) : 1
      step(t)
      if (t >= 1) resolve()
      else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame)
      else setTimeout(frame, 16)
    }
    frame()
  })
}

/** Rule-image transition: the rule's luminance is a per-pixel delay. Each frame
 *  a threshold sweeps 0 → 1 and the element's alpha mask keeps the pixels whose
 *  luminance is still above it (`reverse` keeps the ones below — a cover growing
 *  over dark pixels first). Drawn on a small canvas (≤ 320 px wide) and handed to
 *  `mask-image` as a data URL; `softness` widens the edge. Falls back to a plain
 *  fade when the image cannot be read. */
async function animateRuleMask(el: HTMLElement, ruleUrl: string, ms: number, softness: number, reverse: boolean, stale: () => boolean): Promise<void> {
  let lum: Float32Array | undefined
  let w = 0
  let h = 0
  let canvas: HTMLCanvasElement | undefined
  let ctx: CanvasRenderingContext2D | null = null
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = ruleUrl
    await img.decode()
    const scale = Math.min(1, 320 / Math.max(1, img.naturalWidth))
    w = Math.max(1, Math.round(img.naturalWidth * scale))
    h = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    lum = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) lum[i] = (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!) / 255
  } catch {
    lum = undefined
  }
  if (!lum || !canvas || !ctx) {
    if (reverse) await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' })
    else await animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease' })
    return
  }
  const s = Math.max(0.01, Math.min(1, softness))
  const frame = ctx.createImageData(w, h)
  const px = frame.data
  setMask(el, 'none', '100% 100%', 'no-repeat')
  await driveFrames(ms, (t) => {
    // threshold sweeps from -s (everything kept) to 1 (nothing kept)
    const thr = t * (1 + s) - s
    for (let i = 0; i < w * h; i++) {
      let a = (lum![i]! - thr) / s
      a = a < 0 ? 0 : a > 1 ? 1 : a
      if (reverse) a = 1 - a
      px[i * 4 + 3] = Math.round(a * 255)
    }
    ctx!.putImageData(frame, 0, 0)
    setMask(el, `url("${canvas!.toDataURL()}")`, '100% 100%', 'no-repeat')
  }, stale)
}

/** One step of a typed line: a character span, a `{w:}` pause, or a `{p}` break. */
interface LineItem {
  span?: HTMLSpanElement
  handle?: TextSpan
  effect?: string
  pause?: number
  page?: boolean
}

/** A character that belongs to a word (breaks only at its edges): letters,
 *  digits, marks and Latin-style punctuation — not CJK, kana, hangul or Thai,
 *  which wrap per character, and not spaces. */
const NO_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\u3000-\u303f\uff00-\uffef]/u
const WORD = /[\p{L}\p{N}\p{M}\p{P}]/u
function isWordChar(ch: string): boolean {
  return WORD.test(ch) && !NO_WORD.test(ch)
}

/** A chrome button for the modal boxes (confirm / prompt). */
function modalButton(label: string, id: 'ok' | 'cancel', primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `nilvn-screen__button${primary ? ' nilvn-screen__button--primary' : ''}`
  b.dataset.id = id
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

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
  /** The `back` band: between the background and the characters (band='back'). */
  readonly backLayer: HTMLDivElement
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
  private choicesTimer: number | undefined
  private choicesLayout: ChoicesLayout = {}
  private overflow: OverflowMode = 'grow'
  /** The line being typed: its items and where the next page starts. A repaint
   *  while the player is parked at a page break (`repaintLine`) swaps both. */
  private lineItems: LineItem[] = []
  private lineStart = 0
  /** Pages already turned in the current line (0 = still on the first). */
  private linePage = 0
  /** Set while `typeLine` waits at a page break. */
  private lineParked = false
  /** An image the stage was told to show failed to load (a wrong path). The
   *  engine turns it into a diagnostic. */
  onAssetError?: (what: string, url: string) => void
  /** A hotspot was declared where a click cannot reach it — something else is
   *  drawn over its centre. The engine turns it into a diagnostic. */
  onObstructed?: (id: string, by: string) => void
  /** Screen-space band hosting objects promoted over the dialogue (band='front').
   *  Sits above dialogue/choices, below the transition fader; empty by default. */
  readonly frontLayer: HTMLDivElement
  readonly fader: HTMLDivElement

  private chars = new Map<string, CharSlot>()
  /** The frozen picture a `beginTransition` took, until `endTransition` / restore. */
  private transSnapshot: HTMLElement | null = null
  private hotspots = new Map<string, { el: HTMLDivElement; spec: HotspotSpec }>()
  objectClick?: (objId: string, onclick: string) => void
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
    this.backLayer = div('nilvn-layer nilvn-back')
    this.fxLayer = div('nilvn-layer nilvn-fx')
    this.camera.append(this.bgLayer, this.backLayer, this.charLayer, this.spriteLayer, this.fxLayer)

    this.dialog = div('nilvn-dialog nilvn-hidden')
    this.nameEl = div('nilvn-name nilvn-hidden')
    this.textEl = div('nilvn-text')
    this.indicator = div('nilvn-indicator')
    this.dialog.append(this.nameEl, this.textEl, this.indicator)

    this.choicesEl = div('nilvn-choices')
    this.choicesEl.addEventListener('click', (e) => e.stopPropagation())

    this.frontLayer = div('nilvn-layer nilvn-front')
    this.fader = div('nilvn-fader')
    this.screenLayer = div('nilvn-layer nilvn-screens')
    this.pageSlot = div('nilvn-layer nilvn-pages')
    this.screenLayer.append(this.pageSlot)

    this.root.append(this.camera, this.dialog, this.choicesEl, this.frontLayer, this.fader, this.screenLayer)
    container.append(this.root)
    this.injectStyle(`.nilvn-root{${themeDefaultsCss()}}` + BASE_CSS, 'nilvn-base-style')
  }

  // ---- chrome screens: full-stage pages over everything (title / ending; menus in inc 4) ----
  private readonly screenLayer: HTMLElement
  private toastEl: HTMLElement | undefined
  private toastTimer: number | undefined
  /** Full-stage pages (title / ending) live here, under the menu overlays and modals. */
  private readonly pageSlot: HTMLElement
  private screen: { id: ScreenId; el: HTMLElement } | null = null
  readonly chrome: ChromeRenderer = {
    showScreen: (id, model) => {
      this.pageSlot.replaceChildren()
      const el = this.buildScreen(id, model)
      this.pageSlot.append(el)
      this.screen = { id, el }
      el.querySelector<HTMLButtonElement>('.nilvn-screen__button--primary, .nilvn-screen__button')?.focus({ preventScroll: true })
    },
    hideScreen: (id) => {
      if (this.screen && (id === undefined || this.screen.id === id)) {
        this.screen.el.remove()
        this.screen = null
      }
    },
    currentScreen: () => this.screen?.id ?? null,
    setProgress: (ratio) => {
      const bar = this.screen?.el.querySelector<HTMLElement>('.nilvn-screen__progress')
      bar?.style.setProperty('--progress', String(Math.max(0, Math.min(1, ratio))))
    },
    overlay: (className) => {
      const layer = div(className)
      this.screenLayer.append(layer)
      return layer
    },
    toast: (message) => {
      this.toastEl ??= div('nilvn-toast')
      this.toastEl.textContent = message
      this.screenLayer.append(this.toastEl)
      this.toastEl.classList.add('on')
      if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
      this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove('on'), 1800)
    },
    confirm: (message, labels) =>
      new Promise<boolean>((resolve) => {
        const modal = div('nilvn-modal')
        modal.addEventListener('click', (e) => e.stopPropagation())
        const box = div('nilvn-modal__box')
        const msg = div('nilvn-modal__msg')
        msg.textContent = message
        const bar = div('nilvn-modal__buttons')
        const finish = (ok: boolean): void => {
          modal.remove()
          resolve(ok)
        }
        if (labels.cancel !== undefined) bar.append(modalButton(labels.cancel, 'cancel', false, () => finish(false)))
        bar.append(modalButton(labels.ok, 'ok', true, () => finish(true)))
        box.append(msg, bar)
        modal.append(box)
        // Keys on the focused button: Esc cancels, Enter confirms — and never reach
        // the window (the engine's advance / menu keys).
        modal.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Escape') finish(false)
        })
        this.screenLayer.append(modal)
        bar.querySelector<HTMLButtonElement>('[data-id="ok"]')?.focus({ preventScroll: true })
      }),
    prompt: (message, opts) => {
      let cancel: () => void = () => {}
      const result = new Promise<string | null>((resolve) => {
        const pos = opts.position && opts.position !== 'center' ? ` nilvn-modal--${opts.position}` : ''
        const modal = div(`nilvn-modal nilvn-modal--input${pos}`)
        modal.addEventListener('click', (e) => e.stopPropagation())
        const box = div('nilvn-modal__box')
        const field = document.createElement('input')
        field.type = 'text'
        field.className = 'nilvn-modal__input'
        field.autocomplete = 'off'
        field.spellcheck = false
        if (opts.default) field.placeholder = opts.default
        if (opts.maxlength && opts.maxlength > 0) field.maxLength = opts.maxlength
        let re: RegExp | undefined
        if (opts.pattern) {
          try {
            re = new RegExp(`^(?:${opts.pattern})$`, 'u')
          } catch {
            re = undefined
          }
        }
        const valid = (): boolean => !re || field.value.trim() === '' || re.test(field.value.trim())
        let done = false
        const finish = (v: string | null): void => {
          if (done) return
          done = true
          modal.remove()
          resolve(v)
        }
        const submit = (): void => {
          if (valid()) finish(field.value.trim())
        }
        const bar = div('nilvn-modal__buttons')
        const okBtn = modalButton(opts.ok, 'ok', true, submit)
        bar.append(modalButton(opts.cancel, 'cancel', false, () => finish(null)), okBtn)
        field.addEventListener('input', () => {
          const ok = valid()
          okBtn.disabled = !ok
          field.setAttribute('aria-invalid', ok ? 'false' : 'true')
        })
        if (message) {
          const msg = div('nilvn-modal__msg')
          msg.textContent = message
          box.append(msg)
        }
        box.append(field, bar)
        modal.append(box)
        modal.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Escape') finish(null)
          else if (e.key === 'Enter' && e.target === field) submit()
        })
        cancel = () => finish(null)
        this.screenLayer.append(modal)
        field.focus({ preventScroll: true })
      })
      return { result, cancel: () => cancel() }
    },
  }

  private buildScreen(id: ScreenId, model: ScreenModel): HTMLElement {
    const el = div(`nilvn-screen nilvn-screen--${id} nilvn-screen--${model.layout ?? 'center'}`)
    // A screen owns its clicks: none may fall through to click-to-advance.
    el.addEventListener('click', (e) => e.stopPropagation())
    const bg = div('nilvn-screen__bg')
    if (model.background) el.style.setProperty('--screen-bg', model.background)
    el.append(bg)
    if (model.logo) {
      const img = document.createElement('img')
      img.className = 'nilvn-screen__logo'
      this.watchImage(img, 'logo')
      img.src = model.logo
      img.alt = model.heading ?? ''
      if (model.logoWidth) img.style.width = model.logoWidth
      el.append(img)
    }
    if (model.heading) {
      const h = document.createElement('h1')
      h.className = 'nilvn-screen__heading'
      h.textContent = model.heading
      el.append(h)
    }
    if (model.subtitle) {
      const p = document.createElement('p')
      p.className = 'nilvn-screen__subtitle'
      p.textContent = model.subtitle
      el.append(p)
    }
    if (model.progress !== undefined) {
      const bar = div('nilvn-screen__progress')
      bar.style.setProperty('--progress', String(Math.max(0, Math.min(1, model.progress))))
      el.append(bar)
    }
    if (model.credits?.length) {
      const box = div('nilvn-screen__credits')
      const roll = div('nilvn-screen__roll')
      roll.textContent = model.credits.join('\n')
      if (model.creditsDuration) roll.style.setProperty('--roll-duration', `${model.creditsDuration}s`)
      roll.addEventListener('animationend', () => model.onCreditsEnd?.())
      box.append(roll)
      el.append(box)
    }
    if (model.buttons.length) {
      const bar = div('nilvn-screen__buttons')
      for (const b of model.buttons) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `nilvn-screen__button${b.primary ? ' nilvn-screen__button--primary' : ''}`
        btn.dataset.id = b.id
        btn.textContent = b.label
        btn.addEventListener('click', () => b.onSelect())
        bar.append(btn)
      }
      el.append(bar)
    }
    if (model.version) {
      const v = div('nilvn-screen__version')
      v.textContent = model.version
      el.append(v)
    }
    return el
  }

  // ---- theme: two layers of `--nilvn-*` overrides painted inline on the root ----
  private themeBase: Record<string, string> = {}
  private themeScript: Record<string, string> = {}
  private paintedTokens = new Set<string>()

  setThemeBase(tokens: Record<string, string>): void {
    this.themeBase = cleanTheme(tokens)
    this.paintTheme()
  }

  setTheme(patch: Record<string, string | undefined> | null): void {
    if (patch === null) this.themeScript = {}
    else {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') delete this.themeScript[k]
        else this.themeScript[k] = String(v)
      }
    }
    this.paintTheme()
  }

  getTheme(): Readonly<Record<string, string>> {
    return { ...this.themeBase, ...this.themeScript }
  }

  private paintTheme(): void {
    for (const k of this.paintedTokens) this.root.style.removeProperty(themeVar(k))
    this.paintedTokens.clear()
    for (const [k, v] of Object.entries(this.getTheme())) {
      this.root.style.setProperty(themeVar(k), v)
      this.paintedTokens.add(k)
    }
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
    const layered = !!opts.layers
    if (layered) await Promise.all(opts.layers!.map((l) => preloadImage(l.url)))
    else await preloadImage(url)
    let slot = this.chars.get(id)
    if (!slot) {
      const el = div('nilvn-char')
      el.dataset.id = id
      el.style.left = toLeft(opts.at ?? 'center')
      if (layered) {
        const box = div('nilvn-char__layers')
        el.append(box)
        slot = { el, box, layers: new Map(), layerUrl: opts.layerUrl, face: opts.face, faceUrl: opts.faceUrl, transform: freshTransform() }
        this.setCanvas(slot, opts.canvas)
        this.applyLayers(slot, opts.layers!, false)
      } else {
        const img = new Image()
        this.watchImage(img, `sprite of "${id}"`)
        img.src = url
        img.draggable = false
        el.append(img)
        slot = { el, img, face: opts.face, faceUrl: opts.faceUrl, ref: opts.ref, transform: freshTransform() }
      }
      this.charLayer.append(el)
      this.chars.set(id, slot)
      this.applyBirthTransform(el, slot.transform, opts)
      const fade = opts.fade ?? 0.3
      if (fade > 0) await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: fade * 1000, easing: 'ease' })
      return
    }
    if (layered) {
      // A single-image character re-shown as layered (or the reverse) rebuilds its art.
      if (!slot.box) {
        slot.img?.remove()
        slot.img = undefined
        slot.ref = undefined
        slot.box = div('nilvn-char__layers')
        slot.layers = new Map()
        slot.el.append(slot.box)
      }
      if (opts.layerUrl) slot.layerUrl = opts.layerUrl
      this.setCanvas(slot, opts.canvas)
      this.applyLayers(slot, opts.layers!, true)
    } else {
      if (slot.box) {
        slot.box.remove()
        slot.box = undefined
        slot.layers = undefined
        const img = new Image()
        this.watchImage(img, `sprite of "${id}"`)
        img.draggable = false
        slot.el.append(img)
        slot.img = img
      }
      const img = slot.img!
      if (img.src !== url) {
        img.src = url
        slot.ref = opts.ref
        void animate(img, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 160 })
      } else if (opts.ref !== undefined) slot.ref = opts.ref
    }
    if (opts.face) slot.face = opts.face
    if (opts.faceUrl) slot.faceUrl = opts.faceUrl
    if (opts.at) slot.el.style.left = toLeft(opts.at)
    this.applyBirthTransform(slot.el, slot.transform, opts)
  }

  private setCanvas(slot: CharSlot, canvas: [number, number] | undefined): void {
    if (!slot.box || !canvas) return
    slot.box.style.setProperty('--canvas-w', String(canvas[0]))
    slot.box.style.setProperty('--canvas-h', String(canvas[1]))
    slot.canvas = canvas
  }

  /** Bring a layered character's images to `layers`: new ones appear, a changed
   *  one cross-fades, one no longer listed goes. Order (bottom → top) follows the
   *  list. */
  private applyLayers(slot: CharSlot, layers: CharLayer[], animateSwap: boolean): void {
    const box = slot.box!
    const have = slot.layers!
    const keep = new Set(layers.map((l) => l.name))
    for (const [name, l] of [...have]) {
      if (keep.has(name)) continue
      l.img.remove()
      have.delete(name)
    }
    for (const l of layers) {
      let cur = have.get(l.name)
      if (!cur) {
        const img = new Image()
        this.watchImage(img, `layer "${l.name}"`)
        img.draggable = false
        img.src = l.url
        cur = { img, value: l.value, ref: l.ref }
        have.set(l.name, cur)
      } else if (cur.img.src !== l.url) {
        cur.img.src = l.url
        cur.value = l.value
        cur.ref = l.ref
        if (animateSwap) void animate(cur.img, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 160 })
      } else cur.value = l.value
      this.placeLayer(slot, cur.img, l.offset)
      box.append(cur.img) // (re)append keeps the listed order
    }
    if (layers.some((l) => l.name === 'face')) slot.face = layers.find((l) => l.name === 'face')!.value
  }

  /** A layer image's place on the canvas: its offset and natural size as
   *  percentages of the canvas, so the whole composition scales with the stage. */
  private placeLayer(slot: CharSlot, img: HTMLImageElement, offset: [number, number] | undefined): void {
    const [w, h] = slot.canvas ?? [0, 0]
    const [ox, oy] = offset ?? [0, 0]
    if (w > 0 && h > 0) {
      img.style.left = `${(ox / w) * 100}%`
      img.style.top = `${(oy / h) * 100}%`
      const nw = img.naturalWidth
      img.style.width = nw > 0 ? `${(nw / w) * 100}%` : '100%'
    }
  }

  charLayers(id: string): Record<string, string> | undefined {
    const slot = this.chars.get(id)
    if (!slot?.layers) return undefined
    return Object.fromEntries([...slot.layers].map(([name, l]) => [name, l.value]))
  }

  // ---- hotspots: clickable regions in the world (they pan with the camera) ----

  showHotspot(spec: HotspotSpec, probe = true): void {
    let h = this.hotspots.get(spec.id)
    const moved = !h || h.spec.x !== spec.x || h.spec.y !== spec.y || h.spec.w !== spec.w || h.spec.h !== spec.h
    if (!h) {
      const el = div('nilvn-hotspot')
      el.dataset.id = spec.id
      el.addEventListener('click', (ev) => {
        const cmd = this.hotspots.get(spec.id)?.spec.onclick
        if (!cmd) return
        ev.stopPropagation()
        this.objectClick?.(`hotspot:${spec.id}`, cmd)
      })
      this.fxLayer.append(el)
      h = { el, spec }
      this.hotspots.set(spec.id, h)
    }
    h.spec = { ...spec }
    h.el.style.left = `${spec.x}%`
    h.el.style.top = `${spec.y}%`
    h.el.style.width = `${spec.w}%`
    h.el.style.height = `${spec.h}%`
    if (probe && moved) this.checkReachable(h.el, spec.id)
  }

  /** A clickable region the player cannot reach is the one content bug the author
   *  cannot see: the dialogue box, a panel or the HUD is drawn over it and takes
   *  the click, while the coordinates still read fine in the script. Probe the
   *  region's own centre — `elementFromPoint` skips `pointer-events: none`, so it
   *  answers exactly what a real click would hit, which `element.click()` in a
   *  test never does. Two things it deliberately does not do: without layout (a
   *  detached stage, jsdom) there is nothing to measure and nothing is said, and
   *  only the moment of declaration is judged, so a box shown afterwards over a
   *  standing hotspot goes unreported. */
  private checkReachable(el: HTMLElement, id: string): void {
    if (!this.onObstructed) return
    const doc = el.ownerDocument
    if (typeof doc.elementFromPoint !== 'function') return // a DOM without hit testing
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return
    const top = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!top || top === el || el.contains(top)) return
    const named = top.closest('[class*="nilvn-"]') ?? top
    this.onObstructed(id, named.className || named.tagName.toLowerCase())
  }

  hideHotspot(id: string): void {
    const h = this.hotspots.get(id)
    if (!h) return
    h.el.remove()
    this.hotspots.delete(id)
  }

  clearHotspots(): void {
    for (const id of [...this.hotspots.keys()]) this.hideHotspot(id)
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
    el.classList.toggle('nilvn-clickable', !!spec.onclick)
    if (spec.onclick && !el.dataset.click) {
      el.dataset.click = '1'
      el.addEventListener('click', (ev) => {
        const cmd = this.sprites.get(id)?.spec.onclick
        if (!cmd) return
        ev.stopPropagation()
        this.objectClick?.(`sprite:${id}`, cmd)
      })
    }
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
    b.slot.band = band === 'front' || band === 'back' ? band : undefined
    const target = band === 'front' ? this.frontLayer : band === 'back' ? this.backLayer : this.homeBandEl(b.kind)
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
    if (slot.layers) {
      const url = slot.layerUrl?.('face', face)
      const cur = slot.layers.get('face')
      if (url && cur && cur.img.src !== url) {
        cur.img.src = url
        cur.value = face
      }
      return
    }
    const url = slot.faceUrl?.(face)
    if (url && slot.img && slot.img.src !== url) slot.img.src = url
  }

  // ---- scene transitions (batch I inc 4): a frozen snapshot of the old picture
  // over the scene; the scene changes underneath; the snapshot gives way with an
  // effect. The snapshot is a clone of the camera (backgrounds, characters,
  // sprites, fx), so whatever the scene becomes shows through where the effect
  // has cleared it.

  beginTransition(): void {
    this.dropSnapshot()
    const clone = this.camera.cloneNode(true) as HTMLElement
    clone.classList.add('nilvn-snapshot')
    this.camera.after(clone)
    this.transSnapshot = clone
  }

  transitionPending(): boolean {
    return this.transSnapshot !== null
  }

  private dropSnapshot(): void {
    this.transSnapshot?.remove()
    this.transSnapshot = null
  }

  async endTransition(kind: TransitionKind, opts: SceneTransitionOpts = {}): Promise<void> {
    const snap = this.transSnapshot
    if (!snap) return
    this.transSnapshot = null
    const gen = this.restoreGen
    const dur = Math.max(0, opts.duration ?? 0.6) * 1000
    const dir = opts.dir ?? (kind === 'slide' ? 'left' : 'right')
    const stale = (): boolean => this.restoreGen !== gen || !snap.isConnected
    try {
      if (opts.mask || kind === 'rule') {
        if (opts.mask) await animateRuleMask(snap, opts.mask, dur, opts.softness ?? 0.1, false, stale)
        else await animate(snap, [{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease' })
      } else if (kind === 'fade') {
        const cover = document.createElement('div')
        cover.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${opts.color ?? '#000'};opacity:0`
        snap.after(cover)
        try {
          await animate(cover, [{ opacity: 0 }, { opacity: 1 }], { duration: dur / 2, easing: 'ease-in' })
          snap.remove()
          if (!stale()) await animate(cover, [{ opacity: 1 }, { opacity: 0 }], { duration: dur / 2, easing: 'ease-out' })
        } finally {
          cover.remove()
        }
      } else if (kind === 'crossfade') {
        await animate(snap, [{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease' })
      } else if (kind === 'wipe') {
        const closed = { right: 'inset(0 0 0 100%)', left: 'inset(0 100% 0 0)', down: 'inset(100% 0 0 0)', up: 'inset(0 0 100% 0)' }[dir]
        await animate(snap, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: closed }], { duration: dur, easing: 'ease-in-out' })
      } else if (kind === 'slide') {
        // A camera at rest carries the literal `none` in its inline transform
        // (composeTransform's fallback), and `translateX(-100%) none` is not a
        // transform list: the browser drops that keyframe and the slide plays as
        // a cut. `none` means "no transform", so treat it as the empty base.
        const rest = snap.style.transform
        const base = rest === 'none' ? '' : rest
        const away = { left: 'translateX(-100%)', right: 'translateX(100%)', up: 'translateY(-100%)', down: 'translateY(100%)' }[dir]
        await animate(snap, [{ transform: base || 'none' }, { transform: `${away} ${base}`.trim() }], { duration: dur, easing: 'ease-in-out' })
      } else if (kind === 'circle') {
        await animate(snap, [{ clipPath: 'circle(75% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)' }], { duration: dur, easing: 'ease-in-out' })
      } else if (kind === 'blinds') {
        // Six slats, each closing left → right: a repeating gradient mask whose
        // opaque part shrinks, driven per frame (a custom property does not tween).
        setMask(snap, 'linear-gradient(to right, #000 var(--p), transparent var(--p))', 'calc(100% / 6) 100%', 'repeat-x')
        await driveFrames(dur, (t) => snap.style.setProperty('--p', `${(1 - t) * 100}%`), stale)
      }
    } finally {
      snap.remove()
    }
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

  setName(name?: string, color?: string, textColor?: string): void {
    if (!name) {
      this.nameEl.classList.add('nilvn-hidden')
      return
    }
    this.nameEl.classList.remove('nilvn-hidden')
    this.nameEl.textContent = name
    const st = this.nameEl.style
    // Per-actor colours ride on the tag itself and win over the root's theme
    // tokens; absent = the theme's `name-bg` / `name-color`.
    if (color) st.setProperty('--nilvn-name-bg', color)
    else st.removeProperty('--nilvn-name-bg')
    if (textColor) st.setProperty('--nilvn-name-color', textColor)
    else st.removeProperty('--nilvn-name-color')
    // `--name-color` (pre-0.15) is kept one minor version as a READ alias for
    // host CSS that consulted it; the stylesheet no longer reads it.
    if (color) st.setProperty('--name-color', color)
    else st.removeProperty('--name-color')
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
   *  interleaved with the `{w:}` pauses (typing only) and the `{p}` page breaks.
   *  `onSpan` runs for revealed spans at once. */
  private layoutSegments(
    parent: HTMLElement,
    segments: Segment[],
    revealed: boolean,
    onSpan?: (span: TextSpan, effect: string | undefined) => void,
  ): LineItem[] {
    parent.replaceChildren()
    const items: LineItem[] = []
    let index = 0
    // Characters are inline-blocks (text effects transform them), which would
    // let a line break between any two of them; runs of word characters go
    // into a nowrap wrapper so Latin words wrap as words. CJK stays per character.
    let word: HTMLSpanElement | null = null
    for (const seg of segments) {
      if (seg.kind === 'br') {
        parent.append(document.createElement('br'))
        word = null
        continue
      }
      if (seg.kind === 'pause') {
        if (!revealed) items.push({ pause: seg.sec })
        continue
      }
      if (seg.kind === 'page') {
        items.push({ page: true })
        word = null
        continue
      }
      for (const ch of seg.text) {
        const span = document.createElement('span')
        span.className = revealed ? 'nilvn-ch on' : 'nilvn-ch'
        span.textContent = ch
        span.style.setProperty('--i', String(index))
        if (isWordChar(ch)) {
          if (!word) {
            word = document.createElement('span')
            word.className = 'nilvn-word'
            parent.append(word)
          }
          word.append(span)
        } else {
          word = null
          parent.append(span)
        }
        const handle: TextSpan = { index, char: ch, addClass: (name) => span.classList.add(name) }
        if (revealed) onSpan?.(handle, seg.effect)
        items.push({ span, handle, effect: seg.effect })
        index++
      }
    }
    return items
  }

  // ---- overflow: paging and shrinking (`[window] overflow`) ----

  setOverflow(mode: OverflowMode): void {
    this.overflow = mode
    // A fixed-height box is what makes "does not fit" measurable; `grow` keeps
    // the classic min-height box that stretches with its text.
    this.dialog.classList.toggle('nilvn-dialog--fixed', mode !== 'grow')
    if (mode !== 'shrink') this.textEl.style.fontSize = ''
  }

  /** Where the text must end — px from the dialog's padding edge (what a
   *  character's `offsetTop` is measured from) — or Infinity when the box may
   *  grow (`grow` mode) or cannot be measured (no layout, as in jsdom). */
  private textLimit(): number {
    if (this.overflow === 'grow') return Infinity
    const limit = this.dialog.clientHeight - (parseFloat(getComputedStyle(this.dialog).paddingBottom) || 0)
    return limit > 0 ? limit : Infinity
  }

  /** Report an image that fails to load (the engine makes it a diagnostic). */
  private watchImage(img: HTMLImageElement, what: string): void {
    img.addEventListener('error', () => this.onAssetError?.(what, img.src))
  }

  private overflows(span: HTMLElement, limit: number): boolean {
    return span.offsetTop + span.offsetHeight > limit
  }

  /** The index the page starting at `start` ends before: the next `{p}`, or (in
   *  `page` mode) the first character past the box. Never an empty page. */
  private pageEnd(items: LineItem[], start: number): number {
    const limit = this.overflow === 'page' ? this.textLimit() : Infinity
    for (let i = start; i < items.length; i++) {
      const it = items[i]!
      if (it.page) return i
      if (it.span && limit !== Infinity && this.overflows(it.span, limit)) return i > start ? i : i + 1
    }
    return items.length
  }

  /** Take a finished page out of the flow so the next one starts at the top:
   *  every node from the page's first character up to the next page's first
   *  character (line breaks between them included). */
  private hidePage(items: LineItem[], start: number, end: number): void {
    const first = items.slice(start, end).find((it) => it.span)?.span
    const next = items.slice(end).find((it) => it.span)?.span ?? null
    if (!first) return
    // Document order, so a page that starts or ends inside a word wrapper hides
    // the wrapper's characters one by one and everything between as a whole.
    // A page starting on a word's first character hides the whole word.
    const wrapper = first.parentElement
    const from = wrapper && wrapper !== this.textEl && wrapper.firstElementChild === first ? wrapper : first
    let on = false
    for (const el of this.textEl.querySelectorAll<HTMLElement>('*')) {
      if (el === from) on = true
      if (el === next) break
      if (!on || (next && el.contains(next))) continue
      el.classList.add('nilvn-off')
    }
  }

  /** Move `start` past the page break itself. */
  private nextPageStart(items: LineItem[], end: number): number {
    let start = end
    while (start < items.length && items[start]!.page) start++
    return start
  }

  /** `shrink` mode: scale the text down (to half at most) until the last
   *  character fits the box. */
  private shrinkToFit(): void {
    this.textEl.style.fontSize = ''
    const limit = this.textLimit()
    if (limit === Infinity) return
    const spans = this.textEl.querySelectorAll<HTMLElement>('.nilvn-ch')
    const last = spans[spans.length - 1]
    if (!last) return
    for (let k = 0.95; k >= 0.5 && this.overflows(last, limit); k -= 0.05) {
      this.textEl.style.fontSize = `calc(var(--nilvn-text-size)*var(--nilvn-ui-scale)*${k.toFixed(2)})`
    }
  }

  async typeLine(segments: Segment[], opts: TypeLineOptions): Promise<boolean> {
    this.lineItems = this.layoutSegments(this.textEl, segments, false)
    if (this.overflow === 'shrink') this.shrinkToFit()
    this.lineStart = 0
    this.linePage = 0
    this.lineParked = false
    try {
      while (this.lineStart < this.lineItems.length) {
        const items = this.lineItems
        const start = this.lineStart
        const end = this.pageEnd(items, start)
        for (let i = start; i < end; i++) {
          const item = items[i]!
          if (!opts.alive()) return false
          if (item.pause !== undefined) {
            await this.skippableSleep(item.pause * 1000, opts.skip)
            continue
          }
          if (!item.span) continue
          item.span.classList.add('on')
          opts.onReveal?.(item.handle!, item.effect)
          const cps = opts.cps()
          if (!opts.skip() && cps > 0) await this.skippableSleep(1000 / cps, opts.skip)
        }
        if (end >= items.length) return false
        if (!opts.alive()) return false
        this.lineParked = true
        await opts.onPage?.()
        this.lineParked = false
        if (!opts.alive()) return false
        if (this.lineItems === items) {
          // No repaint happened while parked: turn the page of this layout.
          this.hidePage(items, start, end)
          this.lineStart = this.nextPageStart(items, end)
        } else {
          // A repaint swapped the line while parked (`repaintLine`): lineStart is
          // the page the player was looking at in the new layout — turn that.
          const cur = this.lineItems
          if (this.lineStart >= cur.length) return true // the new text had no page after it: the tap ended the line
          const curEnd = this.pageEnd(cur, this.lineStart)
          this.hidePage(cur, this.lineStart, curEnd)
          this.lineStart = this.nextPageStart(cur, curEnd)
        }
        this.linePage++
      }
    } finally {
      this.lineParked = false
    }
    return false
  }

  /** Re-render a line the player is parked INSIDE (at a page break) — a
   *  language switch while a `{p}` page is up. The new text is laid out, its
   *  pages before the current one are hidden, the current one shown, and the
   *  typewriter continues from the page after it once the player advances
   *  (or the tap ends the line when the new text has no more pages). Returns
   *  false when no line is parked mid-way (the caller repaints with `setLine`). */
  repaintLine(segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): boolean {
    if (!this.lineParked) return false
    const items = this.layoutSegments(this.textEl, segments, true, onSpan)
    if (this.overflow === 'shrink') this.shrinkToFit()
    let start = 0
    for (let page = 0; ; page++) {
      const end = this.pageEnd(items, start)
      if (page === this.linePage || end >= items.length) {
        for (let i = end; i < items.length; i++) items[i]!.span?.classList.remove('on')
        this.lineItems = items
        // The shown page's start (typeLine turns it on the next tap), or past
        // the end when the new text has nothing after this page.
        this.lineStart = end >= items.length ? items.length : start
        return true
      }
      this.hidePage(items, start, end)
      start = this.nextPageStart(items, end)
    }
  }

  setLine(segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): void {
    const items = this.layoutSegments(this.textEl, segments, true, onSpan)
    if (this.overflow === 'shrink') this.shrinkToFit()
    // A repaint shows the line's LAST page (the one the player is parked on).
    let start = 0
    for (;;) {
      const end = this.pageEnd(items, start)
      if (end >= items.length) return
      this.hidePage(items, start, end)
      start = this.nextPageStart(items, end)
    }
  }

  setChoicesLayout(layout: ChoicesLayout): void {
    this.choicesLayout = { ...layout }
    for (const c of [...this.choicesEl.classList]) if (c.startsWith('nilvn-choices--')) this.choicesEl.classList.remove(c)
    if (layout.position && layout.position !== 'center') this.choicesEl.classList.add(`nilvn-choices--${layout.position}`)
  }

  showChoices(items: ChoiceView[], onSpan?: (span: TextSpan, effect: string | undefined) => void, opts: ChoicesPromptOptions = {}): ChoicePrompt {
    this.clearChoices()
    const list = div(`nilvn-choices__list${this.choicesLayout.layout === 'grid' ? ' nilvn-choices__list--grid' : ''}`)
    if (this.choicesLayout.columns) list.style.setProperty('--choices-columns', String(this.choicesLayout.columns))
    let resolve: (i: number | null) => void = () => {}
    const chosen = new Promise<number | null>((r) => {
      resolve = r
    })
    const settle = (i: number | null): void => {
      if (this.choicesTimer !== undefined) clearTimeout(this.choicesTimer)
      this.choicesTimer = undefined
      resolve(i)
    }
    const buttons: HTMLButtonElement[] = []
    const handles: ChoiceHandle[] = items.map((item, index) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `nilvn-choice${item.chosen ? ' chosen' : ''}`
      if (item.disabled) btn.disabled = true
      this.layoutSegments(btn, item.segments, true, onSpan)
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!btn.disabled) settle(index)
      })
      list.append(btn)
      buttons.push(btn)
      return { index, addClass: (name) => btn.classList.add(name), setVar: (name, value) => btn.style.setProperty(name, value) }
    })
    if (opts.timer && opts.timer > 0) {
      const bar = div('nilvn-choices__timer')
      bar.style.setProperty('--choices-timer', `${opts.timer}s`)
      list.append(bar)
      const firstEnabled = items.findIndex((it) => !it.disabled)
      const want = opts.timeoutIndex
      const pick = want !== undefined && want >= 0 && want < items.length && !items[want]!.disabled ? want : firstEnabled
      this.choicesTimer = window.setTimeout(() => settle(pick < 0 ? null : pick), opts.timer * 1000)
    }
    this.choicesEl.append(list)
    this.choicesEl.classList.add('on')
    return {
      handles,
      chosen,
      cancel: () => settle(null),
      relabel: (index, segments, on) => {
        const btn = buttons[index]
        if (btn) this.layoutSegments(btn, segments, true, on ?? onSpan)
      },
    }
  }

  private clearChoices(): void {
    if (this.choicesTimer !== undefined) clearTimeout(this.choicesTimer)
    this.choicesTimer = undefined
    this.choicesEl.replaceChildren()
  }

  hideChoices(): void {
    this.choicesEl.classList.remove('on')
    this.clearChoices()
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
    if (opts?.mask) {
      // A rule image: the colour spreads over dark pixels first (cover), or leaves
      // them first (reveal).
      await animateRuleMask(overlay, opts.mask, dur, opts.softness ?? 0.1, cover, () => this.restoreGen !== gen)
    } else if (shape === 'blinds') {
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
        src: slot.ref ?? slot.img?.src ?? '',
        at: pctOr(slot.el.style.left, 50),
        face: slot.face,
        layers: slot.layers ? Object.fromEntries([...slot.layers].map(([name, l]) => [name, l.value])) : undefined,
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
            onclick: slot.spec.onclick,
            band: slot.band,
            ...restingState(slot),
          }))
        : undefined,
      hotspots: this.hotspots.size ? [...this.hotspots.values()].map((h) => ({ ...h.spec })) : undefined,
      windows: windowsState(this.windowModel, this.windowSkinRef ?? this.windowSkin),
      camera: cameraState(this.cameraModel),
      cover: coverState(this.fader),
      name: this.nameEl.classList.contains('nilvn-hidden') ? undefined : (this.nameEl.textContent ?? undefined),
      nameColor: this.nameEl.style.getPropertyValue('--nilvn-name-bg') || undefined,
      nameTextColor: this.nameEl.style.getPropertyValue('--nilvn-name-color') || undefined,
      theme: Object.keys(this.themeScript).length ? { ...this.themeScript } : undefined,
      text: this.textEl.textContent ?? '',
      dialog: !this.dialog.classList.contains('nilvn-hidden'),
    }
  }

  /** Repaint the stage from a snapshot, instantly (no fades). */
  async restore(
    state: StageState,
    faceUrl?: (charId: string, face: string) => string | undefined,
    resolveUrl?: (src: string) => string,
    charLayers?: (charId: string, values: Record<string, string>) => Pick<CharOptions, 'layers' | 'canvas' | 'layerUrl'> | undefined,
  ): Promise<void> {
    this.restoreGen++ // invalidate any in-flight screen transition (see transitionScreen)
    this.dropSnapshot() // and an armed scene transition: the restored picture is the truth
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
      // passes a URL through unchanged, so both paint. A layered character is
      // rebuilt from its layer values through the engine's actor templates.
      const layered = c.layers && charLayers ? charLayers(c.id, c.layers) : undefined
      if (c.layers && !layered) continue // the actor lost its layers: nothing to draw
      await this.showChar(c.id, url(c.src), {
        at: String(c.at),
        face: c.face,
        ref: c.src,
        faceUrl: faceUrl ? (f) => faceUrl(c.id, f) : undefined,
        ...layered,
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
        { url: url(s.url), ref: s.url, frames: s.frames, fps: s.fps, loop: s.loop, at: String(s.at), height: s.height, y: s.y, scale: s.scale, rotation: s.rotation, onclick: s.onclick },
        0,
      )
      this.applyRestingPose(`sprite:${s.id}`, s)
      if (s.band && s.band !== 'world') this.setBand(`sprite:${s.id}`, s.band)
    }
    this.clearHotspots()
    // No probing here: a restore rebuilds the stage in pieces, so what covers what
    // mid-rebuild says nothing about the script the author wrote.
    for (const h of state.hotspots ?? []) if (h && typeof h.id === 'string' && typeof h.onclick === 'string') this.showHotspot(h, false)
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
    // The script theme layer is part of the stage: reset, then re-apply the saved one.
    this.setTheme(null)
    if (state.theme) this.setTheme(state.theme)
    this.setName(state.name, state.nameColor, state.nameTextColor)
    this.textEl.textContent = state.text
    this.showDialog(state.dialog)
    this.showIndicator(state.dialog)
    this.choicesEl.classList.remove('on')
    this.clearChoices()
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

