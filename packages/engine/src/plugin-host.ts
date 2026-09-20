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
import { engineGrantable, firstPartyShortName, isPluginId, isPluginManifest, manifestProblems, matchPermission } from './plugin-manifest.js'
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
      if (this.missingList.includes(name)) continue
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

  /** Every active plugin's `saveState` slice (needs `save.slice`), keyed by id. */
  saveSlices(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const id of this.activeIds()) {
      const rec = this.recs.get(id)!
      if (rec.state !== 'active' || !rec.ctx || !rec.granted.has('save.slice')) continue
      const slice = this.safeSlice(rec)
      if (slice !== undefined) out[id] = slice
    }
    return out
  }

  /** Hand a slice to its active owner (`key` may be a legacy short name).
   *  Returns false when no active plugin claims it. */
  restoreSlice(key: string, data: unknown): boolean {
    const rec = this.recs.get(this.resolveId(key))
    if (!rec || rec.state !== 'active' || !rec.ctx || !rec.granted.has('save.slice') || !rec.module.restoreState) return false
    try {
      rec.module.restoreState(rec.ctx, data)
    } catch (err) {
      this.engine.report({ phase: 'plugin', plugin: rec.id, message: `restoreState failed: ${errMsg(err)}`, error: err })
    }
    return true
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

  private async loadPackage(name: string): Promise<void> {
    const abs = this.engine.resolve(name)
    try {
      const raw = await this.loader.fetchManifest(abs)
      if (this.dead) return
      if (!isPluginManifest(raw)) throw new Error('not a plugin manifest (needs id / name / version)')
      const problems = manifestProblems(raw)
      if (problems.length) throw new Error(problems.join('; '))
      if (!raw.entries?.engine) {
        this.engine.report({ phase: 'plugin', plugin: raw.id, message: `plugin "${raw.id}" has no engine half — nothing to run` })
        return
      }
      const entryUrl = new URL(raw.entries.engine, abs).href
      const mod = (await this.loader.importModule(entryUrl)) as { default?: EnginePlugin }
      if (this.dead) return
      const plugin = mod.default
      if (!plugin?.id) throw new Error('not a plugin module (needs a default export with an id)')
      if (plugin.id !== raw.id) throw new Error(`module id "${plugin.id}" does not match plugin.json id "${raw.id}"`)
      const rec = this.register(plugin, { manifest: raw, url: entryUrl })
      if (!rec) return
      rec.packageStyles = []
      for (const rel of raw.styles ?? []) {
        try {
          const text = this.loader.fetchText ? await this.loader.fetchText(new URL(rel, abs).href) : await (await fetch(new URL(rel, abs).href)).text()
          rec.packageStyles.push(text)
        } catch (err) {
          this.engine.report({ phase: 'plugin', plugin: raw.id, message: `stylesheet "${rel}" failed to load: ${errMsg(err)}`, error: err })
        }
      }
      if (this.dead) return
      this.activate(rec.id)
      await this.settle(rec.id)
    } catch (err) {
      this.missing(name, `plugin package "${name}" failed to load: ${errMsg(err)}`, err)
    }
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
      this.activate(rec.id)
      await this.settle(rec.id)
    } catch (err) {
      this.missing(name, `plugin module "${name}" failed to load: ${errMsg(err)}`, err)
    }
  }

  private makeContext(rec: Rec, permissions: Permission[]): PluginContext {
    const engine = this.engine
    const capHost: CapHost = {
      id: rec.id,
      granted: rec.granted,
      dispose: (fn) => rec.disposers.push(fn),
      warn: (message) => this.warnOnce(rec, message),
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
      get actors() {
        return engine.actors
      },
      resolve: (p) => engine.resolve(p),
      t: (id, params) => {
        const own = messages?.[engine.lang]?.[id] ?? messages?.en?.[id]
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
