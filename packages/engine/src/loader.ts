// WebContentLoader — the Web (static-hosting) ContentLoader for chunked play
//. Fetches chunk / locale-slice JSON and resolves assets by canonical
// ref, all relative to the manifest's directory.
//
// For a static hosted export, assets are plain files the browser fetches directly
// by URL, so `assetUrl` is a pure ref→URL lookup and `releaseChunk` has nothing to
// revoke. The blob-minting / decrypt + revoke path belongs to a future Tauri
// loader — bytes are pluggable behind this same interface (the engine's release
// policy stays loader-agnostic).

import type { ChunkManifest, ContentLoader, ScriptChunk, TextCatalogSlice } from '@nilvn/core'

export class WebContentLoader implements ContentLoader {
  /** ref → resolved URL, cached so repeated resolves are cheap AND stable across a
   *  chunk release (seam constraint 2: assets are fetchable by ref regardless of
   *  whether their owning chunk is resident). */
  private assetUrls = new Map<string, string>()

  /**
   * @param manifest the parsed manifest.json (already version-checked by the caller)
   * @param baseUrl  the directory the manifest lives in; chunk / locale / asset
   *                 urls resolve against it (e.g. the hosting page's URL).
   */
  constructor(
    private readonly manifest: ChunkManifest,
    private readonly baseUrl: string,
  ) {}

  private resolve(url: string): string {
    return new URL(url, this.baseUrl).href
  }

  async loadChunk(chunkId: string): Promise<ScriptChunk> {
    const chunk = this.manifest.chunks.find((c) => c.id === chunkId)
    if (!chunk) throw new Error(`Unknown chunk "${chunkId}"`)
    const res = await fetch(this.resolve(chunk.url))
    if (!res.ok) throw new Error(`Failed to load chunk ${chunkId}: ${res.status}`)
    return (await res.json()) as ScriptChunk
  }

  async loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice> {
    const slice = this.manifest.locales[lang]?.find((s) => s.id === sliceId)
    if (!slice) throw new Error(`Unknown locale slice ${lang}/${sliceId}`)
    const res = await fetch(this.resolve(slice.url))
    if (!res.ok) throw new Error(`Failed to load locale ${lang}/${sliceId}: ${res.status}`)
    return (await res.json()) as TextCatalogSlice
  }

  /** Resolve an asset ref to a fetchable URL BY REF, independent of chunk residency
   *  (backlog replay / future eviction rely on this). Deterministic map lookup,
   *  cached. An unknown ref falls back to itself (a bundled / public path). */
  async assetUrl(ref: string): Promise<string> {
    const hit = this.assetUrls.get(ref)
    if (hit) return hit
    const entry = this.manifest.assets[ref]
    const url = entry ? this.resolve(entry.url) : ref
    this.assetUrls.set(ref, url)
    return url
  }

  /** No-op for static URLs — nothing was minted, so nothing to revoke. The Tauri
   *  loader revokes here; keeping it on the interface lets the engine release a
   *  chunk's assets without knowing HOW they were sourced (seam constraint 3). */
  releaseChunk(_chunkId: string): void {}
}
