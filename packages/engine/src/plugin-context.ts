// Capability objects: what a
// plugin receives INSTEAD of the engine. Each object is a thin, permission-gated
// facade over the engine's public API; a permission the host did not grant leaves
// its object undefined, and within the stage object the write verbs degrade to
// stubs when only `stage.read` was granted. Every subscription / listener / timer
// / DOM node minted here is recorded on the plugin's disposer list, so the host
// can release all of it deterministically on deactivate (the hot-plug guarantee).

import type { Engine } from './engine.js'
import { uiLangName } from './i18n.js'
import type {
  AudioCap,
  BacklogCap,
  EffectParams,
  Permission,
  PluginContext,
  ReplayCap,
  SavesCap,
  SettingsCap,
  StageCap,
  TimerCap,
  UiCap,
  VarsCap,
  VolumeChannel,
} from './types.js'

const VOLUME_FIELD: Record<VolumeChannel, 'bgmVolume' | 'ambienceVolume' | 'seVolume' | 'voiceVolume'> = {
  bgm: 'bgmVolume',
  ambience: 'ambienceVolume',
  se: 'seVolume',
  voice: 'voiceVolume',
}

/** What the capability factories need from the host record. */
export interface CapHost {
  readonly id: string
  readonly granted: ReadonlySet<string>
  /** Record a disposer to run on deactivate. */
  dispose(fn: () => void): void
  /** Attribute a problem to this plugin (once per message). */
  warn(message: string): void
}

type StageReadVerb = 'hasObject' | 'getProp' | 'getBand' | 'getFace' | 'hasChar' | 'charFace' | 'snapshot'
const STAGE_READ: readonly StageReadVerb[] = ['hasObject', 'getProp', 'getBand', 'getFace', 'hasChar', 'charFace', 'snapshot']
type StageWriteVerb =
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
const STAGE_WRITE: readonly StageWriteVerb[] = [
  'setBackground',
  'showChar',
  'moveChar',
  'hideChar',
  'clearChars',
  'focusChar',
  'showSprite',
  'hideSprite',
  'clearSprites',
  'setProp',
  'animate',
  'setBand',
  'setFace',
  'setName',
  'showDialog',
  'showIndicator',
  'setWindowSkin',
  'fadeScreen',
  'transitionScreen',
  'flash',
]
/** Engine-level choreography verbs that ride on `stage.write`. */
const ENGINE_WRITE = ['applyEffect', 'showActor', 'playFrames', 'stopFrames', 'startLoop', 'stopLoop', 'runningLoops'] as const

/** `stage.read` / `stage.write`. */
export function makeStageCap(engine: Engine, host: CapHost): StageCap | undefined {
  const write = host.granted.has('stage.write')
  if (!write && !host.granted.has('stage.read')) return undefined
  const stage = engine.stage
  const cap: Record<string, unknown> = {}
  for (const v of STAGE_READ) cap[v] = (stage[v] as (...a: unknown[]) => unknown).bind(stage)
  const stub = (verb: string) => (): Promise<void> => {
    host.warn(`stage.${verb} ignored — "stage.write" was not granted`)
    return Promise.resolve()
  }
  for (const v of STAGE_WRITE) cap[v] = write ? (stage[v] as (...a: unknown[]) => unknown).bind(stage) : stub(v)
  for (const v of ENGINE_WRITE) {
    cap[v] = write
      ? v === 'applyEffect'
        ? (name: string, objId: string, params: EffectParams) => engine.applyEffect(name, objId, params)
        : (engine[v] as (...a: unknown[]) => unknown).bind(engine)
      : stub(v)
  }
  return cap as unknown as StageCap
}

/** `audio.play`. */
export function makeAudioCap(engine: Engine, host: CapHost): AudioCap | undefined {
  if (!host.granted.has('audio.play')) return undefined
  return {
    playTrack: (track, url, opts) => engine.playTrack(track, url, opts),
    stopTrack: (track, fade) => engine.stopTrack(track, fade),
    stopAllTracks: (fade) => engine.stopAllTracks(fade),
    playSe: (url, volume) => engine.playSe(url, volume),
    volume: (channel) => engine[VOLUME_FIELD[channel]],
    get voicePlaying() {
      return engine.voicePlaying
    },
  }
}

/** `vars.read` (+ `vars.write`). */
export function makeVarsCap(engine: Engine, host: CapHost): VarsCap | undefined {
  const write = host.granted.has('vars.write')
  if (!write && !host.granted.has('vars.read')) return undefined
  return {
    get: (name) => engine.vars[name],
    has: (name) => Object.prototype.hasOwnProperty.call(engine.vars, name),
    all: () => ({ ...engine.vars }),
    set: write
      ? (name, value) => {
          engine.vars[name] = value
        }
      : (name) => host.warn(`vars.set("${name}") ignored — "vars.write" was not granted`),
  }
}

/** `session.save`. */
export function makeSavesCap(engine: Engine, host: CapHost): SavesCap | undefined {
  if (!host.granted.has('session.save')) return undefined
  return {
    saveState: () => engine.saveState(),
    restoreState: (state) => engine.restoreState(state),
    restart: () => engine.restart(),
    get saveKey() {
      return engine.saveKey
    },
    get buildInfo() {
      return engine.buildInfo
    },
  }
}

/** `session.settings`. */
export function makeSettingsCap(engine: Engine, host: CapHost): SettingsCap | undefined {
  if (!host.granted.has('session.settings')) return undefined
  return {
    get textSpeed() {
      return engine.textSpeed
    },
    set textSpeed(v: number) {
      engine.textSpeed = v
    },
    getVolume: (channel) => engine[VOLUME_FIELD[channel]],
    setVolume: (channel, value) => {
      engine[VOLUME_FIELD[channel]] = Math.max(0, Math.min(1, value))
      engine.applyVolumes()
    },
    get lang() {
      return engine.lang
    },
    get languages() {
      return engine.languages
    },
    languageName: (lang) => uiLangName(lang),
    setLanguage: (lang) => engine.setLanguage(lang),
    onLanguageChange: (fn) => {
      const off = engine.onLanguageChange(fn)
      host.dispose(off)
      return off
    },
    resolveText: (key) => engine.resolveText(key),
  }
}

/** `session.backlog`. */
export function makeBacklogCap(engine: Engine, host: CapHost): BacklogCap | undefined {
  if (!host.granted.has('session.backlog')) return undefined
  return {
    entries: () => engine.getBacklog(),
    replayVoice: (ref, offset) => engine.replayVoice(ref, offset),
  }
}

/** `session.replay`. */
export function makeReplayCap(engine: Engine, host: CapHost): ReplayCap | undefined {
  if (!host.granted.has('session.replay')) return undefined
  let installedEnd: (() => void) | null = null
  host.dispose(() => {
    if (installedEnd && engine.onReplayEnd === installedEnd) engine.onReplayEnd = null
  })
  return {
    list: () => engine.replays,
    isReplaying: () => engine.isReplaying(),
    play: (segId) => engine.playReplay(segId),
    end: () => engine.endReplay(),
    fireSeen: (segId) => engine.fireSegmentSeen(segId),
    onSeen: (fn) => {
      const off = engine.onSegmentSeen(fn)
      host.dispose(off)
      return off
    },
    onEnd: (fn) => {
      installedEnd = fn
      engine.onReplayEnd = fn
    },
  }
}

/** `ui.layer`. */
export function makeUiCap(engine: Engine, host: CapHost): UiCap | undefined {
  if (!host.granted.has('ui.layer')) return undefined
  return {
    layer: (className) => {
      const el = document.createElement('div')
      el.className = className ?? ''
      el.dataset.plugin = host.id
      engine.stage.root.append(el)
      host.dispose(() => el.remove())
      return el
    },
    onStage: (type, fn, opts) => {
      const root = engine.stage.root
      root.addEventListener(type, fn as EventListener, opts)
      const off = (): void => root.removeEventListener(type, fn as EventListener, opts)
      host.dispose(off)
      return off
    },
  }
}

/** `timer`. */
export function makeTimerCap(host: CapHost): TimerCap | undefined {
  if (!host.granted.has('timer')) return undefined
  const timeouts = new Set<number>()
  const intervals = new Set<number>()
  const frames = new Set<number>()
  host.dispose(() => {
    for (const id of timeouts) clearTimeout(id)
    for (const id of intervals) clearInterval(id)
    for (const id of frames) cancelAnimationFrame(id)
    timeouts.clear()
    intervals.clear()
    frames.clear()
  })
  return {
    setTimeout: (fn, ms) => {
      const id = window.setTimeout(() => {
        timeouts.delete(id)
        fn()
      }, ms)
      timeouts.add(id)
      return id
    },
    clearTimeout: (id) => {
      timeouts.delete(id)
      clearTimeout(id)
    },
    setInterval: (fn, ms) => {
      const id = window.setInterval(fn, ms)
      intervals.add(id)
      return id
    },
    clearInterval: (id) => {
      intervals.delete(id)
      clearInterval(id)
    },
    requestAnimationFrame: (fn) => {
      const id = requestAnimationFrame((t) => {
        frames.delete(id)
        fn(t)
      })
      frames.add(id)
      return id
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id)
      cancelAnimationFrame(id)
    },
  }
}

/** Build every capability object the record was granted. */
export function makeCapabilities(engine: Engine, host: CapHost): Pick<PluginContext, 'stage' | 'audio' | 'vars' | 'saves' | 'settings' | 'backlog' | 'replay' | 'ui' | 'timer'> {
  const caps: Record<string, unknown> = {}
  const put = (key: string, value: unknown): void => {
    if (value !== undefined) caps[key] = value
  }
  put('stage', makeStageCap(engine, host))
  put('audio', makeAudioCap(engine, host))
  put('vars', makeVarsCap(engine, host))
  put('saves', makeSavesCap(engine, host))
  put('settings', makeSettingsCap(engine, host))
  put('backlog', makeBacklogCap(engine, host))
  put('replay', makeReplayCap(engine, host))
  put('ui', makeUiCap(engine, host))
  put('timer', makeTimerCap(host))
  return caps as ReturnType<typeof makeCapabilities>
}

/** Permission ids the ENGINE side implements (a capability object exists for each). */
export const ENGINE_CAPABILITIES: readonly Permission[] = [
  'stage.read',
  'stage.write',
  'audio.play',
  'vars.read',
  'vars.write',
  'save.slice',
  'session.save',
  'session.settings',
  'session.backlog',
  'session.replay',
  'ui.layer',
  'timer',
]
