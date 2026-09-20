import { evalExpr, truthy } from './expr.js'
import type { BuiltinContext, CommandContext } from './types.js'

/** A built-in command: engine code, so it runs with the engine in hand. */
export type BuiltinFn = (ctx: BuiltinContext) => void | Promise<void>

/** Read an optional numeric param: undefined when absent (unlike `ctx.num`, which
 *  substitutes a default). Used for birth-transform params (`y` / `scale` /
 *  `rotation`) so a command that omits one never resets a value an effect changed. */
export function optNum(ctx: CommandContext, key: string): number | undefined {
  const v = ctx.str(key)
  if (v === undefined) return undefined
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

// Built-in script commands. Everything fancier (shake, text effects, ...)
// lives in plugins so the core stays small.
export const builtins: Record<string, BuiltinFn> = {
  // [use screenfx textfx ./plugins/custom.js]
  async use(ctx) {
    await ctx.engine.usePlugins(ctx.args)
  },

  // [alias @bg assets/bg] — path prefix alias, also configurable via EngineOptions
  alias({ engine, args }) {
    const [key, value] = args
    if (!key || !value) throw new Error('[alias] syntax: [alias @name path]')
    engine.alias[key] = value
  },

  // [actor yuki name=Yuki color=#ff7eb6 textColor=#fff sprites=@char/yuki-{face}.svg face=happy]
  // `color` is the name-tag BACKGROUND, `textColor` its text (theme defaults when absent).
  actor({ engine, args, params }) {
    const id = args[0]
    if (!id) throw new Error('[actor] needs an id: [actor yuki name=Yuki ...]')
    const prev = engine.actors[id] ?? {}
    // Anything beyond the engine's own fields (face → defaultFace) is a plugin's
    // actor field ([actor yuki voice=360]); normalizeActors files it under ext.
    const extras: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) if (!['name', 'color', 'textColor', 'sprites', 'face'].includes(k)) extras[k] = v
    engine.actors[id] = {
      ...prev,
      ...extras,
      name: params.name ?? prev.name ?? id,
      color: params.color ?? prev.color,
      textColor: params.textColor ?? prev.textColor,
      sprites: params.sprites ?? prev.sprites,
      defaultFace: params.face ?? prev.defaultFace,
    }
    engine.normalizeActors()
  },

  // [theme name-bg=#0b1c2e text-size=4cqh] — override theme tokens for the rest
  // of the scene (the SCRIPT layer: saved with the stage, reset by a restart);
  // [theme reset] clears it. Token names are the `--nilvn-<token>` contract.
  theme({ engine, args, params }) {
    if (args[0] === 'reset') engine.setScriptTheme(null)
    else engine.setScriptTheme(params)
  },

  // [bg assets/bg/street.svg fade=1.5] or [bg color=#102030 fade=1]
  async bg(ctx) {
    const fade = ctx.num('fade', 0)
    const first = ctx.str(0)
    const color = ctx.str('color') ?? (first?.startsWith('#') ? first : undefined)
    if (color) await ctx.engine.stage.setBackground({ color }, fade)
    else if (first) await ctx.engine.stage.setBackground({ url: ctx.resolve(first), ref: first }, fade)
    else throw new Error('[bg] needs an image path or color=')
  },

  // [char yuki happy at=left fade=0.5] — face/at optional once shown
  async char(ctx) {
    const id = ctx.str(0)
    if (!id) throw new Error('[char] needs a character id')
    await ctx.engine.showActor(id, ctx.str(1), {
      at: ctx.str('at'),
      fade: ctx.num('fade', 0.3),
      src: ctx.str('src'),
      y: optNum(ctx, 'y'),
      scale: optNum(ctx, 'scale'),
      rotation: optNum(ctx, 'rotation'),
    })
  },

  // [hide yuki fade=0.3]
  async hide(ctx) {
    const id = ctx.str(0)
    if (id) await ctx.engine.stage.hideChar(id, ctx.num('fade', 0.3))
  },

  // [clear fade=0.3] — hide all characters
  async clear(ctx) {
    await ctx.engine.stage.clearChars(ctx.num('fade', 0.3))
  },

  // [wait 1.5]
  async wait(ctx) {
    await ctx.wait(ctx.num(0, ctx.num('duration', 0.5)))
  },

  // [anim] / [eventframe] / [loopstart] / [loopstop] (keyframe animation
  // authoring) live in the animstudio plugin.

  // [jump label]
  async jump(ctx) {
    const label = ctx.str(0)
    if (!label) throw new Error('[jump] needs a label')
    await ctx.engine.jump(label)
  },

  // [if affection >= 1 -> good_end]
  async if(ctx) {
    const m = /^if\s+(.+?)\s*->\s*(\S+)\s*$/.exec(ctx.raw)
    if (!m) throw new Error('[if] syntax: [if condition -> label]')
    if (truthy(evalExpr(m[1]!, ctx.engine.vars))) await ctx.engine.jump(m[2]!)
  },

  // [set affection = affection + 1] (the "=" is optional)
  set(ctx) {
    const m = /^set\s+(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(ctx.raw)
    if (!m) throw new Error('[set] syntax: [set var expression]')
    ctx.engine.setVar(m[1]!, evalExpr(m[2]!, ctx.engine.vars))
  },

  // [fadeout 1.2 color=#fff] / [fadein 1.2] — duration= also works (for [defaults])
  async fadeout(ctx) {
    await ctx.engine.stage.fadeScreen(1, ctx.num(0, ctx.num('duration', 0.6)), ctx.str('color', '#000'))
  },
  async fadein(ctx) {
    await ctx.engine.stage.fadeScreen(0, ctx.num(0, ctx.num('duration', 0.6)))
  },

  // [dialog hide] / [dialog show] — for full-screen cutscene moments
  dialog(ctx) {
    ctx.engine.stage.showDialog(ctx.str(0) !== 'hide')
  },

  // [window skin=@ui/box.png target=dialog] — reskin a UI window (v1: whole-image
  // stretch over the default chrome); skin=none restores the default. `target`
  // names the window instance; today only the dialogue box (`dialog`) exists.
  window(ctx) {
    const skin = ctx.str('skin')
    if (skin === undefined) return
    const objId = `window:${ctx.str('target', 'dialog')}`
    if (skin === 'none') ctx.engine.stage.setWindowSkin(objId, undefined)
    else ctx.engine.stage.setWindowSkin(objId, ctx.resolve(skin), skin)
  },

  // [textspeed 60] — characters per second; 0 = instant
  textspeed(ctx) {
    ctx.engine.textSpeed = ctx.num(0, 40)
  },

  // [bgm assets/bgm/theme.mp3 loop=true volume=0.8 track=music fade=0]
  // `track` names the loop channel (multi-track model): the default 'music' is
  // the classic BGM slot; any other name is an ambience bed layered alongside —
  // [bgm rain.mp3 track=rain] plays UNDER the music instead of replacing it.
  // `fade` > 0 ramps the new track in from silence.
  bgm(ctx) {
    const src = ctx.str(0)
    if (!src) throw new Error('[bgm] needs an audio path')
    ctx.engine.playTrack(ctx.str('track', 'music'), ctx.resolve(src), {
      loop: ctx.str('loop') !== 'false',
      volume: ctx.num('volume', 1),
      fade: ctx.num('fade', 0),
    })
  },

  // [stopbgm fade=1 track=music] — `track=all` stops every loop track at once.
  stopbgm(ctx) {
    const track = ctx.str('track', 'music')
    if (track === 'all') ctx.engine.stopAllTracks(ctx.num('fade', 0))
    else ctx.engine.stopTrack(track, ctx.num('fade', 0))
  },

  // [se assets/se/door.mp3 volume=0.6]
  se(ctx) {
    const src = ctx.str(0)
    if (!src) throw new Error('[se] needs an audio path')
    ctx.engine.playSe(ctx.resolve(src), ctx.num('volume', 1))
  },

  // [voice voice/yuki_intro_n3.webm offset=0.3] — per-line voice queued for the
  // very next dialogue: the engine plays it (seeking past `offset` seconds of
  // leading silence) alongside the line, and mutes the synth typing blip.
  voice(ctx) {
    const src = ctx.str(0)
    if (!src) return
    // Pass the raw ref; the engine resolves it at play time and re-resolves it by
    // ref for backlog replay (a resolved URL can go stale when its chunk releases).
    ctx.engine.setPendingVoice(src, ctx.num('offset', 0))
  },

  // [replaydef] / [replayend] (A–B replay segments) live in the abreplay plugin.

  // [end 1.5] — fade to black and finish
  async end(ctx) {
    await ctx.engine.stage.fadeScreen(1, ctx.num(0, ctx.num('duration', 1)))
    ctx.engine.finish()
  },

  // [ending true_end sec=1] — fade to black and finish INTO a named ending (the
  // ending screen for `id`; `default` when omitted). `[end]` = `[ending default]`.
  async ending(ctx) {
    const id = ctx.str(0) ?? ctx.str('id') ?? 'default'
    await ctx.engine.stage.fadeScreen(1, ctx.num('sec', ctx.num('duration', 1)))
    ctx.engine.finish(id)
  },

  // [title] — stop and go back to the title screen (a fresh game from there).
  async title(ctx) {
    await ctx.engine.showTitle()
  },
}
