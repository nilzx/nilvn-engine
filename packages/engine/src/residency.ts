// ChunkResidency — chunked-streaming residency for the engine, split out
// of engine.ts: which script chunks are merged into the node
// array, their base indices / lengths (append-only layout, holes on eviction),
// the LRU + warm-set eviction policy, background prefetch of successors, and the
// per-language text slices. The engine owns the node/label/catalog tables; this
// module mutates them through the host and never runs a script itself.

import type { ChunkManifest, ContentLoader, ScriptChunk } from '@nilvn/core'
import { parseScript } from './parser.js'
import type { ParseDiagnostic } from './parser.js'
import type { EngineDiagnostic, ScriptNode } from './types.js'

/** Sentinel written into an evicted chunk's node slots so the array length (and
 *  thus every downstream index) is preserved while its `ScriptNode` objects — the
 *  real memory — are freed. The run loop re-materializes the owning chunk on the
 *  step that would dereference a hole. */
export const HOLE = { type: '__evicted__' } as unknown as ScriptNode

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface ResidencyHost {
  /** The live node array (mutated in place: appended to, holes written). */
  nodes(): ScriptNode[]
  /** The live label → index table (merged into). */
  labels(): Record<string, number>
  /** The live catalogs, lang → key → text (slices merged into). */
  catalogs(): Record<string, Record<string, string>>
  /** Current content language (the slice loaded with a chunk). */
  lang(): string
  /** Play-session generation; a merge is dropped when it moved on mid-fetch. */
  generation(): number
  destroyed(): boolean
  /** Playhead / resume indices — the chunks owning them are never evicted. */
  pos(): number
  resumeIndex(): number
  /** A chunk's nodes were parsed (the entry chunk carries the [replaydef] preamble). */
  onParsed(nodes: ScriptNode[], diagnostics: ParseDiagnostic[], chunkId: string): void
  report(info: EngineDiagnostic, once?: boolean): void
}

export class ChunkResidency {
  /** Chunked-play manifest + byte loader. Both undefined ⇒ non-chunked play: the
   *  whole script is already in the node array and every method is a no-op. */
  manifest?: ChunkManifest
  loader?: ContentLoader
  /** Max chunks kept resident when set (opt-in via `maxResidentChunks`); undefined ⇒
   *  no ceiling, every visited chunk stays resident (append-only). */
  maxResidentChunks?: number

  /** Chunk ids currently merged into the node array. Append-only without a memory
   *  ceiling; with `maxResidentChunks` set, eviction removes ids here while their
   *  base/len/labels persist for in-place re-materialization. */
  residentChunks = new Set<string>()
  /** Chunk id → the base node index its nodes were appended at (its labels sit at
   *  `base + local`). Base indices never move (append-only) — eviction only nulls a
   *  chunk's node OBJECTS in place, so a revisit re-parses back into the same slots
   *  and every emitted index / label value stays valid. */
  chunkBase = new Map<string, number>()
  /** Chunk id → its node count, so a hole index maps back to its owning chunk
   *  ({@link chunkOwning}) and an in-place re-merge can assert the length matches. */
  chunkLen = new Map<string, number>()
  /** Resident chunk ids in least-recently-merged → most-recent order; the eviction
   *  policy drops from the front (oldest) first. Only tracks currently-resident ids
   *  (an evicted chunk leaves the list; a revisit re-appends it). */
  residentLru: string[] = []
  /** In-flight chunk merges keyed by chunk id, so concurrent `ensureLoaded` calls
   *  for the same chunk share one fetch+merge instead of racing/duplicating it. */
  private inflight = new Map<string, Promise<void>>()
  /** Id of the chunk whose nodes sit at the physical END of the node array (the last
   *  merged). Running off that end continues into ITS fall-through successor
   *  (`ManifestChunk.next`) — that's the chunk to load at a boundary. */
  tailChunk?: string
  /** Prefetched-but-not-merged chunk decodes, keyed by chunk id.
   *  Staging only — merging ahead of demand would append chunks out of story
   *  order, and physical adjacency IS the fall-through semantics. Demand
   *  ({@link ensureChunkScript}) consumes an entry synchronously, paying zero
   *  fetch latency at the chunk boundary. */
  prefetched = new Map<string, ScriptChunk>()
  /** In-flight background prefetches keyed by chunk id, so a demand load can
   *  piggyback on one instead of double-fetching. */
  private prefetchInflight = new Map<string, Promise<void>>()
  /** The successor set (`next` + `branchTargets`) of the most recently entered
   *  chunk — the only ids worth staging. Play moving on retires stale entries. */
  prefetchHints = new Set<string>()
  /** Locale slices already merged into the catalogs, keyed `${lang} ${id}`,
   *  so a chunk's text is fetched at most once per language. */
  residentLocales = new Set<string>()
  /** In-flight locale-slice loads, same keying, so concurrent chunk entries share
   *  one fetch+merge instead of racing. */
  private localeInflight = new Map<string, Promise<void>>()

  constructor(private readonly host: ResidencyHost) {}

  /** Chunked play is opt-in: only when BOTH a manifest and a loader are supplied (a
   *  manifest with no loader has no byte source, so treat it as non-chunked). */
  attach(manifest: ChunkManifest | undefined, loader: ContentLoader | undefined, maxResidentChunks?: number): void {
    if (manifest && loader) {
      this.manifest = manifest
      this.loader = loader
    }
    // Memory ceiling is opt-in: undefined ⇒ append-only, never
    // evict (byte-identical to a plain merge). A positive value caps resident chunks.
    if (typeof maxResidentChunks === 'number' && maxResidentChunks > 0) this.maxResidentChunks = Math.floor(maxResidentChunks)
  }

  get active(): boolean {
    return !!this.manifest && !!this.loader
  }

  /** Forget every resident / staged chunk (a new package replaces the old). */
  reset(): void {
    this.residentChunks.clear()
    this.chunkBase.clear()
    this.chunkLen.clear()
    this.residentLru.length = 0
    this.tailChunk = undefined
    this.prefetched.clear()
    this.prefetchHints.clear()
    this.residentLocales.clear()
  }

  /** Ensure the chunk that DEFINES `label` is fully resident (script + current-
   *  language text) before a jump / start / restore resolves it. No-op for
   *  non-chunked play — the whole script is already in the node array. */
  async ensureLoaded(label: string): Promise<void> {
    const manifest = this.manifest
    if (!manifest || !this.loader) return
    const chunkId = manifest.labelIndex[label]
    if (chunkId === undefined) return
    await this.ensureChunk(chunkId)
  }

  /** Make a chunk fully resident: its script nodes/labels AND its text slice for
   *  the current language (so this chunk's say/choice keys resolve). Callers await
   *  this before running into the chunk or resolving a save address. Idempotent;
   *  a no-op when everything is already resident. */
  async ensureChunk(chunkId: string): Promise<void> {
    await this.ensureChunkScript(chunkId)
    if (this.host.destroyed()) return
    // A text slice that fails to load must not keep the chunk from playing: its
    // keys fall back to the default language (a later switch / entry retries).
    const lang = this.host.lang()
    try {
      await this.ensureLocale(chunkId, lang)
    } catch (err) {
      this.host.report({ phase: 'load', chunk: chunkId, message: `text (${lang}) for scene "${chunkId}" failed to load: ${errMsg(err)}`, error: err }, true)
    }
    this.schedulePrefetch(chunkId)
  }

  /** Fetch every RESIDENT chunk's text slice for `lang`, so its
   *  keys resolve after a language switch / cross-language restore. Best-effort
   *  per slice: a failed fetch keeps the default-language fallback for that chunk
   *  rather than failing the switch. */
  ensureResidentLocales(lang: string): Promise<void> {
    if (!this.active) return Promise.resolve()
    const pending: Promise<void>[] = []
    for (const id of this.residentChunks) pending.push(this.ensureLocale(id, lang).catch(() => {}))
    return Promise.all(pending).then(() => {})
  }

  /** Background-prefetch the entered chunk's successors (`next` + `branchTargets`,
   *  prefetch). Fetch + decode only — results are STAGED in {@link prefetched},
   *  never merged: merging ahead of demand would append chunks out of story order,
   *  and physical adjacency IS the fall-through semantics. The current language's
   *  text slice is warmed too (catalog merges are cumulative and order-free, so
   *  those may land fully). Best-effort: a failed prefetch is dropped and the
   *  on-demand path fetches as before. */
  private schedulePrefetch(fromId: string): void {
    const manifest = this.manifest
    const loader = this.loader
    if (!manifest || !loader || this.host.destroyed()) return
    const from = manifest.chunks.find((c) => c.id === fromId)
    if (!from) return
    this.prefetchHints = new Set([...from.next, ...from.branchTargets])
    // Keep the stage bounded: entries play moved away from re-fetch on demand.
    for (const id of [...this.prefetched.keys()]) if (!this.prefetchHints.has(id)) this.prefetched.delete(id)
    for (const id of this.prefetchHints) {
      if (this.residentChunks.has(id) || this.prefetched.has(id)) continue
      if (this.inflight.has(id) || this.prefetchInflight.has(id)) continue
      const p = (async () => {
        try {
          const chunk = await loader.loadChunk(id)
          // Stage only while still wanted: not resident meanwhile (a demand load
          // won the race) and still in the CURRENT hint set (play moved on).
          if (this.host.destroyed() || this.residentChunks.has(id)) return
          if (this.prefetchHints.has(id)) this.prefetched.set(id, chunk)
        } catch {
          // best-effort — ensureChunkScript's demand path retries with real errors
        }
      })()
      void p.finally(() => {
        if (this.prefetchInflight.get(id) === p) this.prefetchInflight.delete(id)
      })
      this.prefetchInflight.set(id, p)
      void this.ensureLocale(id, this.host.lang()).catch(() => {})
    }
  }

  /** Fetch + merge one chunk's SCRIPT by id, deduping concurrent loads (`inflight`)
   *  and dropping the merge if the session advanced during the fetch (a `generation`
   *  bump from load/restore/destroy). Idempotent: a resident chunk resolves at once. */
  private ensureChunkScript(chunkId: string): Promise<void> {
    const loader = this.loader
    if (!loader || this.residentChunks.has(chunkId)) return Promise.resolve()
    // Prefetched ahead: merge the staged decode synchronously —
    // residency stays demand-driven, the prefetch only paid the fetch early.
    const staged = this.prefetched.get(chunkId)
    if (staged) {
      this.prefetched.delete(chunkId)
      this.mergeChunk(staged)
      return Promise.resolve()
    }
    // A prefetch of this very chunk is mid-flight: piggyback on it, then consume
    // its staged result (or fall through to a real load if it failed). Same
    // post-await drop rule as the load path below: a generation bump during the
    // wait means nobody wants the merge anymore.
    const pre = this.prefetchInflight.get(chunkId)
    if (pre) {
      const gen = this.host.generation()
      return pre.then(() => {
        if (this.host.destroyed() || gen !== this.host.generation()) return
        return this.ensureChunkScript(chunkId)
      })
    }
    let pending = this.inflight.get(chunkId)
    if (!pending) {
      const gen = this.host.generation()
      pending = (async () => {
        const chunk = await loader.loadChunk(chunkId)
        // Session moved on during the fetch (new load / restore / destroy): drop the
        // result rather than merge into a generation that didn't ask for it.
        if (this.host.destroyed() || gen !== this.host.generation()) return
        this.mergeChunk(chunk)
      })()
      // Free the slot once settled (success OR failure) so a failed load can retry
      // and a later ensureChunk never awaits a dead promise. The derived chain gets
      // its own catch: the awaiting caller handles the rejection on `pending`
      // itself, and this bookkeeping branch must not surface it a second time as
      // an unhandled rejection.
      void pending
        .finally(() => {
          if (this.inflight.get(chunkId) === pending) this.inflight.delete(chunkId)
        })
        .catch(() => {})
      this.inflight.set(chunkId, pending)
    }
    return pending
  }

  /** Fetch + merge a chunk's text slice for `lang` into the catalogs, so the
   *  engine's `resolveText` finds this chunk's keys. Deduped + idempotent per
   *  (lang, slice). A no-op when the manifest ships no slice for this pair.
   *  Merging is cumulative, not session-scoped (a restore never clears catalogs),
   *  so it needs no generation guard. The always-warm `base` slice loads with the
   *  package; per-chunk slices load here as their chunk becomes resident. */
  ensureLocale(sliceId: string, lang: string): Promise<void> {
    const loader = this.loader
    const manifest = this.manifest
    if (!loader || !manifest) return Promise.resolve()
    const key = `${lang} ${sliceId}`
    if (this.residentLocales.has(key)) return Promise.resolve()
    if (!manifest.locales[lang]?.some((s) => s.id === sliceId)) return Promise.resolve()
    let pending = this.localeInflight.get(key)
    if (!pending) {
      pending = (async () => {
        const slice = await loader.loadLocale(lang, sliceId)
        const catalogs = this.host.catalogs()
        const cat = (catalogs[lang] ??= {})
        for (const k in slice) cat[k] = slice[k]!
        this.residentLocales.add(key)
      })()
      void pending
        .finally(() => {
          if (this.localeInflight.get(key) === pending) this.localeInflight.delete(key)
        })
        .catch(() => {}) // same as the chunk path: the caller owns the rejection
      this.localeInflight.set(key, pending)
    }
    return pending
  }

  /** Make a decoded chunk resident. First visit: append its nodes at the end of
   *  the node array and merge its labels at that base (`labels[name] = base + local`).
   *  Revisit after an eviction: re-parse back into the SAME slots the chunk
   *  first occupied — same body ⇒ same parse ⇒ same length — so base indices never
   *  move and `addressOf`/`resolveAddress`/saved playheads stay valid. Labels are
   *  globally unique (the producer asserts it), so a merged label maps 1:1.
   *  Synchronous + idempotent per chunk id; touches the LRU and may evict. */
  mergeChunk(chunk: ScriptChunk): void {
    if (this.residentChunks.has(chunk.id)) return
    const parsed = parseScript(chunk.body)
    this.host.onParsed(parsed.nodes, parsed.diagnostics, chunk.id)
    const nodes = this.host.nodes()
    const labels = this.host.labels()

    const existingBase = this.chunkBase.get(chunk.id)
    if (existingBase !== undefined) {
      // Re-materialize an evicted chunk in place. Its labels were never deleted, so
      // addressing already points at existingBase+local; re-write is idempotent.
      // A correct loader returns the same body for a chunk id, so the re-parse yields
      // the same length it first did (`chunkLen`). Clamp to that reserved span anyway:
      // a misbehaving loader returning a longer body must NOT write past this chunk's
      // slots and clobber the next chunk (defence-in-depth on the append-only layout).
      const len = this.chunkLen.get(chunk.id) ?? parsed.nodes.length
      if (parsed.nodes.length !== len) {
        console.error(`[nilvn] chunk "${chunk.id}" re-parsed to ${parsed.nodes.length} nodes, expected ${len} — clamping to avoid corrupting adjacent chunks`)
      }
      for (let i = 0; i < len; i++) nodes[existingBase + i] = parsed.nodes[i] ?? HOLE
      for (const name in parsed.labels) labels[name] = existingBase + parsed.labels[name]!
    } else {
      const base = nodes.length
      for (const n of parsed.nodes) nodes.push(n)
      for (const name in parsed.labels) labels[name] = base + parsed.labels[name]!
      // A chunk's id names its first node (a script file's stem; a scene chunk
      // already opens with `[label <scene>]`, so this is the same value there).
      if (!(chunk.id in parsed.labels)) labels[chunk.id] = base
      this.chunkBase.set(chunk.id, base)
      this.chunkLen.set(chunk.id, parsed.nodes.length)
      this.tailChunk = chunk.id // its nodes are now at the physical end of the array
    }
    this.residentChunks.add(chunk.id)
    this.touchChunk(chunk.id)
    this.evictIfNeeded(chunk.id)
  }

  /** The resident-OR-evicted chunk whose node range `[base, base+len)` contains
   *  `idx`, or undefined when no chunk owns it (non-chunked play, or off the end).
   *  Evicted chunks keep their base/len so a hole index maps back to its owner and
   *  can be re-materialized. */
  chunkOwning(idx: number): string | undefined {
    for (const [id, base] of this.chunkBase) {
      const len = this.chunkLen.get(id)
      if (len !== undefined && idx >= base && idx < base + len) return id
    }
    return undefined
  }

  /** The chunk to continue in when `idx` is the LAST node of its chunk and play
   *  advanced past it naturally: the chunk's first fall-through successor
   *  (`ManifestChunk.next[0]`), resident or not — a script file's next file.
   *  Undefined mid-chunk, without a manifest, or for a chunk with no successor
   *  (then the physical end of the array decides, see `loadNextChunk`). */
  fallThroughFrom(idx: number): string | undefined {
    if (!this.manifest) return undefined
    const owner = this.chunkOwning(idx)
    if (owner === undefined) return undefined
    const base = this.chunkBase.get(owner)!
    const len = this.chunkLen.get(owner)!
    if (idx !== base + len - 1) return undefined
    return this.manifest.chunks.find((c) => c.id === owner)?.next[0]
  }

  /** Where a resident-or-evicted chunk's nodes start. */
  baseOf(chunkId: string): number | undefined {
    return this.chunkBase.get(chunkId)
  }

  /** Mark a chunk most-recently-used (move to the end of the LRU list). */
  private touchChunk(id: string): void {
    const i = this.residentLru.indexOf(id)
    if (i >= 0) this.residentLru.splice(i, 1)
    this.residentLru.push(id)
  }

  /** Free an evicted chunk's node OBJECTS (the memory hog) by overwriting its slots
   *  with the shared {@link HOLE} sentinel, keeping the array length so every
   *  downstream index stays valid. Base/len/labels are retained for re-materializing.
   *  Also tells the loader: the seam contract makes that safe
   *  without an in-play-asset guard, because `releaseChunk` must never lose
   *  re-resolvability — the Web loader is a no-op (static URLs), and the desktop
   *  player reclaims its native plaintext cache while its protocol URLs keep
   *  re-decrypting on demand, so nothing mid-play can break. */
  evictChunk(id: string): void {
    const base = this.chunkBase.get(id)
    const len = this.chunkLen.get(id)
    if (base === undefined || len === undefined) return
    const nodes = this.host.nodes()
    for (let i = base; i < base + len; i++) nodes[i] = HOLE
    this.residentChunks.delete(id)
    const i = this.residentLru.indexOf(id)
    if (i >= 0) this.residentLru.splice(i, 1)
    this.loader?.releaseChunk(id)
  }

  /** Enforce the `maxResidentChunks` ceiling (opt-in — a no-op when unset).
   *  Never evicts the WARM set — the current chunk plus its fall-through (`next`) and
   *  branch (`branchTargets`) successors — nor the chunk owning the playhead / resume
   *  point / the one just loaded; everything else is dropped least-recently-used
   *  first until the count fits (or only warm chunks remain, so the ceiling is a soft
   *  target, never at the cost of a chunk we provably run into next). */
  private evictIfNeeded(justLoaded?: string): void {
    const budget = this.maxResidentChunks
    const manifest = this.manifest
    if (budget === undefined || !manifest || !this.loader) return
    if (this.residentChunks.size <= budget) return
    const posOwner = this.chunkOwning(this.host.pos())
    const resumeOwner = this.chunkOwning(this.host.resumeIndex())
    const warm = new Set<string>()
    const cur = posOwner ?? resumeOwner
    if (cur !== undefined) {
      warm.add(cur)
      const mc = manifest.chunks.find((c) => c.id === cur)
      if (mc) {
        for (const id of mc.next) warm.add(id)
        for (const id of mc.branchTargets) warm.add(id)
      }
    }
    for (const id of [...this.residentLru]) {
      if (this.residentChunks.size <= budget) break
      if (id === justLoaded || id === posOwner || id === resumeOwner || warm.has(id)) continue
      this.evictChunk(id)
    }
  }

  /** At a chunk boundary (the run loop ran off the PHYSICAL end of the resident
   *  nodes), append the tail chunk's fall-through successor (`ManifestChunk.next`) so
   *  execution continues into it. Only ever appends a NEVER-LOADED successor (one
   *  with no `chunkBase` entry): a successor already somewhere in the array is reached
   *  by physical adjacency instead — if it's evicted-in-place the run loop's hole path
   *  re-materializes it, and if it's simply not physically next then, like a flat
   *  compile, the physical end IS the end. Returns true when new nodes were appended
   *  (keep running), false when there is no unloaded next scene — the script ended, or
   *  it's eager / non-chunked play with everything already resident. */
  async loadNextChunk(): Promise<boolean> {
    const manifest = this.manifest
    if (!manifest || !this.loader || this.tailChunk === undefined) return false
    // Walk the fall-through chain until a successor contributes nodes: a chunk that parses to ZERO nodes — defensive, the producer never
    // emits one — becomes the new tail and ITS `next` is tried, instead of
    // reading as "the script ended". The chain is finite: every visited chunk
    // gains a chunkBase entry and is never re-tried.
    let tailId: string | undefined = this.tailChunk
    while (tailId !== undefined) {
      const tail = manifest.chunks.find((c) => c.id === tailId)
      if (!tail) return false
      const nextId = tail.next.find((id) => this.chunkBase.get(id) === undefined)
      if (nextId === undefined) return false
      const before = this.host.nodes().length
      await this.ensureChunk(nextId)
      // A generation bump during the fetch drops the merge (ensureChunk bails); the
      // caller re-checks generation, so "no new nodes" there means "don't continue".
      // A never-loaded successor always takes mergeChunk's APPEND path, so a successful
      // merge grows the array — the signal stays valid even with eviction in play.
      if (this.host.nodes().length > before) return true
      if (!this.residentChunks.has(nextId)) return false // merge dropped, not empty
      tailId = nextId // an empty chunk: skip through to its own successor
    }
    return false
  }

  /** Let a byte-reclaiming loader free every resident chunk (destroy). */
  releaseAll(): void {
    if (this.loader) for (const id of [...this.residentChunks]) this.loader.releaseChunk(id)
    this.residentChunks.clear()
    this.prefetched.clear()
    this.prefetchHints.clear()
  }
}
