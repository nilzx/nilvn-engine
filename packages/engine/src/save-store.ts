// Persistence seam for saves and settings (batch G). The engine's own autosave
// (and, from inc 4, its slot screen and settings) go through a `SaveStore`; the
// default keeps everything in `localStorage` under `nilvn:<work>:<key>`, a
// desktop shell can substitute a file-backed store, tests an in-memory one.
// Values are JSON-serializable. Every method is async so a remote or native
// store fits without changing callers.
import type { SaveState } from './engine.js'

export interface SaveStore {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  /** Every key in this work's namespace. */
  keys(): Promise<string[]>
}

/** The autosave's key in the store. */
export const AUTOSAVE_KEY = 'auto'
/** The quick-save's key. */
export const QUICKSAVE_KEY = 'quick'
/** A numbered slot's key. */
export const slotKey = (n: number): string => `slot:${n}`
/** The persisted player settings' key. */
export const SETTINGS_KEY = 'settings'
/** The read-lines set's key (skip mode). */
export const READ_KEY = 'read'
/** The unlocked replay segments' key. */
export const UNLOCKS_KEY = 'unlocks'
/** The persistent variables' key (`[persist]`, `sys.*`): a `GlobalsPayload`. */
export const GLOBALS_KEY = 'globals'
/** The players' plugin settings (`scope: player` config fields) by plugin id. */
export const PLUGIN_SETTINGS_KEY = 'plugin-settings'
/** A plugin's own storage keys (`storage.local`) live under this prefix. */
export const pluginStorageKey = (pluginId: string, key: string): string => `plugin:${pluginId}:${key}`

/** What the settings store holds (every field optional: only what the player changed). */
export interface SettingsPayload {
  v: 1
  textSpeed?: number
  autoDelay?: number
  skipMode?: 'read' | 'all'
  volumes?: Partial<Record<'bgm' | 'ambience' | 'se' | 'voice', number>>
  lang?: string
  dialogOpacity?: number
  uiScale?: number
}

/** What the `globals` key holds: every persistent variable ever written by
 *  this work, declared today or not. */
export interface GlobalsPayload {
  v: 1
  vars: Record<string, unknown>
}

/** What a slot holds: the snapshot plus what a slot list shows. Mirrors the
 *  menu plugin's wrapper (`FORMAT_VERSIONS.saveSlot`). */
export interface SlotPayload {
  v: 1
  savedAt: number
  /** The line on screen when the save was taken (a slot list's caption). */
  preview: string
  state: SaveState
}

export function isSlotPayload(x: unknown): x is SlotPayload {
  return !!x && typeof x === 'object' && (x as SlotPayload).v === 1 && typeof (x as SlotPayload).state === 'object'
}

/** In-memory store: hosts without storage, and tests. */
export class MemorySaveStore implements SaveStore {
  private map = new Map<string, unknown>()
  get(key: string): Promise<unknown | undefined> {
    return Promise.resolve(this.map.get(key))
  }
  set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value))
    return Promise.resolve()
  }
  remove(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()])
  }
}

/** Shared fallback when localStorage is unreachable (private mode, sandboxed
 *  frames): the session still plays, saves just don't outlive the page. */
const memoryFallback = new Map<string, MemorySaveStore>()

/** `localStorage`, namespaced per work. Stateless apart from the namespace, so
 *  instances are cheap and interchangeable. */
export class LocalStorageSaveStore implements SaveStore {
  constructor(readonly namespace: string) {}
  private prefix(): string {
    return `nilvn:${this.namespace}:`
  }
  private fallback(): MemorySaveStore {
    let m = memoryFallback.get(this.namespace)
    if (!m) memoryFallback.set(this.namespace, (m = new MemorySaveStore()))
    return m
  }
  async get(key: string): Promise<unknown | undefined> {
    try {
      const raw = localStorage.getItem(this.prefix() + key)
      return raw === null ? undefined : (JSON.parse(raw) as unknown)
    } catch {
      return this.fallback().get(key)
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    try {
      localStorage.setItem(this.prefix() + key, JSON.stringify(value))
    } catch {
      await this.fallback().set(key, value)
    }
  }
  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefix() + key)
    } catch {
      await this.fallback().remove(key)
    }
  }
  async keys(): Promise<string[]> {
    try {
      const out: string[] = []
      const p = this.prefix()
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(p)) out.push(k.slice(p.length))
      }
      return out
    } catch {
      return this.fallback().keys()
    }
  }
}
