// Script package (.nvs) — the engine's one load entry. A package is `nilvn.json` (the PackageManifest: work metadata +
// actors + enabled plugins + languages + the embedded chunk manifest) next to the
// chunk / locale / asset files the chunk manifest indexes. It comes in three
// physical forms, each behind the same ContentLoader seam:
//
//   directory  — static hosting / a ZIP the author unpacked: WebContentLoader
//   zip bytes  — one .nvs file handed to the page: ZipContentLoader (in-memory)
//   inline     — the single-file HTML export: InlineContentLoader (a JS object)
//
// `openPackage()` turns any of them into a ScriptPackage, which `Engine.load()`
// consumes. The engine imports @nilvn/core TYPE-ONLY (the IIFE must carry zero
// core runtime), so the format constant and the structural guard are mirrored
// here; the batch-A contract test pins them to core's.

import type { ChunkManifest, ContentLoader, PackageManifest, ScriptChunk, TextCatalogSlice } from '@nilvn/core'
import { WebContentLoader } from './loader.js'

/** Mirrors core's PACKAGE_FORMAT. */
export const PACKAGE_FORMAT = 1
/** Mirrors core's PACKAGE_MANIFEST_FILE. */
export const PACKAGE_MANIFEST_FILE = 'nilvn.json'
/** Mirrors core's CHUNK_MANIFEST_FORMAT (the embedded chunk manifest's `format`). */
const CHUNK_FORMAT = 1

/** An opened package: its manifest plus the loader that serves its bytes. */
export interface ScriptPackage {
  manifest: PackageManifest
  loader: ContentLoader
}

/** What `Engine.load()` / `openPackage()` accept: a `.nvn` script URL (engine
 *  only), a package directory URL (or its nilvn.json URL), zip bytes / a Blob,
 *  or an already-opened package. */
export type PackageSource = string | Uint8Array | ArrayBuffer | Blob | ScriptPackage

/** Structural check mirroring core's `isPackageManifest`. */
export function isPackageManifest(x: unknown): x is PackageManifest {
  if (!x || typeof x !== 'object') return false
  const m = x as Partial<PackageManifest>
  const c = m.chunks as Partial<ChunkManifest> | undefined
  return (
    typeof m.format === 'number' &&
    typeof m.title === 'string' &&
    typeof m.engine === 'string' &&
    typeof m.lang === 'string' &&
    Array.isArray(m.languages) &&
    !!m.actors &&
    typeof m.actors === 'object' &&
    Array.isArray(m.plugins) &&
    typeof m.textSpeed === 'number' &&
    typeof m.saveKey === 'string' &&
    !!c &&
    typeof c === 'object' &&
    typeof c.format === 'number' &&
    !!c.entry &&
    typeof c.entry.label === 'string' &&
    Array.isArray(c.chunks) &&
    !!c.labelIndex &&
    !!c.locales &&
    !!c.assets
  )
}

/** Thrown by `openPackage` / `checkPackageManifest` for a file that is not a
 *  package this engine can play (foreign JSON, or a newer/older format). Hosts
 *  branch on `name` to word the message ("re-export with the current studio"). */
export class PackageFormatError extends Error {
  override name = 'PackageFormatError'
}

/** Validate a parsed nilvn.json, throwing PackageFormatError when it is not a
 *  package or its format numbers are not the ones this engine plays. */
export function checkPackageManifest(x: unknown): PackageManifest {
  if (!isPackageManifest(x)) throw new PackageFormatError(`${PACKAGE_MANIFEST_FILE} is not a NilVN script package`)
  if (x.format !== PACKAGE_FORMAT) throw new PackageFormatError(`package format ${x.format} is not supported (expected ${PACKAGE_FORMAT})`)
  if (x.chunks.format !== CHUNK_FORMAT) throw new PackageFormatError(`chunk format ${x.chunks.format} is not supported (expected ${CHUNK_FORMAT})`)
  return x
}

// ---- inline (single-file HTML) ----

/** The single-file export's payload: the manifest, every chunk-side file's text
 *  keyed by its package-relative path, and the assets already resolved to
 *  playable URLs (data URIs) by ref. */
export interface InlinePackageData {
  manifest: PackageManifest
  files: Record<string, string>
  assets?: Record<string, string>
}

/** Serves a package held entirely in memory as JSON text — nothing to fetch. */
export class InlineContentLoader implements ContentLoader {
  constructor(
    private readonly manifest: ChunkManifest,
    private readonly files: Record<string, string>,
    private readonly assets: Record<string, string> = {},
  ) {}

  private json<T>(path: string, what: string): T {
    const text = this.files[path]
    if (text === undefined) throw new Error(`${what} missing from the inline package: ${path}`)
    return JSON.parse(text) as T
  }

  loadChunk(chunkId: string): Promise<ScriptChunk> {
    const chunk = this.manifest.chunks.find((c) => c.id === chunkId)
    if (!chunk) return Promise.reject(new Error(`Unknown chunk "${chunkId}"`))
    try {
      return Promise.resolve(this.json<ScriptChunk>(chunk.url, `chunk ${chunkId}`))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice> {
    const slice = this.manifest.locales[lang]?.find((s) => s.id === sliceId)
    if (!slice) return Promise.reject(new Error(`Unknown locale slice ${lang}/${sliceId}`))
    try {
      return Promise.resolve(this.json<TextCatalogSlice>(slice.url, `locale ${lang}/${sliceId}`))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  /** The pre-resolved URL by ref; an unknown ref falls back to its manifest url,
   *  then to itself (a bundled / public path), like the Web loader. */
  assetUrl(ref: string): Promise<string> {
    return Promise.resolve(this.assets[ref] ?? this.manifest.assets[ref]?.url ?? ref)
  }

  releaseChunk(_chunkId: string): void {}
}

/** Wrap the single-file export's payload as an openable package. */
export function inlinePackage(data: InlinePackageData): ScriptPackage {
  const manifest = checkPackageManifest(data.manifest)
  return { manifest, loader: new InlineContentLoader(manifest.chunks, data.files, data.assets) }
}

// ---- zip (one .nvs file in memory) ----

interface ZipEntryRef {
  method: number
  compSize: number
  dataStart: number
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  webm: 'video/webm',
  mp4: 'video/mp4',
  json: 'application/json',
}
const mimeOf = (name: string): string => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'

/** Raw DEFLATE (ZIP method 8) via the platform's DecompressionStream. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  void writer.write(bytes as Uint8Array<ArrayBuffer>)
  void writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

/** Serves a package from zip bytes held in memory. Reads the central directory
 *  once; entries inflate on demand (STORE + DEFLATE, what any zip tool writes).
 *  Assets become blob: URLs minted lazily and cached — never revoked, so a ref
 *  stays resolvable after its chunk is released (seam constraint 3). */
export class ZipContentLoader implements ContentLoader {
  private readonly urls = new Map<string, string>()
  private readonly decoder = new TextDecoder()

  private constructor(
    private readonly manifest: ChunkManifest,
    private readonly bytes: Uint8Array,
    private readonly entries: Map<string, ZipEntryRef>,
  ) {}

  /** Parse the archive and its nilvn.json. Throws PackageFormatError for a file
   *  that is not a zip / not a package. */
  static async open(source: Uint8Array | ArrayBuffer | Blob): Promise<ScriptPackage> {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source)
    const entries = ZipContentLoader.directory(bytes)
    const probe = new ZipContentLoader({} as ChunkManifest, bytes, entries)
    const raw = await probe.read(PACKAGE_MANIFEST_FILE)
    if (!raw) throw new PackageFormatError(`${PACKAGE_MANIFEST_FILE} not found in the zip`)
    let parsed: unknown
    try {
      parsed = JSON.parse(probe.decoder.decode(raw))
    } catch {
      throw new PackageFormatError(`${PACKAGE_MANIFEST_FILE} is not valid JSON`)
    }
    const manifest = checkPackageManifest(parsed)
    return { manifest, loader: new ZipContentLoader(manifest.chunks, bytes, entries) }
  }

  /** Walk the central directory into name → entry refs. */
  private static directory(buf: Uint8Array): Map<string, ZipEntryRef> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let eocd = -1
    for (let i = buf.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new PackageFormatError('not a zip archive (no end-of-central-directory record)')
    const count = dv.getUint16(eocd + 10, true)
    let p = dv.getUint32(eocd + 16, true)
    const out = new Map<string, ZipEntryRef>()
    const dec = new TextDecoder()
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new PackageFormatError('zip central directory is corrupt')
      const method = dv.getUint16(p + 10, true)
      const compSize = dv.getUint32(p + 20, true)
      const nameLen = dv.getUint16(p + 28, true)
      const extraLen = dv.getUint16(p + 30, true)
      const commentLen = dv.getUint16(p + 32, true)
      const lho = dv.getUint32(p + 42, true)
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
      if (dv.getUint32(lho, true) !== 0x04034b50) throw new PackageFormatError(`zip local header is corrupt: ${name}`)
      const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true)
      if (!name.endsWith('/')) out.set(name, { method, compSize, dataStart })
      p += 46 + nameLen + extraLen + commentLen
    }
    return out
  }

  /** Bytes of one entry, or undefined when absent. */
  private async read(name: string): Promise<Uint8Array | undefined> {
    const e = this.entries.get(name)
    if (!e) return undefined
    const raw = this.bytes.subarray(e.dataStart, e.dataStart + e.compSize)
    if (e.method === 0) return raw
    if (e.method === 8) return inflateRaw(raw)
    throw new Error(`unsupported zip compression method ${e.method}: ${name}`)
  }

  private async json<T>(name: string, what: string): Promise<T> {
    const raw = await this.read(name)
    if (!raw) throw new Error(`${what} missing from the package: ${name}`)
    return JSON.parse(this.decoder.decode(raw)) as T
  }

  async loadChunk(chunkId: string): Promise<ScriptChunk> {
    const chunk = this.manifest.chunks.find((c) => c.id === chunkId)
    if (!chunk) throw new Error(`Unknown chunk "${chunkId}"`)
    return this.json<ScriptChunk>(chunk.url, `chunk ${chunkId}`)
  }

  async loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice> {
    const slice = this.manifest.locales[lang]?.find((s) => s.id === sliceId)
    if (!slice) throw new Error(`Unknown locale slice ${lang}/${sliceId}`)
    return this.json<TextCatalogSlice>(slice.url, `locale ${lang}/${sliceId}`)
  }

  /** A blob: URL for the asset's bytes, minted once per ref. An unknown ref (or
   *  a ref whose file is not in the archive) falls back to itself. */
  async assetUrl(ref: string): Promise<string> {
    const hit = this.urls.get(ref)
    if (hit) return hit
    const entry = this.manifest.assets[ref]
    if (!entry) return ref
    const raw = await this.read(entry.url)
    if (!raw) return ref
    const url = URL.createObjectURL(new Blob([raw as Uint8Array<ArrayBuffer>], { type: mimeOf(entry.url) }))
    this.urls.set(ref, url)
    return url
  }

  releaseChunk(_chunkId: string): void {}
}

// ---- open ----

/** Open a package from any of its forms. A string is a package directory URL
 *  (with or without a trailing slash) or the URL of its nilvn.json; bytes / a
 *  Blob are a zip; an opened package passes through. Rejects with a
 *  PackageFormatError for a file this engine cannot play, or the fetch error
 *  for a directory that cannot be reached. */
export async function openPackage(source: PackageSource): Promise<ScriptPackage> {
  if (typeof source === 'string') {
    const base = packageBase(source)
    const res = await fetch(new URL(PACKAGE_MANIFEST_FILE, base).href)
    if (!res.ok) throw new Error(`Failed to load ${PACKAGE_MANIFEST_FILE} from ${base}: ${res.status}`)
    const manifest = checkPackageManifest(await res.json())
    return { manifest, loader: new WebContentLoader(manifest.chunks, base) }
  }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return ZipContentLoader.open(source)
  if (typeof Blob !== 'undefined' && source instanceof Blob) return ZipContentLoader.open(source)
  const pkg = source as ScriptPackage
  return { manifest: checkPackageManifest(pkg.manifest), loader: pkg.loader }
}

/** The package directory a source URL names, always ending in `/`. */
function packageBase(url: string): string {
  const abs = new URL(url, typeof document !== 'undefined' ? document.baseURI : undefined).href
  if (abs.endsWith('/' + PACKAGE_MANIFEST_FILE)) return abs.slice(0, -PACKAGE_MANIFEST_FILE.length)
  return abs.endsWith('/') ? abs : abs + '/'
}
