// Test harness for the chunked-streaming runtime. Drives the REAL engine
// source (not the shipped IIFE) in jsdom, through an in-memory ContentLoader — the
// durable form of the batch-5 browser assertions.
import { createEngine, type Engine } from '../src/index'
import type { EngineOptions, EnginePlugin, ScriptNode, Segment } from '../src/types'
import {
  CHUNK_MANIFEST_FORMAT,
  type ChunkManifest,
  type ManifestChunk,
  type ManifestLocaleSlice,
  type ContentLoader,
  type ScriptChunk,
  type TextCatalogSlice,
} from '@nilvn/core'

/** An in-memory ContentLoader that serves pre-built chunk/locale bodies and counts
 *  every call, so tests can assert exactly what was fetched (and how often). */
export class InlineLoader implements ContentLoader {
  loadCalls: string[] = []
  localeCalls: string[] = []
  assetCalls: string[] = []
  releaseCalls: string[] = []
  constructor(
    private chunks: Record<string, ScriptChunk>,
    private locales: Record<string, Record<string, TextCatalogSlice>> = {},
  ) {}
  loadChunk(id: string): Promise<ScriptChunk> {
    this.loadCalls.push(id)
    const c = this.chunks[id]
    return c ? Promise.resolve(c) : Promise.reject(new Error(`no such chunk "${id}"`))
  }
  loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice> {
    this.localeCalls.push(`${lang}/${sliceId}`)
    return Promise.resolve(this.locales[lang]?.[sliceId] ?? {})
  }
  assetUrl(ref: string): Promise<string> {
    this.assetCalls.push(ref)
    return Promise.resolve(`resolved:${ref}`)
  }
  releaseChunk(id: string): void {
    this.releaseCalls.push(id)
  }
}

/** A linear 5-chunk fixture (s1→s2→…→s5) of pure-flow scripts (`[label]`/`[set]`,
 *  NO dialogue) so `start()` runs to completion without parking on a tap. Each chunk
 *  falls through to the next; each has a per-chunk zh locale slice. */
export function makeChunkFixture(): { manifest: ChunkManifest; loader: InlineLoader } {
  const ids = ['s1', 's2', 's3', 's4', 's5']
  const chunks: Record<string, ScriptChunk> = {}
  const locales: Record<string, Record<string, TextCatalogSlice>> = { zh: { base: {} } }
  const manifestChunks: ManifestChunk[] = []
  const labelIndex: Record<string, string> = {}
  const localeSlices: ManifestLocaleSlice[] = [{ id: 'base', scenes: [], url: '', bytes: 0 }]
  ids.forEach((id, i) => {
    chunks[id] = { id, body: `[label ${id}]\n[set x = ${i}]\n`, labels: [id] }
    labelIndex[id] = id
    manifestChunks.push({
      id,
      scenes: [id],
      url: '',
      bytes: 0,
      labels: [id],
      assets: [],
      next: i < ids.length - 1 ? [ids[i + 1]!] : [],
      branchTargets: [],
    })
    locales.zh![id] = { [`k.${id}`]: `text ${id}` }
    localeSlices.push({ id, scenes: [id], url: '', bytes: 0 })
  })
  const manifest: ChunkManifest = {
    format: CHUNK_MANIFEST_FORMAT,
    engine: '0.10.0',
    schemaVersion: 6,
    entry: { label: 's1' },
    defaultLang: 'zh',
    sceneOrder: ids,
    chunks: manifestChunks,
    labelIndex,
    locales: { zh: localeSlices },
    assets: {},
  }
  return { manifest, loader: new InlineLoader(chunks, locales) }
}

/** Create an engine mounted on a fresh jsdom container. Call only from a test file
 *  with a `// @vitest-environment jsdom` pragma (document must exist). */
export function newEngine(opts: Partial<EngineOptions> = {}): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, ...opts })
}

/** A chunked engine wired to the 5-chunk fixture. `maxResidentChunks` opts into the
 *  memory ceiling; omit it for append-only play. */
export function newChunkedEngine(maxResidentChunks?: number): { e: Engine; loader: InlineLoader; manifest: ChunkManifest } {
  const { manifest, loader } = makeChunkFixture()
  const e = newEngine({ manifest, loader, maxResidentChunks, lang: 'zh', defaultLang: 'zh', languages: ['zh'] })
  return { e, loader, manifest }
}

/** One chunk of a hand-shaped fixture (topology under test control — branch
 *  targets, empty bodies, multi-language slices — where makeChunkFixture's
 *  linear zh-only chain doesn't cut it). */
export interface FixtureChunkDef {
  id: string
  /** `.nvn` body. Defaults to `[label <id>]\n[set x = <i>]\n`; pass '' for an
   *  EMPTY chunk (parses to zero nodes — the tail-③ case). */
  body?: string
  next?: string[]
  branchTargets?: string[]
}

/** Build a manifest + InlineLoader from explicit chunk defs. `locales` is
 *  lang → sliceId → slice; every listed slice id gets a manifest entry, so
 *  per-chunk slices exist exactly where the test declares them. */
export function makeFixture(
  defs: FixtureChunkDef[],
  locales: Record<string, Record<string, TextCatalogSlice>> = { zh: { base: {} } },
): { manifest: ChunkManifest; loader: InlineLoader } {
  const chunks: Record<string, ScriptChunk> = {}
  const manifestChunks: ManifestChunk[] = []
  const labelIndex: Record<string, string> = {}
  defs.forEach((d, i) => {
    const body = d.body ?? `[label ${d.id}]\n[set x = ${i}]\n`
    const labels = body.includes(`[label ${d.id}]`) ? [d.id] : []
    chunks[d.id] = { id: d.id, body, labels }
    for (const l of labels) labelIndex[l] = d.id
    manifestChunks.push({
      id: d.id,
      scenes: [d.id],
      url: '',
      bytes: 0,
      labels,
      assets: [],
      next: d.next ?? [],
      branchTargets: d.branchTargets ?? [],
    })
  })
  const manifestLocales: Record<string, ManifestLocaleSlice[]> = {}
  for (const [lang, slices] of Object.entries(locales)) {
    manifestLocales[lang] = Object.keys(slices).map((id) => ({ id, scenes: [], url: '', bytes: 0 }))
  }
  const manifest: ChunkManifest = {
    format: CHUNK_MANIFEST_FORMAT,
    engine: '0.10.0',
    schemaVersion: 6,
    entry: { label: defs[0]!.id },
    defaultLang: 'zh',
    sceneOrder: defs.map((d) => d.id),
    chunks: manifestChunks,
    labelIndex,
    locales: manifestLocales,
    assets: {},
  }
  return { manifest, loader: new InlineLoader(chunks, locales) }
}

/** The engine's chunked-runtime internals, exposed for white-box assertions. These
 *  are `private` in TS (a public API would be wrong), but the test drives them by
 *  real name — the same members the batch-5 browser checks poked at. */
export interface EngineView {
  nodes: ScriptNode[]
  labels: Record<string, number>
  pos: number
  resumeIndex: number
  generation: number
  residentChunks: Set<string>
  chunkBase: Map<string, number>
  chunkLen: Map<string, number>
  residentLru: string[]
  catalogs: Record<string, Record<string, string>>
  prefetched: Map<string, ScriptChunk>
  prefetchHints: Set<string>
  shown: { kind: 'dialogue'; node: { type: string; segments: Segment[]; textKey?: string; line: number } } | null
  stage: { textEl: HTMLElement }
  ensureLoaded(label: string): Promise<void>
  ensureChunk(id: string): Promise<void>
  mergeChunk(c: ScriptChunk): void
  evictChunk(id: string): void
  recordBacklog(speaker: string, segments: Segment[], voiceRef?: string, offset?: number): void
  resetBacklog(): void
}

/** `view(e)` reads engine privates by name; since the batch-A split the chunked
 *  residency state lives on `engine.residency`, so the view falls through to it
 *  (functions bound to whichever object owns them). */
export const view = (e: Engine): EngineView =>
  new Proxy({} as EngineView, {
    get(_t, key) {
      const eng = e as unknown as Record<string, unknown>
      const res = (eng.residency ?? {}) as Record<string, unknown>
      const owner = (key as string) in eng ? eng : res
      const v = owner[key as string]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(owner) : v
    },
    set(_t, key, value) {
      const eng = e as unknown as Record<string, unknown>
      const res = (eng.residency ?? {}) as Record<string, unknown>
      const owner = (key as string) in eng ? eng : res
      owner[key as string] = value
      return true
    },
  })

/** A node is an eviction hole when it's the shared HOLE sentinel (type '__evicted__'). */
export const isHole = (n: ScriptNode): boolean => (n as { type?: string }).type === '__evicted__'

/** First-party-SHAPED fixture plugins (ids under `app.nilvn.`, so they answer to
 *  their short names like the real @nilvn/plugins set does). The engine's own
 *  tests must not depend on the plugins package — these stand in for it wherever
 *  a test needs "a registry plugin with a style / a text effect / a command". */
export function fxFixtures(): { fx: EnginePlugin; cmd: EnginePlugin; plain: EnginePlugin } {
  const fx: EnginePlugin = {
    id: 'app.nilvn.fx',
    permissions: [],
    styles: '.nilvn-ch.tfx-wave.on{animation:tfx-wave 1s infinite}',
    textEffects: { wave: (span) => span.addClass('tfx-wave') },
  }
  const cmd: EnginePlugin = {
    id: 'app.nilvn.cmd',
    permissions: ['vars.write'],
    commands: { mark: ({ plugin, str }) => plugin.vars!.set('mark', str(0, 'set')) },
  }
  const plain: EnginePlugin = { id: 'app.nilvn.plain', permissions: [] }
  return { fx, cmd, plain }
}
