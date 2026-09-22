// The renderer seam: the backend-agnostic surface the engine and content plugins
// speak to. Today the only implementation is the DOM `DomRenderer` (stage.ts);
// a future PixiJS/WebGL backend (Live2D, particles) can
// satisfy the same contract without touching the IR, editor, DSL, or engine loop.
//
// Principle: the renderer takes only semantic instructions (show who, where,
// which face, fade how long) plus a generic, addressable transform surface
// (hasObject / getProp / setProp / animate over the fixed transform schema).
// WAAPI keyframes, HTMLDivElements, and CSS class names stay inside the backend.
// Bespoke per-type FX verbs (shakeCamera / animateChar) were collapsed in batch 3
// increment 2a: effects now produce semantic `TransformKeyframe[]` and call the
// generic `animate(objId, …)`
//
// Orthogonal to `EditStage` (stage.ts): that is the *editor's* edit-time seam
// (overlay hosting, hit-testing, inline editing); this is the *engine/plugin*
// render seam. `DomRenderer` implements both.

import type { Segment, TextSpan } from '../types.js'

/** Stage position: a named anchor or a percentage string ("left" / "50"). The
 *  backend interprets it (DOM = left%, a future WebGL backend = world coords). */
export type StagePos = string

export interface CharOptions {
  at?: string
  fade?: number
  face?: string
  /** The unresolved script path the image came from. Stored so a save carries
   *  the REF (re-resolved on load through the engine) instead of the resolved —
   *  possibly data: — URL. Absent = the URL is saved as-is. */
  ref?: string
  /** Birth vertical position — distance of the slot's bottom edge above the stage
   *  floor, as a percentage of stage height (0 = on the floor, the default). Maps
   *  to CSS `bottom`, mirroring how `at` maps to `left`. Editor write-back target
   *  for free drag. */
  y?: number
  /** Birth scale — seeds the resting transform's scale channel (1 = native). */
  scale?: number
  /** Birth rotation in degrees — seeds the resting transform's rotation channel. */
  rotation?: number
  /** Resolve a face name to a ready-to-use sprite URL. The renderer stores this so
   *  a later `face` channel change (recorded keyframe / scrub) can recompute the
   *  image on its own — path/alias/asset-table resolution lives in the engine, so
   *  the closure (built from the actor's `{face}` template) is the only way the
   *  renderer can produce a new face's URL. Absent (or returning undefined) for
   *  characters shown by raw `src=` (no template); then `setFace` only records the
   *  name, can't swap art. */
  faceUrl?: (face: string) => string | undefined
  /** Layered sprite: the images composed over `canvas`, bottom to top. When
   *  given, `url` is ignored; a later call replaces the set (a layer whose url
   *  changed cross-fades, a layer no longer listed goes). */
  layers?: CharLayer[]
  /** The layers' shared canvas in image pixels (`[width, height]`). */
  canvas?: [number, number]
  /** Resolve a layer's value to a URL, so a `face` channel change re-paints the
   *  `face` layer (the engine owns path resolution). */
  layerUrl?: (layer: string, value: string) => string | undefined
}

/** A sprite-frame animation: a single-row spritesheet played as a frame loop.
 *  The first object kind contributed by a *plugin* (`spriteanim`) rather than the
 *  engine The renderer owns the frame-stepping primitive
 *  (CSS `steps()` over `background-position`); the plugin owns the author vocabulary
 *  (`[sprite …]`) and the declarative `sprite` kind. Like a character, the sprite is
 *  a transformable object, so the generic transform surface (setProp / animate) and
 *  any effect bound to its kind (e.g. screenfx `shake`) work on it for free. */
export interface SpriteSpec {
  /** Spritesheet image URL (already resolved). */
  url: string
  /** The unresolved script path (see CharOptions.ref). */
  ref?: string
  /** Number of frames in the single-row strip. */
  frames: number
  /** Playback rate in frames per second; the loop lasts `frames / fps` seconds. */
  fps: number
  /** Whether playback loops forever (false = play once, then hold the last frame). */
  loop: boolean
  /** Stage slot — a named anchor or percent, like a character's `at` (default center). */
  at?: string
  /** Display height as a percentage of the stage height (default 30). The width
   *  follows the sheet's per-frame aspect ratio, measured once the image loads. */
  height?: number
  /** Birth vertical position — bottom-edge offset above the stage floor, as a
   *  percentage of stage height (0 = on the floor). Like a character's `y`. */
  y?: number
  /** Birth scale — seeds the resting transform's scale channel (1 = native). */
  scale?: number
  /** Birth rotation in degrees — seeds the resting transform's rotation channel. */
  rotation?: number
  /** Script commands (one per line) the engine runs when the sprite is clicked;
   *  the sprite takes pointer events only when set. */
  onclick?: string
}

/** A clickable region of the stage (`[hotspot]`), in percent of the stage. */
export interface HotspotSpec {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Script commands (one per line) run on click. */
  onclick: string
}

// ---- object transform model ----

/** A length value. A bare number is **pixels**; a `${n}%` string is a percentage
 *  of the object's own box (CSS translate semantics). Both units are needed: the
 *  character pose presets are box-relative (`-4.5%`), the screen/camera rumble is
 *  absolute pixels. */
export type Length = number | `${number}%`

/** The fixed, engine-owned transform schema every *renderable* object honors
 *  (characters / camera). `x`/`y` are offsets composed on top of the object's
 *  natural position — not its absolute stage placement (that stays a per-kind
 *  prop, e.g. a character's `at`). Widening this set is additive-safe; narrowing
 *  it is breaking. Non-positional UI (dialogue box, choices) is *not* renderable
 *  and ignores this schema. */
export interface Transform {
  /** Horizontal offset (default 0). */
  x: Length
  /** Vertical offset (default 0). */
  y: Length
  /** Uniform scale multiplier (default 1). */
  scale: number
  /** Rotation in degrees (default 0). */
  rotation: number
  /** Opacity 0..1 (default 1). */
  opacity: number
  /** Whether the object is rendered (default true). */
  visible: boolean
  /** Stacking order; null = auto/CSS default. */
  zIndex: number | null
}

export type TransformProp = keyof Transform
export type TransformValue = Transform[TransformProp]

/** Which fixed z-band an object lives in.
 *  Orthogonal to the transform schema: a *structural* placement (which layer the
 *  element is parented to), not a CSS transform — so it has its own seam rather
 *  than riding `Transform`. Only bandable kinds (character / sprite) honor it.
 *  - `world`: the kind's home band, inside the camera — shaken / zoomed with it.
 *  - `front`: a screen-space band above the dialogue & choices (below the
 *    transition fader). Lifts the object out of world space: it renders over the
 *    dialogue box but no longer follows camera shake / zoom. */
/** Where a character or sprite is drawn: `world` is its home layer (sprites
 *  over characters over the background, all under the camera), `back` puts a
 *  sprite (or a character) behind the characters — ambient particles, a light
 *  shaft — still under the camera, and `front` lifts it over the dialogue box. */
export type ObjectBand = 'world' | 'front' | 'back'

/** One animation keyframe: any subset of the transform props. The renderer
 *  composes each into the object's transform over its base anchor. */
export type TransformKeyframe = Partial<Transform>

/** A keyframe with explicit WAAPI timing. Extends `TransformKeyframe` with a
 *  position along the clip (`offset`, 0..1) and a per-segment `easing` (the timing
 *  function *into the next* keyframe). Recorded animations need non-uniform timing + per-segment easing; effects that just
 *  want even spacing keep passing a plain `TransformKeyframe[]` (assignable here,
 *  the new fields are optional). */
export interface AnimFrame extends TransformKeyframe {
  /** Position along the animation, 0..1 (WAAPI keyframe offset). Omit = even spacing. */
  offset?: number
  /** Timing function from this keyframe to the next (WAAPI per-keyframe easing). */
  easing?: string
}

export interface AnimOpts {
  durationSec: number
  /** CSS timing function; defaults to the backend's choice (DOM: 'ease'). */
  easing?: string
  /** Repeat count; Infinity for endless (default 1). */
  iterations?: number
  /** How each frame's channels combine with the object's RESTING pose.
   *  - `absolute` (default): a channel a frame names REPLACES the resting value —
   *    what a state change means ("be exactly this": `[fade]`, `[scale]`).
   *  - `offset`: every channel is a DELTA over the resting pose — what a transient
   *    gesture means (a rumble, a hop). It rides on top of wherever the object
   *    currently sits instead of yanking it into the effect's own coordinates, so
   *    shaking a panned camera no longer drops the pan for the duration. x/y add
   *    (mixed units compose through CSS `calc`), rotation adds, scale and opacity
   *    multiply — each channel composed by its own identity. */
  compose?: 'absolute' | 'offset'
}

/** Shape of a full-screen transition (`Renderer.transitionScreen`). */
export type TransitionShape = 'wipe' | 'circle' | 'blinds'
/** Direction a wipe's edge travels across the screen. Ignored by `circle` / `blinds`. */
export type TransitionDir = 'left' | 'right' | 'up' | 'down'
export interface TransitionOpts {
  shape?: TransitionShape
  dir?: TransitionDir
  color?: string
  /** A rule image URL (a luminance ramp): dark pixels change first. Replaces `shape`. */
  mask?: string
  /** Edge softness of a rule mask, 0..1 (default 0.1). */
  softness?: number
}

/** How the old picture gives way to the new one (`Renderer.endTransition`). */
export type TransitionKind = 'fade' | 'crossfade' | 'wipe' | 'slide' | 'circle' | 'blinds' | 'rule'
export interface SceneTransitionOpts {
  /** Seconds (default 0.6). */
  duration?: number
  /** `wipe` / `slide`: which way the edge (or the old picture) travels. */
  dir?: TransitionDir
  /** `fade`: the colour passed through (default `#000`). */
  color?: string
  /** A rule image URL (a luminance ramp): dark pixels change first. Kind `rule`
   *  needs one; any kind with a mask becomes a rule transition. */
  mask?: string
  /** Edge softness of a rule mask, 0..1 (default 0.1). */
  softness?: number
}

/** One layer of a layered character sprite as the renderer draws it. */
export interface CharLayer {
  name: string
  value: string
  url: string
  /** The unresolved path (saved instead of the URL). */
  ref?: string
  /** Where a cropped layer sits on the canvas, in canvas pixels. */
  offset?: [number, number]
}

/** A serializable picture of the visible stage, used by save/load.
 *
 *  NOTE: this still leaks DOM details (`bgCss` is an inline style string,
 *  `chars[].src` is an already-resolved URL). De-DOM-ifying it into a semantic
 *  `RendererState` is deferred until a non-DOM backend actually lands — it would
 *  change the on-disk save shape for no present gain. */
export interface StageState {
  /** Last background item's inline style (image or solid color). Legacy form —
   *  a resolved URL baked into CSS; kept so older saves load unchanged. */
  bgCss?: string
  /** The background image's unresolved ref. When present, a
   *  load re-resolves it through the engine and ignores `bgCss`. */
  bgRef?: string
  /** Visible characters. `y` is the slot placement (CSS `bottom` %, like `at` is
   *  `left` %); `scale` / `rotation` are resting-transform channels. `tx` / `ty`
   *  (the transform x/y px offsets), `opacity` and `visible` persist the resting
   *  end pose a recording event-frame commits (save model B,
   *) — all omitted at their identity so older saves and
   *  older loaders stay valid. */
  chars: {
    id: string
    /** The sprite ref when the character was shown from a script path (re-
     *  resolved on load), else the resolved URL (older saves, editor stages).
     *  Empty for a layered sprite (`layers` carries it). */
    src: string
    at: number
    face?: string
    /** Layered sprite: each layer's value (the engine rebuilds the images from
     *  the actor's layer templates on load). */
    layers?: Record<string, string>
    band?: ObjectBand
    y?: number
    scale?: number
    rotation?: number
    tx?: Length
    ty?: Length
    opacity?: number
    visible?: boolean
  }[]
  /** Sprite-frame objects on stage. Optional so older saves (and the blank-stage
   *  restore literal) stay valid; absent = no sprites. Mirrors `chars` in storing
   *  the spec needed to recreate the object plus its resting transform (placement
   *  `y`, `scale` / `rotation`, and the event-frame end pose `tx` / `ty` / `opacity`
   *  / `visible`), not its live mid-animation transform. `band` persists a
   *  promotion to the screen-space `front` band (absent = home `world`). */
  sprites?: {
    id: string
    url: string
    frames: number
    fps: number
    loop: boolean
    at: number
    height?: number
    /** Click commands (`[sprite … onclick=]`). */
    onclick?: string
    band?: ObjectBand
    y?: number
    scale?: number
    rotation?: number
    tx?: Length
    ty?: Length
    opacity?: number
    visible?: boolean
  }[]
  /** UI windows with a non-default pose or skin — today only the dialogue box,
   *  the built-in `window:dialog` singleton. Each
   *  channel is omitted at its identity and the whole field is omitted when every
   *  window is at rest, so pre-window saves and loaders stay byte-identical;
   *  restore always resets every window first (mirrors `camera`). */
  windows?: {
    /** Window instance id (`dialog` for the dialogue box). */
    id: string
    /** Pose offsets — a number is pixels, a `"12.5%"` string is a fraction of the
     *  window's own box (CSS translate semantics, like `camera.x`/`y`). */
    x?: Length
    y?: Length
    scale?: number
    rotation?: number
    opacity?: number
    visible?: boolean
    /** Resolved skin image URL replacing the default window chrome (v1:
     *  whole-image stretch). Absent = default gradient + border. */
    skin?: string
  }[]
  /** Clickable regions on stage (`[hotspot]`); absent = none. */
  hotspots?: HotspotSpec[]
  /** Camera resting transform (pan offsets in px, zoom factor, rotation in deg) —
   *  what event-frame camera tracks / `[scale target=screen]` settled on. Each
   *  channel (and the whole field) is omitted at identity, so older saves and
   *  older loaders stay valid; restore always resets the camera first. */
  camera?: {
    /** Pan offset. A number is pixels; a `"12.5%"` string is a fraction of the
     *  stage — how the editor authors a resolution-independent shot. */
    x?: Length
    y?: Length
    scale?: number
    rotation?: number
    /** Whole-screen dim / blackout ([fade|opacity target=screen]). */
    opacity?: number
    /** Whole-screen hide ([visibility target=screen]). */
    visible?: boolean
  }
  /** A full-screen cover held over the stage. `[transout]` / `[fadeout]` hand the
   *  screen to the fader and it stays there until a reveal — through dialogue and
   *  through the scene change that usually sits between the two — so it is part of
   *  the visible stage a save has to carry. Omitted when the screen is clear, which
   *  keeps older saves valid (they load onto a clear screen, as they always did). */
  cover?: {
    /** The colour being held, as CSS. */
    color: string
    /** How opaque it is held at (1 = fully covered). */
    opacity: number
  }
  name?: string
  /** The speaker's name-tag background (the actor's `color`); absent = the theme default. */
  nameColor?: string
  /** The speaker's name-tag text colour (the actor's `textColor`); absent = the theme default. */
  nameTextColor?: string
  /** Theme tokens the script set with `[theme …]` (the SCRIPT layer only — the
   *  host / config base layer is not part of a save). Absent = none. */
  theme?: Record<string, string>
  /** Current dialogue text (plain; inline effects are not preserved). */
  text: string
  /** Whether the dialogue box is visible. */
  dialog: boolean
}

/** A button on a chrome screen. */
export interface ScreenButton {
  id: string
  label: string
  /** Focused first / styled as the default choice. */
  primary?: boolean
  onSelect(): void
}

/** What a full-stage chrome screen shows — built by the engine (chrome.ts),
 *  drawn by the renderer. Every field optional but `buttons`. */
export interface ScreenModel {
  heading?: string
  subtitle?: string
  /** An image URL shown above the heading. */
  logo?: string
  /** Its CSS width (the renderer's default caps it at 70% of the stage). */
  logoWidth?: string
  /** A CSS background (colour, gradient or `url(…)`); the stage shows through when absent. */
  background?: string
  layout?: 'center' | 'left' | 'right' | 'bottom'
  buttons: ScreenButton[]
  /** Rolling credits, one entry per line; empty entries are blank lines. */
  credits?: string[]
  /** How long the roll takes (seconds). */
  creditsDuration?: number
  /** The roll finished. */
  onCreditsEnd?(): void
  /** A small label in a corner (the tool version on the title page). */
  version?: string
  /** The ending's id (an ending screen). */
  endingId?: string
  /** A progress bar (0..1) — the loading page; `setProgress` moves it. */
  progress?: number
}

/** A chrome screen id: the built-in ones, or a plugin's (`ui.screen`). */
export type ScreenId = 'title' | 'ending' | 'loading' | 'menu' | 'settings' | 'saves' | 'backlog' | (string & {})

/** The screen layer over the stage: full-stage chrome the engine's session
 *  state machine shows and hides (a title page, an ending page, the menus).
 *  One screen at a time. Batch G inc 2 defines the seam; the DOM screens land
 *  in inc 3 / 4 — until then the DOM renderer only records the current id. */
export interface ChromeRenderer {
  /** Show `id` (replacing whatever screen is up) drawn from `model`. */
  showScreen(id: ScreenId, model: ScreenModel): void
  /** Hide `id`, or whatever is up when omitted. */
  hideScreen(id?: ScreenId): void
  /** The screen up now, or null. */
  currentScreen(): ScreenId | null
  /** Move the current screen's progress bar (0..1); a no-op without one. */
  setProgress(ratio: number): void
  /** A host container in the chrome layer for the engine's own DOM chrome (the
   *  system menu and its panels — like a plugin's `ui.layer`, above the pages).
   *  Removed by `destroy()`. */
  overlay(className: string): HTMLElement
  /** An in-engine confirm box (never the browser's): resolves true on OK. No
   *  `cancel` label = an alert with a single OK. */
  confirm(message: string, labels: { ok: string; cancel?: string }): Promise<boolean>
  /** An in-engine one-line text box (the `[input]` command). `result` is the
   *  trimmed text on OK, `null` on cancel or `cancel()`; the field is empty and
   *  shows `default` as its placeholder. */
  prompt(message: string, opts: PromptOptions): PromptHandle
  /** A transient message over the stage. */
  toast(message: string): void
}

export interface PromptOptions {
  ok: string
  cancel: string
  /** Placeholder (the value the caller falls back to). */
  default?: string
  maxlength?: number
  /** A regular expression source the whole value must match for OK to enable. */
  pattern?: string
  position?: 'center' | 'top' | 'bottom'
}

export interface PromptHandle {
  result: Promise<string | null>
  /** Dismiss the box as a cancel (a load / restart during the prompt). */
  cancel(): void
}

/**
 * The render backend. The engine constructs one (DOM by default) and exposes it
 * to commands as `CommandContext.stage`, so plugins can only ever call these
 * semantic methods — never reach into the DOM.
 */
/** How the renderer types one dialogue line (`Renderer.typeLine`). The engine
 *  owns pacing policy (speed, skip, session guards) and per-character side
 *  effects (text effects, reveal hooks); the renderer owns the DOM. */
export interface TypeLineOptions {
  /** Characters per second, read per character so a live speed change (the
   *  in-game menu) applies mid-line; 0 = reveal instantly. */
  cps(): number
  /** Polled between characters: true = reveal the rest at once (the player tapped). */
  skip(): boolean
  /** Polled between characters: false = abort (the play session moved on). */
  alive(): boolean
  /** Called as each character is revealed, with the inline effect name it carries. */
  onReveal?(span: TextSpan, effect: string | undefined): void
  /** Called at a page break — a `{p}`, or the text overflowing the box in
   *  `page` mode — with the page fully revealed; resolve to go on (the box
   *  clears and the next page types). */
  onPage?(): Promise<void>
}

/** One option of a choices prompt as the renderer draws it. */
export interface ChoiceView {
  segments: Segment[]
  /** Drawn greyed and not pickable (`[choice … disabled=cond]`). */
  disabled?: boolean
  /** Drawn as taken in an earlier run (`[choices] chosenStyle`). */
  chosen?: boolean
}

export interface ChoicesPromptOptions {
  /** Seconds until the prompt picks `timeoutIndex` by itself (a bar shows the time left). */
  timer?: number
  /** The option a timeout picks (0-based); the first enabled one when absent, disabled or out of range. */
  timeoutIndex?: number
}

/** How the choices overlay lays its buttons out (`[choices]` section). */
export interface ChoicesLayout {
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  layout?: 'column' | 'grid'
  columns?: number
}

/** What a line does when it does not fit the dialogue box. */
export type OverflowMode = 'grow' | 'page' | 'shrink'

/** A choice button as plugins see it (`EngineHooks.onChoices`): enough to style
 *  and stagger an entrance, never the element (the same
 *  sealing as `TextSpan`). */
export interface ChoiceHandle {
  /** Zero-based index among the VISIBLE choices (conditions already applied). */
  readonly index: number
  /** Apply a CSS class declared in the plugin's `styles`. */
  addClass(name: string): void
  /** Set a CSS custom property (e.g. an animation delay) on the button. */
  setVar(name: string, value: string): void
}

/** A live choices prompt (`Renderer.showChoices`): the handles for plugins, the
 *  pick (or null once cancelled), and the two ways the engine drives it. */
export interface ChoicePrompt {
  readonly handles: ChoiceHandle[]
  /** Resolves with the chosen index, or null after `cancel()` (a load / restart
   *  unwound the prompt). */
  readonly chosen: Promise<number | null>
  /** Unblock a pending prompt with null; the buttons stay until `hideChoices`
   *  or a `restore` clears them. */
  cancel(): void
  /** Re-render one button's label (an in-place language switch). */
  relabel(index: number, segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): void
}

export interface Renderer {
  /** Stage root: the always-DOM input/overlay host. Even a WebGL backend keeps a
   *  DOM root for the dialogue layer and click handling (hybrid model). */
  readonly root: HTMLElement

  // ---- background ----
  setBackground(opts: { url?: string; color?: string; ref?: string }, fadeSec?: number): Promise<void>

  // ---- characters ----
  showChar(id: string, url: string, opts?: CharOptions): Promise<void>
  /** Slide a character to a new stage slot (its absolute position, not the
   *  transform `x` offset). Positioning, not an FX verb — stays a primitive. */
  moveChar(id: string, at: StagePos, timeSec?: number): Promise<void>
  hideChar(id: string, fadeSec?: number): Promise<void>
  clearChars(fadeSec?: number): Promise<void>
  hasChar(id: string): boolean
  charFace(id: string): string | undefined
  focusChar(speaker: string | null): void

  // ---- sprite-frame objects ----
  /** Create (or replace) an addressable sprite-frame object `sprite:<id>` and start
   *  its frame loop. The renderer owns the frame-stepping primitive; the `sprite`
   *  kind / `[sprite]` command are contributed by the `spriteanim` plugin. */
  showSprite(id: string, spec: SpriteSpec, fadeSec?: number): Promise<void>
  /** Remove a sprite-frame object (fading out), if present. */
  hideSprite(id: string, fadeSec?: number): Promise<void>
  /** Remove every sprite-frame object at once — the editor's at-rest re-render
   *  clears then re-shows them from the fold snapshot (4c-4). */
  clearSprites(fadeSec?: number): Promise<void>

  // ---- generic object transform surface ----
  // Effects address objects by id (`character:<id>`, `camera`, `screen`) and only
  // ever read/write the fixed transform schema through these — never the DOM.

  /** Whether an addressable stage object currently exists. */
  hasObject(objId: string): boolean
  /** Read an object's resting transform prop (not its mid-animation value);
   *  undefined when the object is absent or the prop is off its kind's schema. */
  getProp(objId: string, prop: TransformProp): TransformValue | undefined
  /** Set a transform prop, applied immediately. No-op when the object is absent. */
  setProp(objId: string, prop: TransformProp, value: TransformValue): void
  /** Animate an object's transform through keyframes (WAAPI), resolving on finish.
   *  Frames compose over the object's base anchor; the element returns to its
   *  resting model afterwards (fill: none). Keyframes may carry per-frame `offset`
   *  (non-uniform timing) and `easing` (per-segment), used by recorded animations.
   *  No-op when the object is absent. */
  animate(objId: string, keyframes: AnimFrame[], opts: AnimOpts): Promise<void>

  // ---- fixed z-bands ----
  /** The object's current band, or undefined for non-bandable objects
   *  (camera / screen) and absent objects. */
  getBand(objId: string): ObjectBand | undefined
  /** Move an object to a band (see `ObjectBand`). `front` lifts it out of world
   *  space (over the dialogue, no longer camera-shaken); `world` returns it to its
   *  kind's home band. No-op for non-bandable / absent objects. */
  setBand(objId: string, band: ObjectBand): void

  // ---- character face (a discrete recordable channel —) ----
  /** The object's current face name, or undefined for faceless kinds / absent
   *  objects. Generalizes `charFace` to the objId-keyed object surface so the `face`
   *  recordable channel reads it through the scoped handle. */
  getFace(objId: string): string | undefined
  /** Swap a character's face (instant — discrete channels snap). Recomputes the
   *  sprite URL via the `faceUrl` resolver stored at `showChar` and records the new
   *  name. No-op for faceless kinds, absent objects, or a character with no resolver
   *  (raw `src=`), in which case the name is recorded but the art can't change. */
  setFace(objId: string, face: string): void

  // ---- chrome screens (title / ending / menus — batch G) ----
  /** The screen layer. A stub in the DOM renderer until the screens land; the
   *  engine drives it from the session state machine (`showTitle`, `finish`). */
  readonly chrome: ChromeRenderer

  // ---- theme (the `--nilvn-*` token contract, see theme.ts) ----
  /** Replace the BASE layer (host / config). Unknown tokens are painted as given. */
  setThemeBase(tokens: Record<string, string>): void
  /** Merge into the SCRIPT layer (`[theme …]`); `null` clears it. A `''` /
   *  undefined value removes that token from the layer. */
  setTheme(patch: Record<string, string | undefined> | null): void
  /** The effective overrides (base then script) — NOT the defaults, which live in
   *  the stylesheet; `THEME_TOKENS` has those. */
  getTheme(): Readonly<Record<string, string>>

  // ---- dialogue UI (always DOM; shared across backends) ----
  /** `color` = the name-tag background, `textColor` = its text; either absent
   *  falls back to the theme (`name-bg` / `name-color`). */
  setName(name?: string, color?: string, textColor?: string): void
  showDialog(show: boolean): void
  showIndicator(on: boolean): void
  /** Type a dialogue line into the text box (typewriter); resolves when every
   *  character is revealed or the line was aborted (`alive()` false). */
  /** Resolves true when a repaint while parked at a page (`repaintLine`) left
   *  nothing after that page, so the tap that turned it ended the line. */
  typeLine(segments: Segment[], opts: TypeLineOptions): Promise<boolean>
  /** Re-render the line the player is parked INSIDE (at a `{p}` page break)
   *  after a language switch; false when no line is parked mid-way. */
  repaintLine(segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): boolean
  /** Replace the text box contents, fully revealed (a language switch repaints
   *  the parked line this way). */
  setLine(segments: Segment[], onSpan?: (span: TextSpan, effect: string | undefined) => void): void
  /** Show a choices prompt over the stage. One button per item; `onSpan` runs
   *  per rendered label character (inline text effects). */
  showChoices(items: ChoiceView[], onSpan?: (span: TextSpan, effect: string | undefined) => void, opts?: ChoicesPromptOptions): ChoicePrompt
  /** Remove the choices prompt (after a pick). */
  hideChoices(): void
  /** What a line does when it does not fit the box (`[window] overflow`). */
  setOverflow(mode: OverflowMode): void
  /** Where and how the choices prompt lays out (`[choices]` section). */
  setChoicesLayout(layout: ChoicesLayout): void
  /** Reskin a UI window (`window:dialog`): `url` replaces the default chrome with
   *  the image (v1: whole-image stretch — `background-size:100% 100%`; nine-slice
   *  `border-image` is a reserved extension), undefined restores the default.
   *  No-op for unknown window ids. Backs the built-in `[window skin=…]` command. */
  setWindowSkin(objId: string, url: string | undefined, ref?: string): void

  // ---- full-screen transitions ----
  fadeScreen(to: number, sec: number, color?: string): Promise<void>
  /** Shaped full-screen transition: cover (`to` = 1) or reveal (`to` = 0) the screen
   *  with an animated wipe / circle iris / blinds. A cover hands off to the same
   *  fader `fadeScreen` drives (so `[fadein]` / a reveal / the restore reset all
   *  clear it); a reveal drops the fader first and plays the shape backwards. Backs
   *  the `transout` / `transin` effects on the `screen` kind. */
  transitionScreen(to: 0 | 1, sec: number, opts?: TransitionOpts): Promise<void>
  /** Freeze the current picture in a snapshot layer over the scene; change the
   *  scene underneath, then `endTransition` reveals it. A second call replaces
   *  the snapshot. */
  beginTransition(): void
  /** Reveal the scene under the snapshot `beginTransition` took, with `kind`;
   *  resolves when the old picture is gone. A no-op without a snapshot. */
  endTransition(kind: TransitionKind, opts?: SceneTransitionOpts): Promise<void>
  /** Whether a snapshot is up (a transition is armed). */
  transitionPending(): boolean
  /** A layered character's current layer values, or undefined. */
  charLayers(id: string): Record<string, string> | undefined
  /** Put a clickable region on the stage (replacing one with the same id). */
  showHotspot(spec: HotspotSpec): void
  hideHotspot(id: string): void
  clearHotspots(): void
  /** What a click on a clickable object does: the engine sets this to run the
   *  object's `onclick` commands. `objId` is `hotspot:<id>` or `sprite:<id>`. */
  objectClick?: (objId: string, onclick: string) => void

  // ---- screen primitive ----
  /** Full-screen color flash that fades out. A transient overlay (not a transform
   *  on a persistent object), so it stays a renderer primitive — it backs the
   *  built-in `flash` effect on the `screen` kind. */
  flash(color: string, durationSec: number): Promise<void>

  // ---- save / load ----
  snapshot(): StageState
  /** Repaint the stage from a snapshot. `faceUrl`, when given, lets a restored
   *  character resolve a *later* `face` channel change to a sprite URL (built by the
   *  caller from the actor's `{face}` template + its own resolve) — without it, a face
   *  keyframe played after a load would update the name but not swap the art. */
  restore(
    state: StageState,
    faceUrl?: (charId: string, face: string) => string | undefined,
    /** Turns a saved ref (or an already-resolved URL, unchanged) into a URL. */
    resolveUrl?: (src: string) => string,
  ): Promise<void>

  // ---- lifecycle ----
  destroy(): void
}
