// Hand-written multi-file works (batch I inc 3): `[game] scripts = ["a.nvn",
// "b.nvn"]` plays several `.nvn` files as CHUNKS — the same mechanism a script
// package streams through — so labels are global (a jump or call reaches any
// file), the files fall through in list order, and a save's address names the
// file's chunk. The bodies are fetched up front (a label index needs them) and
// served from memory by `FileScriptLoader`. `[include path]` lines are spliced
// in before parsing (`expandIncludes`), so shared headers — `[actor …]`
// declarations, `[alias …]` — live in one file.
import type { ChunkManifest, ContentLoader, ManifestChunk, ScriptChunk, TextCatalogSlice } from '@nilvn/core'
import { ENGINE_VERSION } from './version.js'
import { CHUNK_FORMAT } from './package.js'

export interface ScriptFile {
  /** Chunk id: the file name without directory and extension. */
  id: string
  /** The file's absolute URL (assets and includes resolve against its directory). */
  url: string
  /** The file's text, includes already spliced in. */
  body: string
}

export interface DuplicateLabel {
  label: string
  /** Chunk ids: where it was defined first, and again. */
  first: string
  second: string
}

/** The chunk id a script file gets: its name without directory and extension. */
export function scriptId(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  return name.replace(/\.[^.]*$/, '').replace(/[?#].*$/, '') || 'script'
}

/** Every `[label name]` a script body defines, in order. */
export function scanLabels(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(/^\s*\[label\s+([^\s\]]+)\s*\]/gm)) out.push(m[1]!)
  return out
}

/** A `ChunkManifest` over script files: one chunk per file, falling through in
 *  order; every label indexed globally (the first definition wins — the
 *  duplicates are returned for the engine to report); each chunk's own id is
 *  indexed too, since a chunk's id names its first node. */
export function buildFileManifest(files: ScriptFile[], defaultLang: string): { manifest: ChunkManifest; duplicates: DuplicateLabel[] } {
  const chunks: ManifestChunk[] = []
  const labelIndex: Record<string, string> = {}
  const duplicates: DuplicateLabel[] = []
  files.forEach((f, i) => {
    const labels = scanLabels(f.body)
    for (const label of [f.id, ...labels]) {
      const owner = labelIndex[label]
      if (owner !== undefined && owner !== f.id) duplicates.push({ label, first: owner, second: f.id })
      else labelIndex[label] = f.id
    }
    chunks.push({
      id: f.id,
      scenes: [],
      url: f.url,
      bytes: f.body.length,
      labels: [f.id, ...labels],
      assets: [],
      next: i < files.length - 1 ? [files[i + 1]!.id] : [],
      branchTargets: [],
    })
  })
  const manifest: ChunkManifest = {
    format: CHUNK_FORMAT,
    engine: ENGINE_VERSION,
    schemaVersion: 0,
    entry: { label: files[0]?.id ?? 'script' },
    defaultLang,
    sceneOrder: files.map((f) => f.id),
    chunks,
    labelIndex,
    locales: {},
    assets: {},
  }
  return { manifest, duplicates }
}

/** Serves script files from memory as chunks. Assets resolve through the
 *  engine's own resolver (aliases, base URL) — the files carry no asset table. */
export class FileScriptLoader implements ContentLoader {
  private readonly bodies = new Map<string, ScriptFile>()
  constructor(
    files: ScriptFile[],
    private readonly resolveAsset: (ref: string) => string,
  ) {
    for (const f of files) this.bodies.set(f.id, f)
  }
  loadChunk(chunkId: string): Promise<ScriptChunk> {
    const f = this.bodies.get(chunkId)
    if (!f) return Promise.reject(new Error(`Unknown script "${chunkId}"`))
    return Promise.resolve({ id: f.id, body: f.body, labels: scanLabels(f.body) })
  }
  loadLocale(): Promise<TextCatalogSlice> {
    return Promise.resolve({})
  }
  assetUrl(ref: string): Promise<string> {
    return Promise.resolve(this.resolveAsset(ref))
  }
  releaseChunk(): void {
    /* nothing to release: the bodies are the source of truth */
  }
}

const INCLUDE_RE = /^\s*\[include\s+(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*\]\s*$/

export interface IncludeHost {
  /** Fetch a file's text by absolute URL. */
  fetchText(url: string): Promise<string>
  /** Turn an include path into an absolute URL: `@alias` paths through the
   *  engine's aliases, everything else relative to the including file. */
  resolve(path: string, fromUrl: string): string
  report(message: string, error?: unknown): void
}

/** Splice `[include path]` lines into `text` (recursively, up to eight levels;
 *  a file that includes itself, directly or through others, is reported and
 *  skipped). Line numbers of what follows an include shift by the included
 *  length — an include is a textual paste, like a C preprocessor's. */
export async function expandIncludes(text: string, fileUrl: string, host: IncludeHost, depth = 0, ancestors: readonly string[] = []): Promise<string> {
  if (!INCLUDE_RE.test(text) && !/^\s*\[include\s/m.test(text)) return text
  const chain = [...ancestors, fileUrl]
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = INCLUDE_RE.exec(line)
    if (!m) {
      out.push(line)
      continue
    }
    const path = m[1] ?? m[2] ?? m[3] ?? ''
    const target = host.resolve(path, fileUrl)
    if (chain.includes(target)) {
      host.report(`[include ${path}] skipped — it includes itself`)
      continue
    }
    if (depth >= 8) {
      host.report(`[include ${path}] skipped — includes nested more than 8 deep`)
      continue
    }
    try {
      const body = await host.fetchText(target)
      // A paste, not a concatenation: the file's own final newline is dropped
      // so an include never adds a blank line.
      out.push((await expandIncludes(body, target, host, depth + 1, chain)).replace(/\r?\n$/, ''))
    } catch (err) {
      host.report(`[include ${path}] failed: ${err instanceof Error ? err.message : String(err)}`, err)
    }
  }
  return out.join('\n')
}
