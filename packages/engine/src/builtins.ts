import { evalExpr, truthy } from './expr.js'
import type { BuiltinContext, CommandContext } from './types.js'
import type { SceneTransitionOpts, TransitionKind } from './renderer/types.js'

/** A built-in command: engine code, so it runs with the engine in hand. */
export type BuiltinFn = (ctx: BuiltinContext) => void | Promise<void>

const TRANSITION_KINDS: readonly TransitionKind[] = ['fade', 'crossfade', 'wipe', 'slide', 'circle', 'blinds', 'rule']
function transitionKind(name: string): TransitionKind {
  if ((TRANSITION_KINDS as readonly string[]).includes(name)) return name as TransitionKind
  throw new Error(`unknown transition "${name}" (fade, crossfade, wipe, slide, circle, blinds, rule)`)
}
/** The `[trans …]` / `trans=` parameters: `duration` (also the second positional), `dir`, `color`, `mask`, `softness`. */
function transitionOpts(ctx: CommandContext): SceneTransitionOpts {
  const mask = ctx.str('mask')
  const dir = ctx.str('dir')
  return {
    duration: optNum(ctx, 'duration') ?? (ctx.name === 'trans' ? ctx.numOpt(1) : undefined),
    dir: dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down' ? dir : undefined,
    color: ctx.str('color'),
    mask: mask ? ctx.resolve(mask) : undefined,
    softness: optNum(ctx, 'softness'),
  }
}

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

  // [bg assets/bg/street.svg fade=1.5] or [bg color=#102030 fade=1];
  // `trans=wipe dir=left duration=0.6` swaps through a scene transition instead.
  async bg(ctx) {
    const first = ctx.str(0)
    const color = ctx.str('color') ?? (first?.startsWith('#') ? first : undefined)
    const trans = ctx.str('trans')
    if (!color && !first) throw new Error('[bg] needs an image path or color=')
    if (trans) {
      ctx.engine.armTransition(transitionKind(trans), transitionOpts(ctx))
      if (color) await ctx.engine.stage.setBackground({ color }, 0)
      else await ctx.engine.stage.setBackground({ url: ctx.resolve(first!), ref: first }, 0)
      await ctx.engine.commitTransition()
      return
    }
    const fade = ctx.num('fade', 0)
    if (color) await ctx.engine.stage.setBackground({ color }, fade)
    else await ctx.engine.stage.setBackground({ url: ctx.resolve(first!), ref: first }, fade)
  },

  // [trans wipe dir=left duration=0.6] — freeze the picture; the scene changes
  // that follow happen underneath and the next line (or [trans end]) reveals
  // them with the effect. Kinds: fade (through `color`), crossfade, wipe, slide,
  // circle, blinds, rule (`mask=@fx/rule.png`, `softness=0.1`).
  async trans(ctx) {
    const kind = ctx.str(0)
    if (kind === 'end') {
      await ctx.engine.commitTransition()
      return
    }
    if (!kind) throw new Error('[trans] syntax: [trans fade|crossfade|wipe|slide|circle|blinds|rule …] / [trans end]')
    ctx.engine.armTransition(transitionKind(kind), transitionOpts(ctx))
  },

  // [char yuki happy at=left fade=0.5] — face/at optional once shown. A layered
  // actor also takes its layers by name: [char yuki body=casual extra=blush].
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
      layers: ctx.params,
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

  // [call label] — jump there and come back at the next [return].
  async call(ctx) {
    const label = ctx.str(0)
    if (!label) throw new Error('[call] needs a label')
    await ctx.engine.call(label)
  },

  // [return] — back to the line after the last [call].
  async return(ctx) {
    await ctx.engine.returnFromCall()
  },

  // [include path] — spliced in when a script FILE loads (load / loadScript /
  // [game] entry / scripts); reaching one at run time means the text came in
  // through loadSource(), which cannot fetch.
  include(ctx) {
    ctx.engine.report({ phase: 'exec', message: `[include ${ctx.str(0) ?? ''}] is resolved when a script file loads — text given to loadSource() cannot include files`, line: undefined }, true)
  },

  // [preload @bg/night.png @se/thunder.wav wait=true] — warm assets ahead of a
  // heavy scene; `wait=true` blocks on the loading page until they are in.
  async preload(ctx) {
    if (!ctx.args.length) throw new Error('[preload] needs at least one asset')
    const p = ctx.engine.preload(ctx.args, { screen: ctx.str('wait') === 'true' })
    if (ctx.str('wait') === 'true') await p
    else void p
  },

  // [ui show status] / [ui hide status] / [ui toggle status] — a [ui.<id>] panel.
  ui(ctx) {
    const op = ctx.str(0)
    const id = ctx.str(1)
    if (!id || (op !== 'show' && op !== 'hide' && op !== 'toggle')) throw new Error('[ui] syntax: [ui show|hide|toggle <panel id>]')
    ctx.engine.ui[op](id)
  },

  // [choices timer=8 default=2] — the next prompt's timer (seconds, 0 = none) and
  // 1-based default, overriding the [choices] config for that prompt only.
  choices(ctx) {
    const timer = ctx.numOpt('timer')
    const timerDefault = ctx.numOpt('default')
    if (timer === undefined && timerDefault === undefined) throw new Error('[choices] syntax: [choices timer=seconds default=n]')
    ctx.engine.setNextChoices({ timer, timerDefault })
  },

  // [hotspot shop x=10 y=20 w=25 h=30 onclick="jump shop" if=day > 1] — a clickable
  // region (percent of the stage) that runs script commands; [hotspot remove shop],
  // [hotspot clear].
  hotspot(ctx) {
    const first = ctx.str(0)
    if (first === 'clear') {
      ctx.engine.stage.clearHotspots()
      return
    }
    if (first === 'remove') {
      const id = ctx.str(1)
      if (!id) throw new Error('[hotspot remove] needs an id')
      ctx.engine.stage.hideHotspot(id)
      return
    }
    const onclick = ctx.str('onclick')
    if (!first || !onclick) throw new Error('[hotspot] syntax: [hotspot <id> x= y= w= h= onclick="…" if=cond]')
    // `if=` runs to the end of the tag (spaces allowed), as a [choice]'s does.
    const cond = tailCondition(ctx.raw)
    if (cond && !truthy(evalExpr(cond, ctx.engine.scope()))) {
      ctx.engine.stage.hideHotspot(first)
      return
    }
    ctx.engine.stage.showHotspot({ id: first, x: ctx.num('x', 0), y: ctx.num('y', 0), w: ctx.num('w', 10), h: ctx.num('h', 10), onclick })
  },

  // [if affection >= 1 -> good_end]
  async if(ctx) {
    const m = /^if\s+(.+?)\s*->\s*(\S+)\s*$/.exec(ctx.raw)
    if (!m) throw new Error('[if] syntax: [if condition -> label]')
    if (truthy(evalExpr(m[1]!, ctx.engine.scope()))) await ctx.engine.jump(m[2]!)
  },

  // [set affection = affection + 1] (the "=" is optional)
  set(ctx) {
    const m = /^set\s+(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(ctx.raw)
    if (!m) throw new Error('[set] syntax: [set var expression]')
    ctx.engine.setVar(m[1]!, evalExpr(m[2]!, ctx.engine.scope()))
  },

  // [persist player = "" runs = 0 seen_intro = false] — declare persistent
  // variables: the store's value wins, the literal seeds the first run (a bare
  // name defaults to ""). Same as a `[persist]` config section.
  persist(ctx) {
    const body = ctx.raw.replace(/^persist\s*/, '')
    const re = /([A-Za-z_$\u0080-\uffff][\w$.\u0080-\uffff]*)(?:\s*=\s*("[^"]*"|'[^']*'|\S+))?/g
    let n = 0
    for (let m = re.exec(body); m; m = re.exec(body)) {
      n++
      ctx.engine.declarePersist(m[1]!, m[2] === undefined ? '' : evalExpr(m[2], {}))
    }
    if (!n) throw new Error('[persist] syntax: [persist name = default …]')
  },

  // [input player prompt=@ui.askName default=Traveler maxlength=12 pattern=\S+ persist=true]
  // — ask the player for a string and write it to `player`.
  async input(ctx) {
    const name = ctx.str(0) ?? ctx.str('var')
    if (!name) throw new Error('[input] syntax: [input var prompt= default= maxlength= pattern= persist=true]')
    await ctx.engine.promptInput(name, {
      prompt: ctx.str('prompt'),
      default: ctx.str('default'),
      maxlength: ctx.numOpt('maxlength'),
      pattern: ctx.str('pattern'),
      persist: ctx.str('persist') === 'true',
    })
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

/** The `if=` a tag ends with, unquoted — everything after `if=` to the tag's end. */
function tailCondition(raw: string): string | undefined {
  const m = /(?:^|\s)if=([\s\S]*)$/.exec(raw)
  if (!m) return undefined
  const v = m[1]!.trim()
  return v.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1')
}
