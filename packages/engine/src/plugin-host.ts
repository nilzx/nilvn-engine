// The plugin host: the one place plugins are registered, validated, activated, deactivated and disposed.
//
//   register(module, manifest?) → activate(id) → running → deactivate(id) → disposed
//
// Every contribution — command, text effect, effect, kind, hook, style, listener,
// timer, UI layer, `onDispose` — is recorded per plugin and released together, so
// enabling / disabling / reloading a plugin is deterministic and leaves nothing
// behind (the hot-plug guarantee). Plugins never see the engine: `activate`
// receives a PluginContext whose capability objects exist only for the
// permissions the host granted (plugin-context.ts).
//
// Failure policy: a throwing activate / a run of
// consecutive command failures quarantines the plugin (its contributions become
// no-ops, one `plugin` diagnostic), a `[use]` that resolves to nothing is
// recorded in `missingPlugins`. Nothing here throws to the host over content.

import type { Engine } from './engine.js'
import type {
  CommandFn,
  EffectDef,
  EnginePlugin,
  EngineHooks,
  ObjectKind,
  ObjectKindDecl,
  Permission,
  PluginContext,
  PluginLoader,
  PluginManifest,
  PluginState,
  TextEffectFn,
} from './types.js'
import { ENGINE_CAPABILITIES, makeCapabilities, type CapHost } from './plugin-context.js'
import { engineGrantable, firstPartyShortName, isPluginId, isPluginManifest, isPluginRelPath, manifestProblems, normalizePluginPath, manifestStateVersion, matchPermission, themeTokenPrefix } from './plugin-manifest.js'
import { isThemeToken, themeVar, THEME_TOKEN_RE } from './theme.js'
import { resolveKind } from './object.js'
import { isValidRange, satisfiesRange } from './semver.js'

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** One registered plugin and everything the host holds for it. */
interface Rec {
  id: string
  module: EnginePlugin
  manifest?: PluginManifest
  /** The engine module's URL for path / package plugins (reload re-imports it). */
  url?: string
  /** Stylesheets fetched from a package manifest's `styles`, injected on activate. */
  packageStyles: string[]
  /** Where `ctx.asset(path)` resolves the plugin's own files (absent = a
   *  host-registered module with no location). */
  assetBase?: (path: string) => string | undefined
  /** The prefix of this plugin's variables, fixed at activation. */
  varNs?: string
  /** Installed through `EngineOptions.plugins` — the host's own code; `setEnabled` never removes it. */
  pinned: boolean
  granted: Set<string>
  state: PluginState
  ctx: PluginContext | null
  disposers: (() => void)[]
  failures: number
  /** An in-flight async `activate()`. */
  activating: Promise<void> | null
  warned: Set<string>
  /** Commands this plugin would contribute — onCommand activation looks here. */
  commandNames: Set<string>
  order: number
}

interface Owned<T> {
  value: T
  owner: string
}

type HookEntry = { fn: (...args: unknown[]) => void; owner: string }

/** A provided service (`ctx.services.provide`). */
interface ServiceEntry {
  owner: string
  version: string
  api: Record<string, (...args: unknown[]) => unknown>
}

const serviceKey = (pluginId: string, serviceId: string): string => `${pluginId}\u0000${serviceId}`

export interface PluginHostOptions {
  grant?: (id: string, requested: Permission[]) => Permission[]
  failureLimit: number
  loader?: PluginLoader
}

const defaultLoader: PluginLoader = {
  async fetchManifest(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  },
  importModule(url) {
    return import(/* @vite-ignore */ url)
  },
}

/** Where a plugin's variables live: its full id, `-` → `_` (expression
 *  identifiers have no `-`). */
function varPrefix(id: string): string {
  return id.replace(/-/g, '_')
}

/** The short prefix scripts may use while it is unambiguous: a first-party
 *  plugin's short name, else a third-party id's last segment. */
function shortVarPrefix(id: string): string {
  return varPrefix(firstPartyShortName(id) ?? id.slice(id.lastIndexOf('.') + 1))
}

/** Where a `[use]` entry points: a registered id / short name, a plugin package
 *  (`…/plugin.json`), a bare module (`./x.js`), or nothing we can load. */
function useKind(name: string): 'json' | 'module' | 'name' {
  if (/\.json(?:[?#].*)?$/i.test(name)) return 'json'
  if (name.includes('/') || /\.(?:m?js|ts)(?:[?#].*)?$/i.test(name)) return 'module'
  return 'name'
}

/** Per-host token so two engines on one page (the editor's edit stage + its
 *  preview) never share a plugin's <style> element id. */
let hostSeq = 0

export class PluginHost {
  private readonly token = ++hostSeq
  private recs = new Map<string, Rec>()
  /** Short name → id: a first-party plugin (`app.nilvn.textfx`) also answers to
   *  its last segment (`[use textfx]`), aliased automatically on register. */
  private aliases = new Map<string, string>()
  private commands = new Map<string, Owned<CommandFn>>()
  private textEffects = new Map<string, Owned<TextEffectFn>>()
  private effects = new Map<string, Owned<EffectDef>>()
  /** Kinds; built-ins carry owner null and are never disposed. */
  private kinds = new Map<string, { kind: ObjectKind; owner: string | null }>()
  private hooks = new Map<keyof EngineHooks, HookEntry[]>()
  private services = new Map<string, ServiceEntry>()
  /** Plugin theme token → the active plugin that declared it. */
  private themeTokenOwners = new Map<string, string>()
  /** Plugins the loaded script package carries: id → its plugin.json ref. */
  private packageSources = new Map<string, string>()
  private seq = 0
  private dead = false
  private readonly loader: PluginLoader

  constructor(
    private readonly engine: Engine,
    private readonly opts: PluginHostOptions,
    /** Shared with `engine.missingPlugins` (the engine exposes the same array). */
    private readonly missingList: string[],
    /** Shared with `engine.isolatedPlugins`. */
    private readonly isolatedList: string[],
  ) {
    this.loader = opts.loader ?? defaultLoader
  }

  // ---- registry ----

  /** Seed a built-in object kind (never disposed). */
  seedKind(decl: ObjectKindDecl): void {
    this.kinds.set(decl.id, { kind: resolveKind(decl).kind, owner: null })
  }

  /** Map a short name to a plugin id (first-party plugins answer to both). */
  alias(name: string, id: string): void {
    this.aliases.set(name, id)
  }

  resolveId(nameOrId: string): string {
    return this.aliases.get(nameOrId) ?? nameOrId
  }

  /** Register a runtime module (and its manifest, when one accompanies it). An
   *  invalid id is a `plugin` diagnostic and the module is not registered. A
   *  re-registration replaces an INACTIVE record's module; an active one is left
   *  alone (reload is the way to swap a running plugin). */
  register(module: EnginePlugin, extra: { manifest?: PluginManifest; url?: string; pinned?: boolean } = {}): Rec | null {
    const id = module?.id
    if (typeof id !== 'string' || !isPluginId(id)) {
      this.engine.report({ phase: 'plugin', plugin: String(id), message: `invalid plugin id "${String(id)}" (expected reverse-DNS, e.g. com.example.myfx) — not registered` })
      return null
    }
    const existing = this.recs.get(id)
    if (existing?.state === 'active') return existing
    const rec: Rec = existing ?? {
      id,
      module,
      packageStyles: [],
      pinned: false,
      granted: new Set(),
      state: 'registered',
      ctx: null,
      disposers: [],
      failures: 0,
      activating: null,
      warned: new Set(),
      commandNames: new Set(),
      order: 0,
    }
    rec.module = module
    if (extra.manifest) rec.manifest = extra.manifest
    this.checkStateVersion(rec)
    if (extra.url) rec.url = extra.url
    if (extra.pinned) rec.pinned = true
    rec.state = 'registered'
    rec.commandNames = new Set([...Object.keys(module.commands ?? {}), ...(rec.manifest?.contributes?.commands ?? []).map((c) => c.name)])
    this.recs.set(id, rec)
    const short = firstPartyShortName(id)
    if (short && !this.aliases.has(short)) this.aliases.set(short, id)
    if (rec.manifest?.contributes?.actorFields?.length) this.engine.normalizeActors()
    return rec
  }

  /** The manifest attached to a registered plugin (by id or short name). */
  manifestOf(nameOrId: string): PluginManifest | undefined {
    return this.recs.get(this.resolveId(nameOrId))?.manifest
  }

  /** Every actor field a registered manifest declares (`contributes.actorFields`). */
  actorFields(): { pluginId: string; key: string }[] {
    const out: { pluginId: string; key: string }[] = []
    for (const rec of this.recs.values()) for (const f of rec.manifest?.contributes?.actorFields ?? []) out.push({ pluginId: rec.id, key: f.key })
    return out
  }

  /** Attach a manifest to a registered plugin (EngineOptions.manifests). */
  attachManifest(m: PluginManifest): void {
    const rec = this.recs.get(m.id)
    if (rec) {
      rec.manifest = m
      this.checkStateVersion(rec)
      rec.commandNames = new Set([...Object.keys(rec.module.commands ?? {}), ...(m.contributes?.commands ?? []).map((c) => c.name)])
      if (m.contributes?.actorFields?.length) this.engine.normalizeActors()
    }
  }

  has(nameOrId: string): boolean {
    return this.recs.has(this.resolveId(nameOrId))
  }

  state(nameOrId: string): PluginState | undefined {
    return this.recs.get(this.resolveId(nameOrId))?.state
  }

  isActive(nameOrId: string): boolean {
    return this.state(nameOrId) === 'active'
  }

  isIsolated(id: string): boolean {
    return this.recs.get(id)?.state === 'isolated'
  }

  /** Ids of the active plugins, in activation order. */
  activeIds(): string[] {
    return [...this.recs.values()]
      .filter((r) => r.state === 'active' || r.state === 'isolated')
      .sort((a, b) => a.order - b.order)
      .map((r) => r.id)
  }

  /** Every registered id (host registry + loaded), any state. */
  registeredIds(): string[] {
    return [...this.recs.keys()]
  }

  // ---- lifecycle ----

  /** Activate a registered plugin (idempotent). Synchronous when the module's
   *  `activate` is; an async `activate` is tracked (see {@link settle}) and a
   *  rejection isolates the plugin. Returns whether the plugin is active now. */
  activate(nameOrId: string, chain: ReadonlySet<string> = new Set()): boolean {
    const rec = this.recs.get(this.resolveId(nameOrId))
    if (!rec || this.dead) return false
    if (rec.state === 'active') return true
    if (rec.state === 'isolated') return false
    const m = rec.manifest
    const problems = m ? manifestProblems(m) : this.moduleProblems(rec.module)
    if (problems.length) {
      this.block(rec, problems.join('; '))
      return false
    }
    // Dependencies first (by id, a version range each — roadmap §4.1).
    const deps = m?.dependencies ?? rec.module.dependencies ?? {}
    for (const [dep, range] of Object.entries(deps)) {
      const d = this.recs.get(dep)
      if (!d) {
        this.block(rec, `missing dependency "${dep}"`)
        return false
      }
      const dv = d.manifest?.version ?? d.module.version
      if (range && dv && !satisfiesRange(dv, range)) {
        this.block(rec, `dependency "${dep}" is ${dv}, needs ${range}`)
        return false
      }
      if (chain.has(dep)) {
        this.block(rec, `dependency cycle through "${dep}"`)
        return false
      }
      if (!this.activate(dep, new Set([...chain, rec.id]))) {
        this.block(rec, `dependency "${dep}" could not be activated`)
        return false
      }
    }
    // Permissions: the manifest is authoritative; a module whose engine-side
    // declaration disagrees is warned once (a manifest also lists editor-side ones).
    const requested = (m?.permissions ?? rec.module.permissions ?? []) as Permission[]
    if (m && rec.module.permissions) {
      const engineSide = (ids: readonly string[]): string => ids.filter((id) => matchPermission(id)?.side === 'engine').sort().join(',')
      const a = engineSide(m.permissions ?? [])
      const b = engineSide(rec.module.permissions)
      if (a !== b) this.warnOnce(rec, `module declares permissions [${b}] but plugin.json says [${a}] — the manifest wins`)
    }
    for (const p of requested) if (!matchPermission(p)) this.warnOnce(rec, `unknown permission "${p}" ignored`)
    const granted = (this.opts.grant ? this.opts.grant(rec.id, requested) : requested).filter((p) => requested.includes(p) && !!matchPermission(p))
    rec.granted = new Set(granted.filter(engineGrantable))
    rec.disposers = []
    rec.failures = 0
    rec.order = ++this.seq
    rec.state = 'active'
    rec.varNs = varPrefix(rec.id)
    this.syncVarPrefixes()
    const ctx = this.makeContext(rec, granted)
    rec.ctx = ctx
    this.engine.checkPluginConfig(rec.id, (message) => this.warnOnce(rec, message))
    // Declared contributions go through the same disposable registration.
    const mod = rec.module
    if (mod.styles) ctx.addStyle(mod.styles)
    for (const css of rec.packageStyles) ctx.addStyle(css)
    for (const [name, fn] of Object.entries(mod.commands ?? {})) ctx.registerCommand(name, fn)
    for (const [name, fn] of Object.entries(mod.textEffects ?? {})) ctx.registerTextEffect(name, fn)
    for (const k of mod.objectKinds ?? []) ctx.registerKind(k)
    for (const [name, def] of Object.entries(mod.effects ?? {})) ctx.registerEffect(name, def)
    for (const [key, fn] of Object.entries(mod.hooks ?? {})) if (fn) ctx.on(key as keyof EngineHooks, fn as never)
    this.addThemeTokens(rec, ctx)
    const bindings = m?.contributes?.keybindings ?? mod.keybindings ?? []
    if (bindings.length && rec.granted.has('input.keys')) {
      // `[keys.<name>]`: the full id, or a first-party plugin's short name (as `[plugins.<name>]`).
      const short = firstPartyShortName(rec.id)
      rec.disposers.push(this.engine.keyTable.register(rec.id, short ? [short, rec.id] : [rec.id], bindings, (d) => (d.label ? ctx.t(d.label) : d.id)))
    } else if (bindings.length) {
      this.warnOnce(rec, 'declares key bindings but "input.keys" was not granted — they are not bound')
    }
    if ((mod.saveState || mod.restoreState) && !rec.granted.has('save.slice')) {
      this.warnOnce(rec, 'declares a save-state slice but "save.slice" was not granted — its slice is skipped')
    }
    try {
      const r = mod.activate?.(ctx)
      if (r && typeof (r as Promise<void>).then === 'function') {
        rec.activating = (r as Promise<void>).then(
          () => {
            rec.activating = null
          },
          (err: unknown) => {
            rec.activating = null
            this.isolate(rec, `activate failed: ${errMsg(err)}`, err)
          },
        )
      }
    } catch (err) {
      this.isolate(rec, `activate failed: ${errMsg(err)}`, err)
    }
    return rec.state === 'active'
  }

  /** Wait for an in-flight async activate (if any). */
  async settle(nameOrId: string): Promise<void> {
    const rec = this.recs.get(this.resolveId(nameOrId))
    if (rec?.activating) await rec.activating
  }

  /** Deactivate an active (or isolated) plugin: `deactivate(ctx)`, then every
   *  disposer in reverse — contributions, listeners, timers, styles, layers. The
   *  plugin stays registered and can be activated again. */
  deactivate(nameOrId: string): boolean {
    const rec = this.recs.get(this.resolveId(nameOrId))
    if (!rec || (rec.state !== 'active' && rec.state !== 'isolated')) return false
    const ctx = rec.ctx
    if (ctx) {
      try {
        rec.module.deactivate?.(ctx)
      } catch (err) {
        this.engine.report({ phase: 'plugin', plugin: rec.id, message: `deactivate failed: ${errMsg(err)}`, error: err })
      }
    }
    for (const fn of rec.disposers.reverse()) {
      try {
        fn()
      } catch (err) {
        this.engine.report({ phase: 'plugin', plugin: rec.id, message: `dispose failed: ${errMsg(err)}`, error: err })
      }
    }
    rec.disposers = []
    rec.ctx = null
    rec.granted = new Set()
    rec.activating = null
    rec.failures = 0
    rec.state = 'registered'
    this.syncVarPrefixes()
    return true
  }

  /** Hot reload: carry the save slice across a deactivate → (re-import) →
   *  activate → restore cycle. A path plugin is re-imported cache-busted; a
   *  registry plugin re-activates the same module. Any failure rolls back to
   *  the previous module and reports; returns whether the plugin is active now. */
  async reload(nameOrId: string): Promise<boolean> {
    const rec = this.recs.get(this.resolveId(nameOrId))
    if (!rec || this.dead) return false
    const wasActive = rec.state === 'active' || rec.state === 'isolated'
    const slice = wasActive && rec.ctx && rec.granted.has('save.slice') ? this.safeSlice(rec) : undefined
    const old = rec.module
    if (wasActive) this.deactivate(rec.id)
    let next = old
    if (rec.url) {
      const url = rec.url + (rec.url.includes('?') ? '&' : '?') + 'reload=' + Date.now()
      try {
        const plugin = (await this.loader.importModule(url)) as { default?: EnginePlugin }
        if (!plugin.default?.id) throw new Error('not a plugin module (needs a default export with an id)')
        if (plugin.default.id !== rec.id) throw new Error(`module id "${plugin.default.id}" does not match "${rec.id}"`)
        next = plugin.default
      } catch (err) {
        this.engine.report({ phase: 'plugin', plugin: rec.id, message: `reload failed to re-import — keeping the previous module: ${errMsg(err)}`, error: err })
      }
      if (this.dead) return false
    }
    this.register(next, {})
    let ok = this.activate(rec.id)
    if (ok) await this.settle(rec.id)
    if (rec.state !== 'active' && next !== old) {
      // Roll back to the module that worked.
      this.engine.report({ phase: 'plugin', plugin: rec.id, message: 'reload failed — rolled back to the previous module' })
      this.deactivate(rec.id)
      this.register(old, {})
      ok = this.activate(rec.id)
      if (ok) await this.settle(rec.id)
    }
    if (rec.state === 'active' && slice !== undefined) this.restoreSlice(rec.id, slice)
    return rec.state === 'active'
  }

  /** Resolve `[use …]` entries: a
   *  registered id / short name activates; `…/plugin.json` loads a plugin
   *  package; a module path imports a bare module; anything else is missing. */
  async use(names: string[], explicit = false): Promise<void> {
    for (const name of names) {
      if (this.dead) return
      const id = this.resolveId(name)
      const rec = this.recs.get(id)
      if (rec) {
        // `manual` waits for enablePlugin / setPlugins; `onCommand` for its first
        // command — a plain [use] only registers the intent (roadmap §4.1).
        const mode = rec.manifest?.activation?.engine ?? rec.module.activation ?? 'eager'
        if (mode !== 'eager' && !explicit) continue
        this.activate(id)
        await this.settle(id)
        continue
      }
      // A failed path is not retried by a plain [use]; enablePlugin (explicit) tries again.
      if (this.missingList.includes(name) && !explicit) continue
      const entry = this.packageSources.get(id)
      if (entry !== undefined) {
        await this.loadCarried(id, entry)
        continue
      }
      const kind = useKind(name)
      if (kind === 'json') await this.loadPackage(name)
      else if (kind === 'module') await this.loadModule(name)
      else this.missing(name, `unknown plugin "${name}" — register it via options, or [use ./path/to/plugin.json]`)
    }
  }

  /** Make exactly `ids` (plus pinned host plugins) the active set. */
  async setEnabled(ids: string[]): Promise<void> {
    const want = new Set(ids.map((id) => this.resolveId(id)))
    for (const id of this.activeIds().reverse()) {
      const rec = this.recs.get(id)!
      if (!want.has(id) && !rec.pinned) this.deactivate(id)
    }
    await this.use([...want], true)
  }

  /** Release every active plugin, last activated first; the host is dead after. */
  destroyAll(): void {
    for (const id of this.activeIds().reverse()) this.deactivate(id)
    this.dead = true
  }

  // ---- lookups (the engine's dispatch reads these) ----

  command(name: string): Owned<CommandFn> | undefined {
    return this.commands.get(name)
  }

  /** What a false `if=` does to a command (`contributes.commands[].ifFalse` in its
   *  owner's manifest): `skip` (default) or `handle`. */
  commandIfFalse(name: string): 'skip' | 'handle' {
    const owner = this.commands.get(name)?.owner
    const decl = owner ? this.recs.get(owner)?.manifest?.contributes?.commands?.find((c) => c.name === name) : undefined
    return decl?.ifFalse === 'handle' ? 'handle' : 'skip'
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name)
  }

  /** An `onCommand`-activated plugin that would contribute `name`: activate it
   *  and return the command. Undefined when no such plugin exists. */
  activateForCommand(name: string): Owned<CommandFn> | undefined {
    for (const rec of this.recs.values()) {
      if (rec.state !== 'registered' || !rec.commandNames.has(name)) continue
      const mode = rec.manifest?.activation?.engine ?? rec.module.activation ?? 'eager'
      if (mode !== 'onCommand') continue
      if (this.activate(rec.id)) return this.commands.get(name)
    }
    return undefined
  }

  textEffect(name: string): Owned<TextEffectFn> | undefined {
    return this.textEffects.get(name)
  }

  effect(name: string): Owned<EffectDef> | undefined {
    return this.effects.get(name)
  }

  kind(id: string): ObjectKind | undefined {
    return this.kinds.get(id)?.kind
  }

  /** Listeners of one hook, each with its owner's context; isolated owners are skipped. */
  listeners<K extends keyof EngineHooks>(name: K): { fn: NonNullable<EngineHooks[K]>; ctx: PluginContext; owner: string }[] {
    const out: { fn: NonNullable<EngineHooks[K]>; ctx: PluginContext; owner: string }[] = []
    for (const h of this.hooks.get(name) ?? []) {
      const rec = this.recs.get(h.owner)
      if (!rec || rec.state !== 'active' || !rec.ctx) continue
      out.push({ fn: h.fn as NonNullable<EngineHooks[K]>, ctx: rec.ctx, owner: h.owner })
    }
    return out
  }

  hasListeners(name: keyof EngineHooks): boolean {
    return (this.hooks.get(name) ?? []).length > 0
  }

  /** The context of an active plugin (effects run with their owner's grants). */
  contextOf(id: string): PluginContext | undefined {
    const rec = this.recs.get(id)
    return rec?.state === 'active' ? (rec.ctx ?? undefined) : undefined
  }

  // ---- failure accounting ----

  noteFailure(owner: string): void {
    const rec = this.recs.get(owner)
    if (!rec) return
    rec.failures++
    if (rec.failures >= this.opts.failureLimit) {
      this.isolate(rec, `isolated after ${rec.failures} consecutive command failures — its commands are now no-ops`)
    }
  }

  noteSuccess(owner: string): void {
    const rec = this.recs.get(owner)
    if (rec) rec.failures = 0
  }

  // ---- save slices ----

  /** Every active plugin's `saveState` slice (needs `save.slice`), keyed by id,
   *  plus the shape version of each slice that is not version 1. */
  saveSlices(): { ext: Record<string, unknown>; versions: Record<string, number> } {
    const ext: Record<string, unknown> = {}
    const versions: Record<string, number> = {}
    for (const id of this.activeIds()) {
      const rec = this.recs.get(id)!
      if (rec.state !== 'active' || !rec.ctx || !rec.granted.has('save.slice')) continue
      const slice = this.safeSlice(rec)
      if (slice === undefined) continue
      ext[id] = slice
      const v = this.stateVersion(rec)
      if (v !== 1) versions[id] = v
    }
    return { ext, versions }
  }

  /** Hand a slice saved at version `from` to its active owner (`key` may be a
   *  legacy short name), migrating it first when older. Returns false when no
   *  active plugin claims it (the caller carries it through); a slice the owner
   *  cannot take — newer, or older without a working `migrateState` — is
   *  dropped with a diagnostic and counts as claimed. */
  restoreSlice(key: string, data: unknown, from = 1): boolean {
    const rec = this.recs.get(this.resolveId(key))
    if (!rec || rec.state !== 'active' || !rec.ctx || !rec.granted.has('save.slice') || !rec.module.restoreState) return false
    const current = this.stateVersion(rec)
    if (from > current) {
      this.engine.report({ phase: 'plugin', plugin: rec.id, message: `save slice is version ${from}, this plugin reads up to ${current} — dropped` })
      return true
    }
    if (from < current) {
      if (!rec.module.migrateState) {
        this.engine.report({ phase: 'plugin', plugin: rec.id, message: `save slice is version ${from}, this plugin needs ${current} and has no migrateState — dropped` })
        return true
      }
      try {
        data = rec.module.migrateState(data, from)
      } catch (err) {
        this.engine.report({ phase: 'plugin', plugin: rec.id, message: `migrateState from version ${from} failed — slice dropped: ${errMsg(err)}`, error: err })
        return true
      }
    }
    try {
      rec.module.restoreState(rec.ctx, data)
    } catch (err) {
      this.engine.report({ phase: 'plugin', plugin: rec.id, message: `restoreState failed: ${errMsg(err)}`, error: err })
    }
    return true
  }

  /** A module and its plugin.json must agree on the slice version. */
  private checkStateVersion(rec: Rec): void {
    const declared = manifestStateVersion(rec.manifest)
    const own = rec.module.stateVersion
    if (declared !== undefined && own !== undefined && declared !== own) {
      this.warnOnce(rec, `stateVersion ${own} does not match plugin.json saveSlice.version ${declared} — using the module's`)
    }
  }

  /** Recompute the short variable prefixes: each active plugin's short name
   *  (a first-party short name, else the id's last segment) aliases its full
   *  prefix while no other active plugin shares it and it is not the engine's
   *  `sys`. Plugins that share one all lose it, each with a diagnostic — the
   *  outcome depends on the active set, never on activation order. */
  private syncVarPrefixes(): void {
    const live = [...this.recs.values()].filter((r) => r.varNs && (r.state === 'active' || r.state === 'isolated'))
    const byShort = new Map<string, Rec[]>()
    for (const r of live) {
      const short = shortVarPrefix(r.id)
      byShort.set(short, [...(byShort.get(short) ?? []), r])
    }
    const aliases = new Map<string, string>()
    for (const [short, recs] of byShort) {
      const [only] = recs
      if (recs.length === 1 && short !== 'sys') {
        if (short !== only!.varNs) aliases.set(short, only!.varNs!)
        continue
      }
      const why = short === 'sys' ? 'is the engine\'s' : `is shared by ${recs.map((r) => r.id).join(', ')}`
      for (const r of recs) this.warnOnce(r, `variable prefix "${short}" ${why} — scripts reach this plugin's variables only as "${r.varNs}.<name>"`)
    }
    this.engine.setVarPrefixes(aliases, live.map((r) => r.varNs!))
  }

  /** The slice shape version: the module's, else the manifest's, else 1. */
  private stateVersion(rec: Rec): number {
    return rec.module.stateVersion ?? manifestStateVersion(rec.manifest) ?? 1
  }

  /** The plugins the loaded script package carries (`nilvn.json` `plugins[]`
   *  entries with an `entry`), replacing any earlier package's. */
  setCarried(list: { id: string; entry?: string }[]): void {
    this.packageSources.clear()
    for (const p of list) if (p.entry !== undefined) this.packageSources.set(this.resolveId(p.id), p.entry)
  }

  // ---- internals ----

  private safeSlice(rec: Rec): unknown {
    try {
      return rec.module.saveState?.(rec.ctx!)
    } catch (err) {
      this.engine.report({ phase: 'plugin', plugin: rec.id, message: `saveState failed: ${errMsg(err)}`, error: err })
      return undefined
    }
  }

  /** The runtime checks for a module registered without a manifest. */
  private moduleProblems(mod: EnginePlugin): string[] {
    const out: string[] = []
    for (const [dep, range] of Object.entries(mod.dependencies ?? {})) {
      if (!isPluginId(dep)) out.push(`invalid dependency id "${dep}"`)
      if (!isValidRange(range)) out.push(`invalid range "${range}" for dependency "${dep}"`)
    }
    return out
  }

  /** A privileged context for the engine's own built-in commands: every engine
   *  capability, never disposed. Built-ins are engine code — they also hold the
   *  engine itself through BuiltinContext; this only makes `ctx.plugin` uniform. */
  rootContext(): PluginContext {
    const rec: Rec = {
      id: 'app.nilvn.engine',
      module: { id: 'app.nilvn.engine' },
      packageStyles: [],
      pinned: true,
      granted: new Set(ENGINE_CAPABILITIES),
      state: 'active',
      ctx: null,
      disposers: [],
      failures: 0,
      activating: null,
      warned: new Set(),
      commandNames: new Set(),
      order: 0,
    }
    return this.makeContext(rec, [...ENGINE_CAPABILITIES])
  }

  private block(rec: Rec, why: string): void {
    rec.state = 'blocked'
    this.engine.report({ phase: 'plugin', plugin: rec.id, message: `not activated: ${why}` })
  }

  private isolate(rec: Rec, why: string, error?: unknown): void {
    if (rec.state === 'isolated') return
    rec.state = 'isolated'
    if (!this.isolatedList.includes(rec.id)) this.isolatedList.push(rec.id)
    this.engine.report({ phase: 'plugin', plugin: rec.id, message: why, error })
  }

  private missing(name: string, message: string, error?: unknown): void {
    if (!this.missingList.includes(name)) this.missingList.push(name)
    this.engine.report({ phase: 'plugin', plugin: name, message, error })
  }

  private warnOnce(rec: Rec, message: string): void {
    if (rec.warned.has(message)) return
    rec.warned.add(message)
    this.engine.report({ phase: 'plugin', plugin: rec.id, message })
  }

  /** `[use ./x/plugin.json]`: a plugin package by URL; its files resolve
   *  relative to the plugin.json. */
  private async loadPackage(name: string): Promise<void> {
    const abs = this.engine.resolve(name)
    try {
      const id = await this.install(abs, (rel) => new URL(rel, abs).href, { reloadable: true })
      if (id) this.loadedFrom(name, id)
    } catch (err) {
      this.missing(name, `plugin package "${name}" (${abs}) failed to load: ${errMsg(err)}`, err)
    }
  }

  /** A plugin the script package carries: every file of it sits in the
   *  package's by-ref asset table under the plugin.json's directory, so each
   *  package form serves it through the URL its loader already minted (static,
   *  blob, data or `nvpk:`) — imported as is, never re-minted. */
  private async loadCarried(id: string, entry: string): Promise<void> {
    try {
      if (!isPluginRelPath(entry)) throw new Error(`entry "${entry}" is not a path inside the package`)
      const ref = normalizePluginPath(entry)
      const dir = ref.slice(0, ref.lastIndexOf('/') + 1)
      const file = (rel: string): string | undefined => (isPluginRelPath(rel) ? this.engine.packageAssetUrl(dir + normalizePluginPath(rel)) : undefined)
      const manifestUrl = this.engine.packageAssetUrl(ref)
      if (!manifestUrl) throw new Error(`"${ref}" is not in the package's asset table`)
      await this.install(manifestUrl, file, { expectId: id, reloadable: false })
    } catch (err) {
      this.missing(id, `carried plugin "${id}" failed to load: ${errMsg(err)}`, err)
    }
  }

  /** Fetch + validate a plugin.json, import its engine module, fetch its
   *  stylesheets, register and activate. `file` maps a plugin.json-relative path
   *  to a URL (undefined = not available). Throws for the caller to report. */
  private async install(manifestUrl: string, file: (rel: string) => string | undefined, opts: { expectId?: string; reloadable: boolean }): Promise<string | undefined> {
    const raw = await this.loader.fetchManifest(manifestUrl)
    if (this.dead) return
    if (!isPluginManifest(raw)) throw new Error('not a plugin manifest (needs id / name / version)')
    if (opts.expectId && raw.id !== opts.expectId) throw new Error(`plugin.json id "${raw.id}" does not match the package entry "${opts.expectId}"`)
    const problems = manifestProblems(raw)
    if (problems.length) throw new Error(problems.join('; '))
    if (!raw.entries?.engine) {
      this.engine.report({ phase: 'plugin', plugin: raw.id, message: `plugin "${raw.id}" has no engine half — nothing to run` })
      return
    }
    const entryUrl = file(raw.entries.engine)
    if (!entryUrl) throw new Error(`engine entry "${raw.entries.engine}" is not available`)
    const mod = (await this.loader.importModule(entryUrl)) as { default?: EnginePlugin }
    if (this.dead) return
    const plugin = mod.default
    if (!plugin?.id) throw new Error('not a plugin module (needs a default export with an id)')
    if (plugin.id !== raw.id) throw new Error(`module id "${plugin.id}" does not match plugin.json id "${raw.id}"`)
    const rec = this.register(plugin, { manifest: raw, url: opts.reloadable ? entryUrl : undefined })
    if (!rec) return
    rec.assetBase = file
    rec.packageStyles = []
    for (const rel of raw.styles ?? []) {
      try {
        const url = file(rel)
        if (!url) throw new Error('not available')
        const text = this.loader.fetchText ? await this.loader.fetchText(url) : await (await fetch(url)).text()
        rec.packageStyles.push(text)
      } catch (err) {
        this.engine.report({ phase: 'plugin', plugin: raw.id, message: `stylesheet "${rel}" failed to load: ${errMsg(err)}`, error: err })
      }
    }
    if (this.dead) return
    this.activate(rec.id)
    await this.settle(rec.id)
    return rec.id
  }

  /** A path that loaded now names its plugin: a second `[use]` of it (or
   *  `enablePlugin(path)`) re-activates by id instead of importing again, and a
   *  failure recorded for it earlier is cleared. */
  private loadedFrom(name: string, id: string): void {
    if (name !== id) this.aliases.set(name, id)
    const i = this.missingList.indexOf(name)
    if (i >= 0) this.missingList.splice(i, 1)
  }

  private async loadModule(name: string): Promise<void> {
    const url = this.engine.resolve(name)
    try {
      const mod = (await this.loader.importModule(url)) as { default?: EnginePlugin }
      if (this.dead) return
      const plugin = mod.default
      if (!plugin?.id) throw new Error('not a plugin module (needs a default export with an id)')
      const rec = this.register(plugin, { url })
      if (!rec) return
      rec.assetBase = (rel) => new URL(rel, url).href
      this.loadedFrom(name, rec.id)
      this.activate(rec.id)
      await this.settle(rec.id)
    } catch (err) {
      this.missing(name, `plugin module "${name}" (${url}) failed to load: ${errMsg(err)}`, err)
    }
  }

  private makeContext(rec: Rec, permissions: Permission[]): PluginContext {
    const engine = this.engine
    const capHost: CapHost = {
      id: rec.id,
      granted: rec.granted,
      dispose: (fn) => rec.disposers.push(fn),
      warn: (message) => this.warnOnce(rec, message),
      varNs: rec.varNs ?? '',
    }
    const caps = makeCapabilities(engine, capHost)
    let styleSeq = 0
    const messages = rec.manifest?.messages
    const ctx: PluginContext = {
      id: rec.id,
      permissions,
      get lang() {
        return engine.lang
      },
      get session() {
        return engine.session
      },
      get actors() {
        return engine.actors
      },
      resolve: (p) => engine.resolve(p),
      asset: (path) => this.assetUrl(rec, path),
      t: (id, params) => {
        // The author's [strings.<lang>] win, so a work can rename a plugin's text;
        // then the plugin's own messages; then the engine catalog (→ the id itself).
        const own = engine.messages[engine.lang]?.[id] ?? messages?.[engine.lang]?.[id] ?? messages?.en?.[id]
        if (own === undefined) return engine.t(id, params)
        return params ? own.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : own
      },
      report: (message, error) => engine.report({ phase: 'plugin', plugin: rec.id, message, error }),
      theme: {
        get: (token) => engine.theme[token],
        all: () => engine.theme,
        onChange: (fn) => {
          const off = engine.onThemeChange(fn)
          rec.disposers.push(off)
          return off
        },
      },
      config: {
        get: <T,>(key: string) => engine.pluginConfigValue(rec.id, key) as T | undefined,
        all: () => engine.pluginConfigAll(rec.id),
        onChange: (fn) => {
          const off = engine.onPluginConfigChange(rec.id, fn)
          rec.disposers.push(off)
          return off
        },
      },
      actorField: (actorId, key) => engine.actorField(actorId, rec.id, key),
      services: {
        provide: (id, api) => this.provideService(rec, id, api),
        get: <T extends object>(pluginId: string, serviceId: string, range?: string) => this.serviceFor(rec, pluginId, serviceId, range) as T | undefined,
      },
      listen: (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts)
        const off = (): void => target.removeEventListener(type, fn, opts)
        rec.disposers.push(off)
        return off
      },
      onDispose: (fn) => rec.disposers.push(fn),
      registerCommand: (name, fn) => this.add(this.commands, rec, 'command', name, fn),
      registerTextEffect: (name, fn) => this.add(this.textEffects, rec, 'text effect', name, fn),
      registerEffect: (name, def) => this.add(this.effects, rec, 'effect', name, def),
      registerKind: (decl) => {
        const { kind, unknown } = resolveKind(decl)
        for (const ch of unknown) this.warnOnce(rec, `object kind "${kind.id}" names an unknown standard channel "${ch}" — dropped`)
        const prev = this.kinds.get(kind.id)
        if (prev && prev.owner !== rec.id) this.warnOnce(rec, `object kind "${kind.id}" already provided by ${prev.owner ?? 'the engine'} — overridden`)
        this.kinds.set(kind.id, { kind, owner: rec.id })
        rec.disposers.push(() => {
          if (this.kinds.get(kind.id)?.owner === rec.id) this.kinds.delete(kind.id)
        })
      },
      on: (hook, fn) => {
        const list = this.hooks.get(hook) ?? []
        this.hooks.set(hook, list)
        const entry: HookEntry = { fn: fn as (...args: unknown[]) => void, owner: rec.id }
        list.push(entry)
        const off = (): void => {
          const i = list.indexOf(entry)
          if (i >= 0) list.splice(i, 1)
        }
        rec.disposers.push(off)
        return off
      },
      addStyle: (css) => {
        const id = `nilvn-plugin-${this.token}-${rec.id}-${styleSeq++}`
        engine.stage.injectStyle(css, id, { 'data-plugin': rec.id })
        rec.disposers.push(() => engine.stage.removeStyle(id))
      },
      ...caps,
    }
    return ctx
  }

  /** Whether a registered plugin declares theme token `name` (so a work's
   *  `[theme]` may set it before the plugin is active). */
  declaresThemeToken(name: string): boolean {
    for (const rec of this.recs.values()) if ((rec.manifest?.contributes?.themeTokens ?? rec.module.themeTokens ?? []).some((t) => t?.name === name)) return true
    return false
  }

  /** A plugin's own theme tokens: their defaults go on the stage root as a
   *  stylesheet (the base / script layers still override them), released with
   *  the plugin. */
  private addThemeTokens(rec: Rec, ctx: PluginContext): void {
    const tokens = rec.manifest?.contributes?.themeTokens ?? rec.module.themeTokens ?? []
    if (!tokens.length) return
    const prefix = themeTokenPrefix(rec.id)
    const decls: string[] = []
    for (const t of tokens) {
      const name = t?.name
      if (typeof name !== 'string' || !THEME_TOKEN_RE.test(name) || !name.startsWith(prefix) || name === prefix) {
        this.warnOnce(rec, `theme token "${String(name)}" must be lower-case words starting with "${prefix}" — skipped`)
        continue
      }
      if (isThemeToken(name)) {
        this.warnOnce(rec, `theme token "${name}" is the engine's own — skipped`)
        continue
      }
      const owner = this.themeTokenOwners.get(name)
      if (owner && owner !== rec.id) {
        this.warnOnce(rec, `theme token "${name}" is already declared by ${owner} — skipped`)
        continue
      }
      if (typeof t.default !== 'string' || !t.default.trim() || /[;{}]/.test(t.default)) {
        this.warnOnce(rec, `theme token "${name}": default must be one CSS value — skipped`)
        continue
      }
      this.themeTokenOwners.set(name, rec.id)
      rec.disposers.push(() => {
        if (this.themeTokenOwners.get(name) === rec.id) this.themeTokenOwners.delete(name)
      })
      decls.push(`${themeVar(name)}:${t.default}`)
    }
    if (decls.length) ctx.addStyle(`.nilvn-root{${decls.join(';')}}`)
  }

  /** `ctx.services.provide`: register a declared service under this plugin. */
  private provideService(rec: Rec, id: string, api: Record<string, (...args: never[]) => unknown>): () => void {
    const decl = (rec.manifest?.contributes?.services ?? rec.module.services ?? []).find((s) => s?.id === id)
    if (!decl) {
      this.warnOnce(rec, `service "${id}" is not declared in contributes.services — not provided`)
      return () => {}
    }
    const fns: Record<string, (...args: unknown[]) => unknown> = {}
    for (const [name, fn] of Object.entries(api ?? {})) {
      if (typeof fn === 'function') fns[name] = fn as (...args: unknown[]) => unknown
      else this.warnOnce(rec, `service "${id}": "${name}" is not a function — left out`)
    }
    const key = serviceKey(rec.id, id)
    const entry: ServiceEntry = { owner: rec.id, version: decl.version, api: fns }
    this.services.set(key, entry)
    const off = (): void => {
      if (this.services.get(key) === entry) this.services.delete(key)
    }
    rec.disposers.push(off)
    return off
  }

  /** `ctx.services.get`: a late-bound, structured-cloning stub of another
   *  plugin's service (each call reaches whatever the provider offers now). */
  private serviceFor(rec: Rec, pluginId: string, serviceId: string, range?: string): Record<string, (...args: unknown[]) => Promise<unknown>> | undefined {
    const target = this.resolveId(pluginId)
    const deps = rec.manifest?.dependencies ?? rec.module.dependencies ?? {}
    if (!Object.prototype.hasOwnProperty.call(deps, target)) {
      this.warnOnce(rec, `service "${serviceId}" of ${target}: list "${target}" in dependencies to use its services`)
      return undefined
    }
    if (range !== undefined && !isValidRange(range)) {
      this.warnOnce(rec, `service "${serviceId}" of ${target}: invalid range "${range}"`)
      return undefined
    }
    const key = serviceKey(target, serviceId)
    const entry = this.services.get(key)
    if (!entry) return undefined
    if (range !== undefined && !satisfiesRange(entry.version, range)) {
      this.warnOnce(rec, `service "${serviceId}" of ${target} is ${entry.version}, needs ${range}`)
      return undefined
    }
    const stub: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const name of Object.keys(entry.api)) {
      stub[name] = async (...args: unknown[]): Promise<unknown> => {
        const fn = this.services.get(key)?.api[name]
        if (!fn) throw new Error(`service "${serviceId}" of ${target} is no longer available`)
        return structuredClone(await fn(...structuredClone(args)))
      }
    }
    return Object.freeze(stub)
  }

  /** `ctx.asset(path)`: a listed file of the plugin's own, by its location. */
  private assetUrl(rec: Rec, path: string): string | undefined {
    if (!isPluginRelPath(path)) {
      this.warnOnce(rec, `asset "${path}" is not a path inside the plugin (relative, no "..")`)
      return undefined
    }
    const norm = normalizePluginPath(path)
    if (rec.manifest && !(rec.manifest.assets ?? []).some((a) => normalizePluginPath(a) === norm)) {
      this.warnOnce(rec, `asset "${path}" is not listed in plugin.json "assets" — an exported work would not carry it`)
      return undefined
    }
    const url = rec.assetBase?.(norm)
    if (url === undefined) this.warnOnce(rec, rec.assetBase ? `asset "${path}" is missing from the package` : `asset "${path}": this plugin was registered by the host and has no location to resolve files from`)
    return url
  }

  private add<T>(map: Map<string, Owned<T>>, rec: Rec, what: string, name: string, value: T): void {
    const prev = map.get(name)
    if (prev && prev.owner !== rec.id) this.warnOnce(rec, `${what} "${name}" already provided by ${prev.owner} — overridden`)
    map.set(name, { value, owner: rec.id })
    if (what === 'command') rec.commandNames.add(name)
    rec.disposers.push(() => {
      if (map.get(name)?.owner === rec.id) map.delete(name)
    })
  }
}
