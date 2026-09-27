// Capability objects: what a
// plugin receives INSTEAD of the engine. Each object is a thin, permission-gated
// facade over the engine's public API; a permission the host did not grant leaves
// its object undefined, and within the stage object the write verbs degrade to
// stubs when only `stage.read` was granted. Every subscription / listener / timer
// / DOM node minted here is recorded on the plugin's disposer list, so the host
// can release all of it deterministically on deactivate (the hot-plug guarantee).

import { VOLUME_FIELD, type Engine } from './engine.js'
import { pluginStorageKey } from './save-store.js'
import { uiLangName } from './i18n.js'
import { formatBinding } from './keys.js'
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
  InputCap,
  StorageCap,
  ScreenCap,
  DialogCap,
} from './types.js'


/** What the capability factories need from the host record. */
export interface CapHost {
  readonly id: string
  readonly granted: ReadonlySet<string>
  /** Record a disposer to run on deactivate. */
  dispose(fn: () => void): void
  /** Attribute a problem to this plugin (once per message). */
  warn(message: string): void
  /** The prefix of this plugin's variables (`weather`); '' = none (the engine's own context). */
  readonly varNs: string
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
  | 'stopAnimations'
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
  'stopAnimations',
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
  // A write verb called wrongly is the plugin's diagnostic, never an exception
  // thrown back into it (sync or async) — the same rule content follows.
  const guarded =
    (verb: string, fn: (...a: unknown[]) => unknown, check?: (...a: unknown[]) => string | undefined) =>
    (...args: unknown[]): unknown => {
      const bad = check?.(...args)
      if (bad) {
        host.warn(`stage.${verb}: ${bad} — ignored`)
        return Promise.resolve()
      }
      try {
        const r = fn(...args)
        return r instanceof Promise ? r.catch((err: unknown) => host.warn(`stage.${verb} failed: ${err instanceof Error ? err.message : String(err)}`)) : r
      } catch (err) {
        host.warn(`stage.${verb} failed: ${err instanceof Error ? err.message : String(err)}`)
        return undefined
      }
    }
  const checks: Partial<Record<StageWriteVerb, (...a: unknown[]) => string | undefined>> = {
    showSprite: (id, spec) =>
      typeof id !== 'string' || !id ? 'the first argument is the sprite id (showSprite(id, spec))' : typeof (spec as { url?: unknown } | undefined)?.url !== 'string' ? 'spec.url (the resolved sheet URL) is missing' : undefined,
  }
  for (const v of STAGE_WRITE) cap[v] = write ? guarded(v, (stage[v] as (...a: unknown[]) => unknown).bind(stage), checks[v]) : stub(v)
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
  const ns = host.varNs
  const prefix = ns ? ns + '.' : ''
  const exists = (name: string): boolean => Object.prototype.hasOwnProperty.call(engine.globals, name) || Object.prototype.hasOwnProperty.call(engine.vars, name)
  return {
    namespace: ns,
    get: (key) => {
      const name = prefix + key
      // Migration aid: a plugin written before namespaces reading an author variable.
      if (prefix && !exists(name) && exists(key)) host.warn(`vars.get("${key}") reads this plugin's own "${name}" — use vars.global("${key}") for the author's variable`)
      return engine.getVar(name)
    },
    has: (key) => exists(prefix + key),
    all: () => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(engine.scope())) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
      return out
    },
    set: write ? (key, value) => engine.setVar(prefix + key, value) : (key) => host.warn(`vars.set("${key}") ignored — "vars.write" was not granted`),
    global: (name) => engine.getVar(name),
  }
}

/** `input.keys`: handlers for the plugin's declared key bindings. */
export function makeInputCap(engine: Engine, host: CapHost): InputCap | undefined {
  if (!host.granted.has('input.keys')) return undefined
  return {
    on: (id, fn) => {
      const off = engine.keyTable.on(host.id, id, fn)
      if (!off) {
        host.warn(`input.on("${id}"): no such binding in contributes.keybindings`)
        return () => {}
      }
      host.dispose(off)
      return off
    },
    label: (id) => {
      const key = `${host.id}:${id}`
      if (!engine.keyTable.hasPluginBinding(host.id, id)) {
        host.warn(`input.label("${id}"): no such binding in contributes.keybindings`)
        return ''
      }
      const shown = formatBinding(engine.keyTable.binding(key))
      return shown === '—' ? '' : shown
    },
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
    setVolume: (channel, value) => engine.setVolume(channel, value),
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
    layer: (className, opts) => {
      const el = document.createElement('div')
      el.className = className ?? ''
      el.dataset.plugin = host.id
      // `scene`: over the picture, under the dialogue box; `overlay` (default):
      // over the dialogue and choices, under the fade cover and the full-stage screens.
      const stage = engine.stage
      stage.root.insertBefore(el, opts?.over === 'scene' ? stage.dialog : stage.fader)
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

/** `storage.local`: the engine's SaveStore, namespaced per plugin. */
export function makeStorageCap(engine: Engine, host: CapHost): StorageCap | undefined {
  if (!host.granted.has('storage.local')) return undefined
  const k = (key: string): string => pluginStorageKey(host.id, key)
  const prefix = pluginStorageKey(host.id, '')
  return {
    get: async <T,>(key: string) => (await engine.saveStore.get(k(key))) as T | undefined,
    set: (key, value) => engine.saveStore.set(k(key), value),
    remove: (key) => engine.saveStore.remove(k(key)),
    keys: async () => (await engine.saveStore.keys()).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)),
  }
}

/** `ui.dialog`: the engine's own boxes. */
export function makeDialogCap(engine: Engine, host: CapHost): DialogCap | undefined {
  if (!host.granted.has('ui.dialog')) return undefined
  return {
    confirm: (message) => engine.stage.chrome.confirm(message, { ok: engine.t('ui.dialog.ok'), cancel: engine.t('ui.dialog.cancel') }),
    alert: async (message) => {
      await engine.stage.chrome.confirm(message, { ok: engine.t('ui.dialog.ok') })
    },
    prompt: (message, opts = {}) =>
      engine.stage.chrome.prompt(message, { ok: engine.t('ui.dialog.ok'), cancel: engine.t('ui.dialog.cancel'), position: engine.inputConfig.position, ...opts }).result,
    toast: (message) => engine.stage.chrome.toast(message),
  }
}

/** `ui.screen`: plugin screens and chrome entries, each released on dispose. */
export function makeScreenCap(engine: Engine, host: CapHost): ScreenCap | undefined {
  if (!host.granted.has('ui.screen')) return undefined
  let released = false
  return {
    open: (id, title, render) => {
      if (!released) {
        released = true
        host.dispose(() => engine.closePluginScreen(undefined, host.id)) // its screen goes with the plugin
      }
      return engine.openPluginScreen(host.id, id, title, render)
    },
    close: (id) => engine.closePluginScreen(id, host.id),
    isOpen: (id) => engine.pluginScreenOpen(host.id, id),
    menuItem: (id, onSelect) => {
      const off = engine.addMenuItem(host.id, id, onSelect)
      host.dispose(off)
      return off
    },
    titleItem: (id, onSelect) => {
      const off = engine.addTitleItem(host.id, id, onSelect)
      host.dispose(off)
      return off
    },
    hud: (id) => {
      const { el, dispose } = engine.hudWidget(host.id, id)
      host.dispose(dispose)
      return el
    },
  }
}

/** Build every capability object the record was granted. */
export function makeCapabilities(engine: Engine, host: CapHost): Pick<PluginContext, 'stage' | 'audio' | 'vars' | 'saves' | 'settings' | 'backlog' | 'replay' | 'ui' | 'timer' | 'storage' | 'screen' | 'dialog' | 'input'> {
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
  put('storage', makeStorageCap(engine, host))
  put('screen', makeScreenCap(engine, host))
  put('dialog', makeDialogCap(engine, host))
  put('input', makeInputCap(engine, host))
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
  'ui.screen',
  'ui.dialog',
  'timer',
  'input.keys',
  'storage.local',
]
