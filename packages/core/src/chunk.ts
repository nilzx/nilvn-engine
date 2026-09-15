// Chunked streaming export — shared contract types.
//
// The on-the-wire shape of a chunked/streaming export
// plus the runtime ContentLoader interface the engine resolves chunks/assets through.
// Pure types + tiny guards, zero-dep (core stays dependency-free). Producer
// (editor) and consumer (engine) both import from here so the format can't drift.
//
// A full single-file export is the degenerate one-chunk case: it never builds a
// manifest at all (the engine just loadSource()s the whole script), so these
// types describe ONLY the chunked product.

import type { Lang } from './ir.js'

/** Streaming-export format version (independent of the IR `schemaVersion`).
 *  Bumped only when the manifest/chunk wire shape changes incompatibly. */
export const CHUNK_MANIFEST_FORMAT = 1

/** One playable script chunk's manifest entry — a group of scenes compiled
 *  together (default: one scene per chunk; story-map chapters may merge several). */
export interface ManifestChunk {
  /** Stable chunk id (also the filename stem under `chunks/scene/`). */
  id: string
  /** Scene ids this chunk contains, in project order. */
  scenes: string[]
  /** Where to fetch the chunk body, relative to the manifest. */
  url: string
  /** Decoded-or-encoded byte size, for prefetch budgeting / progress. */
  bytes: number
  /** Every jump-target label this chunk DEFINES (scene ids + in-scene labels).
   *  Feeds the manifest `labelIndex`; globally unique across chunks. */
  labels: string[]
  /** Asset refs this chunk references (command params + per-line voice). */
  assets: string[]
  /** Prefetch hint: the chunk(s) reachable by linear fall-through. */
  next: string[]
  /** Prefetch hint: chunk(s) reachable by an explicit jump/choice target. */
  branchTargets: string[]
}

/** One language's catalog slice — the text for a group of scenes, mirroring the
 *  scene chunks so only the current language's resident-scene slices need loading. */
export interface ManifestLocaleSlice {
  id: string
  /** Scene ids whose text this slice carries (parallels a scene chunk). */
  scenes: string[]
  url: string
  bytes: number
}

/** Discrete asset file entry. The ref→file map lets any asset be fetched BY REF
 *  regardless of whether its owning chunk is resident (backlog voice replay,
 *  eventual window eviction) — seam constraint 2. */
export interface ManifestAsset {
  url: string
  bytes: number
  /** bg / char / audio / voice / sprite — for warm/release policy. */
  kind: string
}

/** The chunked export's directory/index (manifest.json) — the contract core
 *  and the engine share. */
export interface ChunkManifest {
  /** Streaming-export format version; see CHUNK_MANIFEST_FORMAT. */
  format: number
  /** Target engine version the chunks were compiled for (mismatch → clean error). */
  engine: string
  /** IR schema version (mirrors ProjectMeta.schemaVersion). */
  schemaVersion: number
  /** Where playback opens. */
  entry: { label: string }
  defaultLang: Lang
  /** Linear scene order (scene-to-scene fall-through). */
  sceneOrder: string[]
  chunks: ManifestChunk[]
  /** Any label (jump target / save resume point) → the chunk that defines it.
   *  Denormalized for O(1) resolution: jump/restore = labelIndex[label] →
   *  ensure that chunk loaded → base+offset. Seam constraint 1. */
  labelIndex: Record<string, string>
  /** Per-language catalog slice lists, parallel to the scene chunks. */
  locales: Record<string, ManifestLocaleSlice[]>
  /** Asset ref → file. Seam constraint 2 (by-ref, residency-independent). */
  assets: Record<string, ManifestAsset>
}

/** A decoded script chunk — what `ContentLoader.loadChunk` yields: the playable
 *  `.nvn` body for its scenes plus the labels it defines (for the residency merge). */
export interface ScriptChunk {
  id: string
  /** The `.nvn` DSL the engine parser consumes (serializeChunk's `body`). */
  body: string
  /** Labels this chunk defines (serializeChunk's `labels`). */
  labels: string[]
}

/** A decoded locale slice — catalog key → resolved text, for the slice's scenes
 *  in one language. Merged into the engine's catalog for that language. */
export type TextCatalogSlice = Record<string, string>

/** The runtime seam the engine resolves content through (docs/.../streaming §3).
 *  Bytes are pluggable: Web loader fetches; a future Tauri loader reads natively
 *  and decrypts in the closed host, handing the engine plaintext to decode — the
 *  engine never touches ciphertext or keys. */
export interface ContentLoader {
  /** Fetch + decode one script chunk by id (internally: read bytes → optional
   *  decrypt → decode). */
  loadChunk(chunkId: string): Promise<ScriptChunk>
  /** Fetch + decode one locale slice (current language only). */
  loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice>
  /** Resolve an asset's playable URL by canonical ref — independent of whether
   *  the owning chunk is resident (seam constraint 2). */
  assetUrl(ref: string): Promise<string>
  /** Release a chunk's heavy bytes WITHOUT losing the ability to re-resolve its
   *  assets by ref (seam constraint 3). The engine calls this when it evicts a
   *  chunk under its opt-in residency ceiling, and for every resident chunk on
   *  destroy(). An implementation that hands out revocable URLs owns its own
   *  in-use protection; the bundled loaders never revoke (Web: static URLs,
   *  no-op — desktop player: stable nvpk:// URLs, drops native plaintext cache). */
  releaseChunk(chunkId: string): void
}

/** Cheap structural sanity check for a fetched manifest — guards against a
 *  truncated/foreign/garbage manifest with a clean error rather than a silent
 *  misparse deep in playback (the version-mismatch gate; producer/loader both use it). */
export function isChunkManifest(x: unknown): x is ChunkManifest {
  if (!x || typeof x !== 'object') return false
  const m = x as Partial<ChunkManifest>
  return (
    typeof m.format === 'number' &&
    typeof m.engine === 'string' &&
    typeof m.schemaVersion === 'number' &&
    !!m.entry &&
    typeof m.entry.label === 'string' &&
    typeof m.defaultLang === 'string' &&
    Array.isArray(m.sceneOrder) &&
    Array.isArray(m.chunks) &&
    !!m.labelIndex &&
    typeof m.labelIndex === 'object' &&
    !!m.locales &&
    typeof m.locales === 'object' &&
    !!m.assets &&
    typeof m.assets === 'object'
  )
}
