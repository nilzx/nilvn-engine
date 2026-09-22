// Chunked streaming export — the producer half.
//
// buildChunkedExport(project) turns a Project into the script side of a chunked
// export: the manifest (minus per-file asset metadata, which the editor fills from
// its AssetStore) + the chunk/locale file contents. Pure, zero-I/O, zero-dep —
// the editor (export-html.ts) writes the files, fetches assets, and zips.
//
// Full single-file export does NOT use this — it stays one inlined script
// (serializeProject). This builder is for the chunked ZIP/Tauri product only.

import type { Project, JumpTarget, SceneNode, Lang } from './ir.js'
import type { CommandSchema } from './schema.js'
import { serializeChunk } from './serialize.js'
import {
  CHUNK_MANIFEST_FORMAT,
  type ChunkManifest,
  type ManifestChunk,
  type ManifestLocaleSlice,
  type ScriptChunk,
} from './chunk.js'

/** A JSON file the producer must write into the export, with its byte size
 *  already reflected in the manifest. `text` is the exact file content. */
export interface ChunkFile {
  path: string
  text: string
  bytes: number
}

export interface ChunkedExportPlan {
  /** The manifest, with `assets` left EMPTY — the editor fills ref→{url,bytes,kind}
   *  from its AssetStore, then writes manifest.json. Everything else is final. */
  manifest: ChunkManifest
  /** chunks/meta.json + chunks/scene/*.json + chunks/locale/<lang>/*.json, ready
   *  to write verbatim (bytes already counted into the manifest). */
  files: ChunkFile[]
  /** Deduped union of every chunk's asset refs — the editor resolves these to
   *  files under assets/ and fills manifest.assets. */
  assetRefs: string[]
}

export interface BuildChunkedOptions {
  /** Target engine version stamped into the manifest (mismatch → clean load error). */
  engine: string
  /** Scene-id groups, in play order, one per chunk. Defaults to one scene per
   *  chunk; pass story-map chapter groupings to merge (a chunk = many scenes). */
  groups?: string[][]
  /** Command schema registry for serialization (`commandRegistry(manifests)`);
   *  built-ins only when omitted — see SerializeOptions.commands. */
  commands?: Record<string, CommandSchema>
  /** A scoped build (the studio's preview of one scene): only these scene ids, in
   *  project order, go into the package — as ONE chunk, which is also the entry —
   *  and a jump or choice that leaves the scope routes to the unset landing
   *  (serialize's non-`crossChunk` mode) instead of naming a label the package
   *  does not carry. `groups` is ignored when set. Omitted = the whole project. */
  scenes?: string[]
  /** Emit `[label anchorLabel]` right before this node (play-from-here). */
  anchorNodeId?: string
  /** The label to inject at `anchorNodeId`; defaults to `__nilvn_here__`. */
  anchorLabel?: string
}

/** UTF-8 byte length of a string — pure, so @nilvn/core stays zero-dep and
 *  environment-agnostic (no TextEncoder, which isn't in core's lib). Matches what
 *  TextEncoder().encode(s).length would return; used for the manifest byte hints. */
function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4 // a surrogate pair encodes one 4-byte code point
      i++
    } else n += 3
  }
  return n
}

/** Resolve a jump/choice target to the SCENE id it lands in, or undefined for an
 *  in-scene label / dangling target (no cross-chunk edge). Scene ids double as
 *  labels, so a `label` that names a scene is a cross-scene jump. */
function targetSceneId(target: JumpTarget, sceneIds: Set<string>): string | undefined {
  if (target.scene) return sceneIds.has(target.scene) ? target.scene : undefined
  if (target.label && sceneIds.has(target.label)) return target.label
  return undefined
}

/** Catalog keys a scene's runtime body references (say/narrate text + choice
 *  option labels) — i.e. the text that belongs in this scene's locale slice.
 *  Exported: the editor's shard partition (per-scene locale slices) claims keys
 *  with the same walker, so export slicing and persistence slicing cannot drift. */
export function sceneTextKeys(nodes: SceneNode[], into: Set<string>): void {
  for (const n of nodes) {
    if (n.kind === 'say' || n.kind === 'narrate') {
      if (n.textKey) into.add(n.textKey)
    } else if (n.kind === 'choice') {
      for (const o of n.options) if (o.labelKey) into.add(o.labelKey)
    }
  }
}

export function buildChunkedExport(project: Project, opts: BuildChunkedOptions): ChunkedExportPlan {
  const scoped = opts.scenes ? project.scenes.filter((s) => opts.scenes!.includes(s.id)) : project.scenes
  const sceneOrder = scoped.map((s) => s.id)
  const sceneIds = new Set(sceneOrder)
  const byId = new Map(scoped.map((s) => [s.id, s]))
  const groups = opts.scenes ? [sceneOrder] : (opts.groups ?? sceneOrder.map((id) => [id]))
  const anchor = opts.anchorNodeId ? { anchorNodeId: opts.anchorNodeId, ...(opts.anchorLabel ? { anchorLabel: opts.anchorLabel } : {}) } : {}

  // Each group → one chunk. Chunk id = its first scene id (stable, unique).
  const chunks: ManifestChunk[] = []
  const files: ChunkFile[] = []
  const labelIndex: Record<string, string> = {}
  const sceneToChunk = new Map<string, string>()
  const allAssetRefs = new Set<string>()
  // Per-language, per-chunk key sets (for slicing) + the union of all scene keys
  // (so base = catalog − sceneKeys).
  const sceneKeysByChunk = new Map<string, Set<string>>()
  const allSceneKeys = new Set<string>()

  for (const group of groups) {
    const ids = group.filter((id) => sceneIds.has(id))
    if (!ids.length) continue
    const chunkId = ids[0]!
    const { body, labels, assetRefs } = serializeChunk(project, { scenes: ids, keepKeys: true, crossChunk: !opts.scenes, ...anchor, ...(opts.commands ? { commands: opts.commands } : {}) })
    const scriptChunk: ScriptChunk = { id: chunkId, body, labels }
    const text = JSON.stringify(scriptChunk)
    const bytes = utf8Len(text)
    files.push({ path: `chunks/scene/${chunkId}.json`, text, bytes })

    for (const label of labels) {
      if (label in labelIndex) {
        throw new Error(
          `Duplicate jump label "${label}" across chunks (${labelIndex[label]} and ${chunkId}); ` +
            `labels must be globally unique to chunk a project. Rename one.`,
        )
      }
      labelIndex[label] = chunkId
    }
    for (const id of ids) sceneToChunk.set(id, chunkId)
    for (const r of assetRefs) allAssetRefs.add(r)

    const keys = new Set<string>()
    for (const id of ids) sceneTextKeys(byId.get(id)!.nodes, keys)
    sceneKeysByChunk.set(chunkId, keys)
    for (const k of keys) allSceneKeys.add(k)

    chunks.push({
      id: chunkId, scenes: ids, url: `chunks/scene/${chunkId}.json`, bytes,
      labels, assets: assetRefs, next: [], branchTargets: [],
    })
  }

  // Prefetch hints: linear fall-through (next scene after the chunk's LAST scene,
  // unless that scene ends in an unconditional jump) + explicit branch targets.
  for (const chunk of chunks) {
    const next = new Set<string>()
    const branch = new Set<string>()
    for (const sceneId of chunk.scenes) {
      const scene = byId.get(sceneId)!
      for (const n of scene.nodes) {
        if (n.kind === 'jump') addEdge(targetSceneId(n.target, sceneIds))
        else if (n.kind === 'choice') for (const o of n.options) addEdge(targetSceneId(o.target, sceneIds))
      }
    }
    // Fall-through from the chunk's last scene to the next scene in project order.
    const lastSceneId = chunk.scenes[chunk.scenes.length - 1]!
    const lastScene = byId.get(lastSceneId)!
    const last = lastScene.nodes[lastScene.nodes.length - 1]
    const fallsThrough = !(last && last.kind === 'jump' && !last.condition)
    if (fallsThrough) {
      const after = sceneOrder[sceneOrder.indexOf(lastSceneId) + 1]
      const c = after && sceneToChunk.get(after)
      if (c && c !== chunk.id) next.add(c)
    }
    chunk.next = [...next]
    chunk.branchTargets = [...branch]

    function addEdge(sid: string | undefined): void {
      const c = sid && sceneToChunk.get(sid)
      if (c && c !== chunk.id) branch.add(c)
    }
  }

  // Locale slices: a `base` slice per language (project-level keys — actor names,
  // scene titles, anything not in a scene body, loaded with meta and always warm)
  // + one slice per chunk (its scenes' dialogue, loaded when the chunk loads).
  const langs = project.meta.languages?.length ? project.meta.languages : [project.meta.defaultLang]
  const locales: Record<string, ManifestLocaleSlice[]> = {}
  for (const lang of langs) {
    const catalog = project.catalogs[lang] ?? {}
    const slices: ManifestLocaleSlice[] = []
    // base = catalog keys not referenced by any scene body.
    const base: Record<string, string> = {}
    for (const k of Object.keys(catalog)) if (!allSceneKeys.has(k)) base[k] = catalog[k]!
    pushSlice(lang, 'base', [], base, slices)
    for (const chunk of chunks) {
      const slice: Record<string, string> = {}
      for (const k of sceneKeysByChunk.get(chunk.id)!) if (k in catalog) slice[k] = catalog[k]!
      pushSlice(lang, chunk.id, chunk.scenes, slice, slices)
    }
    locales[lang] = slices
  }

  function pushSlice(lang: Lang, id: string, scenes: string[], slice: Record<string, string>, out: ManifestLocaleSlice[]): void {
    const text = JSON.stringify(slice)
    const bytes = utf8Len(text)
    files.push({ path: `chunks/locale/${lang}/${id}.json`, text, bytes })
    out.push({ id, scenes, url: `chunks/locale/${lang}/${id}.json`, bytes })
  }

  // meta.json: the whole project MINUS scenes + catalogs (the always-warm base —
  // actors / variables / resources / plugins / loopClips / meta).
  const { scenes: _scenes, catalogs: _catalogs, ...metaJson } = project
  const metaText = JSON.stringify(metaJson)
  files.push({ path: 'chunks/meta.json', text: metaText, bytes: utf8Len(metaText) })

  const manifest: ChunkManifest = {
    format: CHUNK_MANIFEST_FORMAT,
    engine: opts.engine,
    schemaVersion: project.meta.schemaVersion ?? 0,
    entry: { label: sceneOrder[0] ?? '' },
    defaultLang: project.meta.defaultLang,
    sceneOrder,
    chunks,
    labelIndex,
    locales,
    assets: {}, // editor fills ref → {url, bytes, kind}
  }

  return { manifest, files, assetRefs: [...allAssetRefs] }
}
