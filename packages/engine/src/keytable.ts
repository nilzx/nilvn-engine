// The engine's one key table (plugin platform v3 §2.6): its own actions (`[keys]`)
// and the bindings active plugins declare (`contributes.keybindings`), each
// resolved player → author → default. A plugin binding whose key is already
// taken when it registers stays unbound (with a diagnostic) until the player
// gives it one; the engine's actions always come first. The player's changes
// live in `player` (persisted with the settings); assigning a key takes it away
// from whichever other binding held it.
import type { KeybindingDef } from '@nilvn/core'
import { KEY_ACTIONS, bindingOf, chordsOf, formatBinding, matchKey } from './keys.js'
import type { KeyAction, KeyBinding, KeysConfig } from './types.js'

interface PluginBinding {
  /** `<plugin id>:<local id>`. */
  id: string
  owner: string
  /** Names the author's `[keys.<name>]` table may use for the owner. */
  names: string[]
  local: string
  def: KeybindingDef
  label: () => string
  /** Its key was taken when it registered — unbound unless the player binds it. */
  blocked: boolean
  handlers: Set<() => void>
}

/** One row of the settings screen's key list. */
export interface KeyRow {
  id: string
  /** The owning plugin, or null for an engine action. */
  owner: string | null
  label: string
  binding: KeyBinding | undefined
  display: string
}

export class KeyTable {
  /** The player's bindings by id (persisted); absent = author / default. */
  player: Record<string, KeyBinding> = {}
  private plugins = new Map<string, PluginBinding>()

  constructor(
    /** The author's `[keys]` (live: `applyConfig` writes into it). */
    private readonly author: KeysConfig,
    private readonly report: (message: string) => void,
  ) {}

  /** The effective binding of an engine action or a plugin binding. */
  binding(id: string): KeyBinding | undefined {
    if (Object.prototype.hasOwnProperty.call(this.player, id)) return this.player[id]
    const pb = this.plugins.get(id)
    if (!pb) return (KEY_ACTIONS as readonly string[]).includes(id) ? bindingOf(this.author, id as KeyAction) : undefined
    return pb.blocked ? undefined : this.pluginDefault(pb)
  }

  hit(id: string, ev: KeyboardEvent): boolean {
    return matchKey(this.binding(id), ev)
  }

  /** Enter a plugin's bindings, in order. Returns the disposer. */
  register(owner: string, names: string[], defs: KeybindingDef[], label: (def: KeybindingDef) => string): () => void {
    const ids: string[] = []
    for (const def of defs) {
      const id = `${owner}:${def.id}`
      if (this.plugins.has(id)) continue
      const pb: PluginBinding = { id, owner, names, local: def.id, def, label: () => label(def), blocked: false, handlers: new Set() }
      if (!Object.prototype.hasOwnProperty.call(this.player, id)) {
        const mine = chordsOf(this.pluginDefault(pb))
        const taken = mine.length ? this.holderOf(mine, id) : undefined
        if (taken) {
          pb.blocked = true
          this.report(`key binding "${id}": ${formatBinding(this.pluginDefault(pb))} is already bound to "${taken}" — left unbound (the player can assign it a key in the settings)`)
        }
      }
      this.plugins.set(id, pb)
      ids.push(id)
    }
    return () => {
      for (const id of ids) this.plugins.delete(id)
    }
  }

  /** Whether a plugin declared binding `local` (and it is registered). */
  hasPluginBinding(owner: string, local: string): boolean {
    return this.plugins.has(`${owner}:${local}`)
  }

  /** Subscribe to a plugin binding; undefined when the plugin declared no such id. */
  on(owner: string, local: string, fn: () => void): (() => void) | undefined {
    const pb = this.plugins.get(`${owner}:${local}`)
    if (!pb) return undefined
    pb.handlers.add(fn)
    return () => void pb.handlers.delete(fn)
  }

  /** Run the plugin binding this key press hits, if any. `playing` = the story
   *  plays with no menu or screen open; `idle` = no system menu is open. */
  dispatch(ev: KeyboardEvent, state: { playing: boolean; idle: boolean }, fail: (owner: string, err: unknown) => void): boolean {
    for (const pb of this.plugins.values()) {
      if (!pb.handlers.size || !matchKey(this.binding(pb.id), ev)) continue
      const when = pb.def.when ?? 'playing'
      if (when === 'playing' ? !state.playing : !state.idle) continue
      ev.preventDefault()
      if (ev.repeat) return true
      for (const fn of [...pb.handlers]) {
        try {
          fn()
        } catch (err) {
          fail(pb.owner, err)
        }
      }
      return true
    }
    return false
  }

  /** The player binds `id` to `binding`; any other binding holding one of its
   *  keys loses that key. */
  assign(id: string, binding: KeyBinding): void {
    const keys = new Set(chordsOf(binding))
    for (const other of this.ids()) {
      if (other === id) continue
      const current = this.binding(other)
      const specs = current === undefined || current === false ? [] : Array.isArray(current) ? current : [current]
      const kept = specs.filter((spec) => !chordsOf(spec).some((c) => keys.has(c)))
      if (kept.length !== specs.length) this.player[other] = kept.length ? kept : false
    }
    this.player[id] = binding
  }

  /** Which binding (an engine action, or a plugin's `<id>:<binding>`) already
   *  holds one of `binding`'s keys — what a panel button's `key` checks against. */
  holder(binding: KeyBinding): string | undefined {
    const chords = chordsOf(binding)
    return chords.length ? this.holderOf(chords, '') : undefined
  }

  /** Forget the player's changes. */
  reset(): void {
    this.player = {}
  }

  /** The settings screen's list: engine actions (`menu` stays fixed so a player
   *  cannot lock themselves out of it), then plugin bindings in registration order. */
  rows(t: (id: string) => string): KeyRow[] {
    const row = (id: string, owner: string | null, label: string): KeyRow => {
      const binding = this.binding(id)
      return { id, owner, label, binding, display: formatBinding(binding) }
    }
    return [
      ...KEY_ACTIONS.filter((a) => a !== 'menu').map((a) => row(a, null, t(`ui.keys.${a}`))),
      ...[...this.plugins.values()].map((pb) => row(pb.id, pb.owner, pb.label())),
    ]
  }

  private ids(): string[] {
    return [...KEY_ACTIONS, ...this.plugins.keys()]
  }

  /** Which binding (other than `except`) already holds one of `chords`. */
  private holderOf(chords: string[], except: string): string | undefined {
    for (const id of this.ids()) {
      if (id === except) continue
      const theirs = chordsOf(this.binding(id))
      if (theirs.some((c) => chords.includes(c))) return id
    }
    return undefined
  }

  /** The author's key for a plugin binding (`[keys.<name>] <id> = …`), else its default. */
  private pluginDefault(pb: PluginBinding): KeyBinding | undefined {
    for (const name of pb.names) {
      const table = this.author[name]
      if (table && typeof table === 'object' && !Array.isArray(table) && Object.prototype.hasOwnProperty.call(table, pb.local)) return table[pb.local]
    }
    return pb.def.default
  }
}
