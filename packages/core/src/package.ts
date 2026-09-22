// Script package (.nvs) — the contract core of "a work the engine can load and
// run on its own". One `nilvn.json`
// carries everything a shell used to split across index.html / boot.json /
// manifest.json: work metadata, the actor table, the enabled plugin set, the
// initial + switchable languages, playback defaults, and the chunk manifest
// (embedded verbatim, so every ContentLoader keeps reading a ChunkManifest).
//
// Pure types + a builder over buildChunkedExport, zero-dep. The editor's four
// exports (single-file HTML / asset ZIP / chunked ZIP / .nvpk) are this package
// plus a shell; the engine's `load()` is its one consumer.

import type { Lang, Project, WorkConfig } from './ir.js'
import { isAssetRef } from './serialize.js'
import { isChunkManifest, type ChunkManifest, type ManifestAsset } from './chunk.js'
import { buildChunkedExport, type BuildChunkedOptions, type ChunkFile } from './chunk-build.js'

/** Script-package format version. Bumped only when nilvn.json's shape changes
 *  incompatibly; the embedded chunk manifest keeps its own `format`. */
export const PACKAGE_FORMAT = 1

/** The package's single entry file, at the package root. */
export const PACKAGE_MANIFEST_FILE = 'nilvn.json'

/** An actor as the runtime needs it (mirrors the engine's `ActorDef`; core
 *  cannot import the engine). `name` is the default-language literal (fallback),
 *  `nameKey` lets the engine re-resolve the display name on a language switch. */
export interface PackageActor {
  name?: string
  nameKey?: string
  color?: string
  /** Sprite URL template; `{face}` is replaced by the current face. */
  sprites?: string
  defaultFace?: string
  /** Base pitch (Hz) for the voice blip. */
  voice?: number
}

/** One enabled plugin, by its reverse-DNS id (`app.nilvn.textfx`; the engine
 *  also accepts the short names older packages carry).
 *  `entry` = a plugin carried inside the package (its `plugin.json`, relative to
 *  the package root); `integrity` = its digest (reserved). */
export interface PackagePlugin {
  id: string
  version?: string
  entry?: string
  integrity?: string
}

/** `nilvn.json` — the package manifest. */
export interface PackageManifest {
  /** = PACKAGE_FORMAT. */
  format: number
  /** Work title (window / document title). */
  title: string
  /** The studio / engine version that produced the package — traceability only;
   *  compatibility is decided by `format` + `chunks.format` + `chunks.schemaVersion`. */
  engine: string
  /** Initial content language (the author's language). */
  lang: string
  /** Languages the in-game switcher offers (the default first). */
  languages: string[]
  actors: Record<string, PackageActor>
  /** The enabled plugin set, auto-loaded at start (same entries as `[use …]`). */
  plugins: PackagePlugin[]
  /** Typewriter speed, characters per second. */
  textSpeed: number
  /** Per-work id the runtime namespaces saves / settings by. */
  saveKey: string
  /** The work's engine configuration — the JSON form of `nilvn.config.toml`
   *  (`Project.config`). The engine applies it once the package is open, after
   *  the asset table is filled, so a skin, logo or background in it resolves by
   *  ref like any other asset. Optional (a package without one plays with the
   *  engine's defaults); the sections `nilvn.json` carries itself (`game.entry`
   *  / `game.scripts` / `path` / `actors` / `plugins.use`) are dropped with a
   *  diagnostic. Engines before 0.17 ignore the field. */
  config?: WorkConfig
  /** The chunk manifest (chunk.ts), embedded as-is: chunk / locale-slice / asset
   *  index + entry label. Wire files (`chunks/**`, `assets/**`) are unchanged. */
  chunks: ChunkManifest
}

/** Structural check for a parsed nilvn.json — a foreign or truncated file fails
 *  cleanly here instead of deep inside playback. Does NOT check `format`
 *  numbers (callers gate those so they can word the mismatch message). */
export function isPackageManifest(x: unknown): x is PackageManifest {
  if (!x || typeof x !== 'object') return false
  const m = x as Partial<PackageManifest>
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
    isChunkManifest(m.chunks)
  )
}

export interface BuildPackageOptions extends BuildChunkedOptions {
  /** Defaults to the project title (or "NilVN"). */
  title?: string
  /** Defaults to the project's default language. */
  lang?: string
  /** Defaults to {@link packageLanguages}. */
  languages?: string[]
  /** Defaults to {@link packageActors} (the IR actors as-is; the editor passes
   *  its own table so actors without artwork get a placeholder sprite). */
  actors?: Record<string, PackageActor>
  /** Defaults to the project's enabled plugin ids. The editor appends the
   *  finished-game shell (`app.nilvn.menu`) and drops plugins without an engine half. */
  plugins?: PackagePlugin[]
  /** Defaults to the project text speed (40). */
  textSpeed?: number
  /** Defaults to the project id, else the title. */
  saveKey?: string
  /** Defaults to `project.config`; left out of the manifest when empty. */
  config?: WorkConfig
}

export interface ScriptPackagePlan {
  /** nilvn.json, with `chunks.assets` still EMPTY — the producer resolves the
   *  refs to files and fills it via {@link fillPackageAssets}. */
  manifest: PackageManifest
  /** chunks/meta.json + chunks/scene/*.json + chunks/locale/<lang>/*.json. */
  files: ChunkFile[]
  /** Deduped asset refs the scenes reference (actor faces are NOT here — they
   *  belong to the whole-project universe the producer resolves separately). */
  assetRefs: string[]
}

/** Languages the finished work can switch between: the default plus every
 *  declared language that ships a non-empty catalog. The default comes first. */
export function packageLanguages(project: Project): string[] {
  const def = project.meta.defaultLang
  const declared = project.meta.languages?.length ? project.meta.languages : [def]
  const extra = declared.filter((l) => l !== def && Object.keys(project.catalogs[l] ?? {}).length > 0)
  return [def, ...extra]
}

/** The runtime actor table straight from the IR (`name` = the default-language
 *  display name, falling back to the id). */
export function packageActors(project: Project): Record<string, PackageActor> {
  const cat = project.catalogs[project.meta.defaultLang] ?? {}
  const out: Record<string, PackageActor> = {}
  for (const [id, a] of Object.entries(project.actors)) {
    out[id] = { name: cat[a.nameKey] ?? id, nameKey: a.nameKey, color: a.color, sprites: a.sprites, defaultFace: a.defaultFace, voice: a.voice }
  }
  return out
}

/** Build a script package from a project: the chunked script side (one chunk per
 *  scene by default; `groups` merges scenes — a single group = one chunk, the
 *  single-file / asset-ZIP shape) plus the manifest fields the shells used to bake
 *  into their bootstraps. Pure, zero-I/O. */
export function buildScriptPackage(project: Project, opts: BuildPackageOptions): ScriptPackagePlan {
  // The chunk options ride through whole (registry, grouping, a preview's scene
  // scope and anchor): without the command registry the chunks serialize plugin
  // commands against the built-ins alone, and a positional argument
  // (`[move yuki …]`) degrades to `id=yuki`, which the plugin never reads.
  const plan = buildChunkedExport(project, opts)
  const title = opts.title ?? (project.meta.title || 'NilVN')
  const lang = (opts.lang ?? project.meta.defaultLang) as Lang
  const config = opts.config ?? project.config
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    title,
    engine: opts.engine,
    lang,
    languages: opts.languages ?? packageLanguages(project),
    actors: opts.actors ?? packageActors(project),
    plugins: opts.plugins ?? project.plugins.map((p) => ({ id: p.id })),
    textSpeed: opts.textSpeed ?? (Number(project.meta.textSpeed) || 40),
    saveKey: opts.saveKey ?? (project.meta.id || project.meta.title || 'nilvn'),
    ...(config && Object.keys(config).length ? { config } : {}),
    chunks: plan.manifest,
  }
  return { manifest, files: plan.files, assetRefs: plan.assetRefs }
}

/** Asset refs a work configuration names — a skin, logo, background, music,
 *  HUD icon or preload entry — found by walking every string in it with the
 *  same predicate the scene walk uses (`isAssetRef`), so a producer resolves
 *  them into the package's by-ref table alongside the scenes' assets. Strings
 *  holding a `{placeholder}` (a layered actor's `src` template) are templates,
 *  not refs, and are left to the actor table. */
export function configAssetRefs(config: WorkConfig | undefined): string[] {
  const out = new Set<string>()
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (isAssetRef(v) && !v.includes('{')) out.add(v)
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x)
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x)
    }
  }
  walk(config)
  return [...out]
}

/** Fill the by-ref asset table (`chunks.assets`). Returns a new manifest. */
export function fillPackageAssets(manifest: PackageManifest, assets: Record<string, ManifestAsset>): PackageManifest {
  return { ...manifest, chunks: { ...manifest.chunks, assets } }
}
