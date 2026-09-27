// Config-driven works → script packages (`@nilvn/engine/pack`, and the `nilvn pack`
// command built on it). A hand-written work is a folder: `nilvn.config.toml`, one
// or more `.nvn` files, assets, and plugins it carries. `packWork()` turns that
// folder into the files of a script package — the same `nilvn.json` + chunks +
// by-ref assets NilVN Studio exports — so the work plays from a directory, a zip
// or one HTML file exactly as it plays from the config:
//
//   [game] entry / scripts  → one chunk per file (labels global, files fall
//                             through in list order, a file's stem names its
//                             first line — the `loadScripts` rules), `[include]`
//                             lines spliced in
//   [game] title / lang / defaultLang / textSpeed → the manifest's fields
//   [actors.<id>]           → the manifest's actor table (`face` → `defaultFace`)
//   [plugins] use           → the manifest's plugin list; a `…/plugin.json` entry
//                             is CARRIED (its files under `plugins/<id>/`)
//   [path]                  → kept in `config`: the package resolves `@bg/x.svg`
//                             through it onto the asset table, as the config did
//   everything else         → `config`, unchanged
//   every other file        → the by-ref asset table (ref = its path in the folder)
//   catalogs                → one always-warm `base` text slice per language
//
// Pure: the caller hands in the folder's file list and a reader, so the same
// planner serves the command line, a build plugin or a test. Problems are
// returned, never thrown: `error`s make the package unplayable as the author
// meant it (a missing script, an unreadable plugin), `warning`s are what the
// engine would otherwise report at play time (a bad line, a missing image).

import type { ManifestAsset, PackageActor, PackageManifest, PackagePlugin, PluginManifest, ScriptChunk, WorkConfig } from '@nilvn/core'
import type { AdvConfig } from './types.js'
import { buildFileManifest, expandIncludes, scanLabels, scriptId, type ScriptFile } from './scripts.js'
import { checkConfig } from './config-schema.js'
import { parseScript } from './parser.js'
import { scanAssetRefs } from './preload.js'
import { FIRST_PARTY_ID_PREFIX, PLUGIN_MANIFEST_FILE, manifestProblems } from './plugin-manifest.js'
import { PACKAGE_FORMAT, PACKAGE_MANIFEST_FILE, type InlinePackageData } from './package.js'
import { ENGINE_VERSION } from './version.js'

export interface PackInput {
  /** The parsed `nilvn.config.toml`. */
  config: AdvConfig
  /** Every file in the work's folder, relative to the config file's directory,
   *  `/`-separated (`story/day1.nvn`, `assets/bg/sea.svg`). Build output,
   *  `node_modules` and the like should already be left out. */
  files: string[]
  /** A work file's bytes by its path in {@link files}; undefined when missing. */
  read(path: string): Promise<Uint8Array | undefined>
  /** Content catalogs by language (`{ en: { "line.1": "…" } }`), for a work
   *  written with `@key` text. */
  catalogs?: Record<string, Record<string, string>>
  /** Namespaces the player's saves and settings. Default: from the title. */
  saveKey?: string
  /** Stamped as the manifest's `engine` (traceability). Default: this engine's version. */
  producer?: string
  /** What a bare plugin module in `[plugins] use` (`plugins/glitch.js`) says
   *  about itself — its default export's `id`, `permissions` and `version` — so
   *  it travels as a carried plugin with a generated plugin.json. Without it a
   *  bare module is an error (the planner does not run code). */
  describeModule?(path: string): Promise<{ id: string; permissions?: string[]; version?: string }>
}

export interface PackProblem {
  level: 'error' | 'warning'
  message: string
  /** The work file it concerns, when there is one. */
  file?: string
  /** 1-based line within that file (after `[include]` splicing). */
  line?: number
}

export interface PackResult {
  manifest: PackageManifest
  /** Every file of the package by its package-relative path, `nilvn.json` included. */
  files: Map<string, Uint8Array>
  /** Of those, the chunk and text-slice files (JSON text) — the single-file
   *  form's `files`; everything else in `manifest.chunks.assets` is an asset. */
  textFiles: string[]
  problems: PackProblem[]
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Files a folder holds that are the work's source, never one of its assets. */
const SOURCE_FILE = /(?:^|\/)(?:[^/]+\.(?:nvn|toml)|catalogs\.json)$/i

/** The asset `kind` (warm / release policy): the folder under `assets/`, else the first folder. */
function assetKind(path: string): string {
  const parts = path.split('/')
  if (parts.length < 2) return 'asset'
  return (parts[0] === 'assets' && parts.length > 2 ? parts[1] : parts[0])!
}

/** A file name safe for a save key: lowercase, dashes. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'nilvn'
  )
}

/** Expand `@prefix/…` through an alias table (the engine's `resolve` rule). */
function expandAlias(path: string, aliases: Record<string, string>): string {
  for (const [key, value] of Object.entries(aliases)) {
    if (path === key) return value
    if (path.startsWith(key + '/')) return value + path.slice(key.length)
  }
  return path
}

/** Normalize a folder-relative path (`./a/../b.svg` → `b.svg`), keeping
 *  non-ASCII names as written (`海.svg`, not its percent-encoding). */
function normalize(path: string): string {
  const out = new URL(path, 'https://w.invalid/').pathname.slice(1)
  try {
    return decodeURIComponent(out)
  } catch {
    return out
  }
}

/** Whether a module imports a sibling file (`from './x.js'`). */
function hasRelativeImports(bytes: Uint8Array): boolean {
  return /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]\.{1,2}\//m.test(dec.decode(bytes))
}

/** A carried engine module is imported from one URL, alone. */
function selfContained(path: string): PackProblem {
  return { level: 'warning', message: `${path}: a carried plugin's engine module must be one self-contained ES module — its relative imports will not resolve inside a package`, file: path }
}

/** The plugin list entry and short-name spelling of one `use` entry. */
function pluginId(entry: string): string {
  return entry.includes('.') ? entry : FIRST_PARTY_ID_PREFIX + entry
}

/** A package's plugin list, carried plugins and asset table from `[plugins] use`. */
async function carryPlugins(
  use: string[],
  input: PackInput,
  out: Map<string, Uint8Array>,
  assets: Record<string, ManifestAsset>,
  problems: PackProblem[],
): Promise<{ plugins: PackagePlugin[]; owned: Set<string>; ownedDirs: string[] }> {
  const plugins: PackagePlugin[] = []
  const owned = new Set<string>()
  const ownedDirs: string[] = []
  for (const entry of use) {
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      const at = normalize(entry)
      const bytes = await input.read(at)
      if (!bytes) {
        problems.push({ level: 'error', message: `[plugins] use "${entry}": ${at} not found`, file: at })
        continue
      }
      if (!input.describeModule) {
        problems.push({ level: 'error', message: `[plugins] use "${entry}": a bare module needs a ${PLUGIN_MANIFEST_FILE} to travel in a package`, file: at })
        continue
      }
      let about: { id: string; permissions?: string[]; version?: string }
      try {
        about = await input.describeModule(at)
      } catch (err) {
        problems.push({ level: 'error', message: `${at}: could not be read as a plugin module (${err instanceof Error ? err.message : String(err)})`, file: at })
        continue
      }
      const name = at.slice(at.lastIndexOf('/') + 1)
      const manifest = {
        id: about.id,
        name: about.id,
        version: about.version ?? '0.0.0',
        entries: { engine: name },
        ...(about.permissions?.length ? { permissions: about.permissions } : {}),
      } as PluginManifest
      const bad = manifestProblems(manifest)
      if (!about.id || bad.length) {
        problems.push({ level: 'error', message: `${at}: ${bad.join('; ') || 'its default export has no id'}`, file: at })
        continue
      }
      if (hasRelativeImports(bytes)) problems.push(selfContained(at))
      owned.add(at)
      const target = `plugins/${manifest.id}/`
      for (const [rel, b] of [[PLUGIN_MANIFEST_FILE, enc.encode(JSON.stringify(manifest, null, 2))], [name, bytes]] as const) {
        out.set(target + rel, b)
        assets[target + rel] = { url: target + rel, bytes: b.length, kind: 'plugin' }
      }
      plugins.push({ id: manifest.id, entry: target + PLUGIN_MANIFEST_FILE })
      continue
    }
    if (!entry.endsWith('.json')) {
      plugins.push({ id: pluginId(entry) })
      continue
    }
    const at = normalize(entry)
    const raw = await input.read(at)
    if (!raw) {
      problems.push({ level: 'error', message: `[plugins] use "${entry}": ${at} not found`, file: at })
      continue
    }
    let manifest: PluginManifest
    try {
      manifest = JSON.parse(dec.decode(raw)) as PluginManifest
    } catch (err) {
      problems.push({ level: 'error', message: `${at}: not valid JSON (${err instanceof Error ? err.message : String(err)})`, file: at })
      continue
    }
    const bad = manifestProblems(manifest)
    if (!manifest.id || bad.length) {
      problems.push({ level: 'error', message: `${at}: ${bad.join('; ') || 'no id'}`, file: at })
      continue
    }
    const dir = at.slice(0, at.lastIndexOf('/') + 1)
    const own = [PLUGIN_MANIFEST_FILE, manifest.entries?.engine, ...(manifest.styles ?? []), ...(manifest.assets ?? [])].filter(
      (p): p is string => typeof p === 'string' && p !== '' && p !== 'bundled',
    )
    const target = `plugins/${manifest.id}/`
    let complete = true
    for (const rel of new Set(own.map((p) => normalize(p)))) {
      const src = normalize(dir + rel)
      const bytes = await input.read(src)
      if (!bytes) {
        problems.push({ level: 'error', message: `${at}: lists ${rel}, which is not there`, file: at })
        complete = false
        continue
      }
      owned.add(src)
      if (rel === normalize(manifest.entries?.engine ?? '') && hasRelativeImports(bytes)) problems.push(selfContained(src))
      const ref = target + rel
      out.set(ref, bytes)
      assets[ref] = { url: ref, bytes: bytes.length, kind: 'plugin' }
    }
    if (!complete) continue
    if (dir) ownedDirs.push(dir)
    plugins.push({ id: manifest.id, ...(manifest.version ? { version: manifest.version } : {}), entry: target + PLUGIN_MANIFEST_FILE })
  }
  return { plugins, owned, ownedDirs }
}

/** Plan a script package from a config-driven work. See the module comment for
 *  what goes where. Never throws over content; read `problems`. */
export async function packWork(input: PackInput): Promise<PackResult> {
  const problems: PackProblem[] = []
  const files = new Map<string, Uint8Array>()
  const cfg = input.config
  for (const p of checkConfig(cfg)) problems.push({ level: 'warning', message: `config: ${p.path}: ${p.message}` })

  const game = cfg.game ?? {}
  const aliases: Record<string, string> = { ...(cfg.path ?? {}) }
  const lang = game.lang || game.defaultLang || 'en'
  const defaultLang = game.defaultLang || lang
  const catalogs = input.catalogs ?? {}
  const languages = [...new Set([lang, defaultLang, ...Object.keys(catalogs).filter((l) => Object.keys(catalogs[l] ?? {}).length)])]
  const title = typeof game.title === 'string' && game.title ? game.title : 'NilVN'

  // ---- scripts → chunks ----
  const list = game.scripts?.length ? game.scripts : game.entry ? [game.entry] : []
  if (!list.length) problems.push({ level: 'error', message: 'the config names no script — set [game] entry = "story.nvn" or [game] scripts = [...]' })
  const base = 'https://w.invalid/'
  const toPath = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1))
  const read = new Set<string>()
  const scripts: ScriptFile[] = []
  for (const name of list) {
    const path = normalize(name.startsWith('@') ? expandAlias(name, aliases) : name)
    const bytes = await input.read(path)
    if (!bytes) {
      problems.push({ level: 'error', message: `script ${name} not found`, file: path })
      continue
    }
    read.add(path)
    const body = await expandIncludes(dec.decode(bytes), base + path, {
      fetchText: async (url) => {
        const p = toPath(url)
        const b = await input.read(p)
        if (!b) throw new Error(`${p} not found`)
        read.add(p)
        return dec.decode(b)
      },
      resolve: (p, from) => (p.startsWith('@') ? base + normalize(expandAlias(p, aliases)) : new URL(p, from).href),
      report: (message) => problems.push({ level: 'error', message, file: path }),
    })
    scripts.push({ id: scriptId(path), url: path, body })
  }
  const ids = new Set<string>()
  for (const s of scripts) {
    if (ids.has(s.id)) problems.push({ level: 'error', message: `two script files are both named "${s.id}" — give them different names`, file: s.url })
    ids.add(s.id)
  }
  const { manifest: chunks, duplicates } = buildFileManifest(scripts, defaultLang)
  for (const d of duplicates) problems.push({ level: 'warning', message: `label "${d.label}" is defined in both "${d.first}" and "${d.second}" — the first wins` })

  // ---- actors ----
  const actors: Record<string, PackageActor> = {}
  for (const [id, a] of Object.entries(cfg.actors ?? {})) {
    const { face, ...rest } = a as PackageActor & { face?: string }
    actors[id] = { ...rest, ...(face !== undefined && rest.defaultFace === undefined ? { defaultFace: face } : {}) }
  }

  // ---- plugins ----
  const assets: Record<string, ManifestAsset> = {}
  const use = (cfg.plugins?.use ?? []).filter((u): u is string => typeof u === 'string' && u !== '')
  const { plugins, owned, ownedDirs } = await carryPlugins(use, input, files, assets, problems)

  // ---- assets: every other file of the folder, by its path ----
  const scriptAliases = { ...aliases }
  const parsed = scripts.map((s) => ({ s, p: parseScript(s.body) }))
  for (const { p } of parsed)
    for (const n of p.nodes) if (n.type === 'command' && n.name === 'alias' && n.args[0]?.startsWith('@') && n.args[1]) scriptAliases[n.args[0]] ??= n.args[1]
  const folderRefs: string[] = []
  for (const f of input.files) {
    if (read.has(f) || owned.has(f) || SOURCE_FILE.test(f) || ownedDirs.some((d) => f.startsWith(d))) continue
    if (f.split('/').some((seg) => seg.startsWith('.'))) continue
    folderRefs.push(f)
  }
  for (const ref of folderRefs) {
    const bytes = await input.read(ref)
    if (!bytes) continue
    files.set(ref, bytes)
    assets[ref] = { url: ref, bytes: bytes.length, kind: assetKind(ref) }
  }

  // ---- per-chunk asset lists + what the scripts get wrong ----
  const isPlain = (v: string): boolean => !/[{}$]/.test(v) && !/^[a-z]+:/i.test(v) && !v.startsWith('#') && v !== 'none'
  for (const { s, p } of parsed) {
    for (const d of p.diagnostics) problems.push({ level: 'warning', message: d.message, file: s.url, line: d.line })
    for (const n of p.nodes)
      if (n.type === 'command' && n.name === 'use' && n.args.some((a) => a.endsWith('.json') || a.endsWith('.js')))
        problems.push({ level: 'warning', message: `[use ${n.args.join(' ')}] names a plugin by path — list it in [plugins] use so the package carries it`, file: s.url, line: n.line })
    const refs: string[] = []
    for (const r of scanAssetRefs(p.nodes, actors)) {
      if (!isPlain(r)) continue
      const ref = normalize(expandAlias(r, scriptAliases))
      if (assets[ref]) refs.push(ref)
      else if (!r.startsWith('@') || expandAlias(r, scriptAliases) !== r)
        problems.push({ level: 'warning', message: `${r} is not in the work's folder`, file: s.url })
      else problems.push({ level: 'warning', message: `unknown path alias "${r.split('/')[0]}" in "${r}"`, file: s.url })
    }
    const chunk = chunks.chunks.find((c) => c.id === s.id)
    if (chunk) chunk.assets = [...new Set(refs)]
  }
  const walkConfig = (v: unknown, at: string): void => {
    if (typeof v === 'string') {
      const ext = v.slice(v.lastIndexOf('.') + 1).toLowerCase()
      if (!v.includes('/') || !(ext in PACK_MIME) || !isPlain(v) || v.includes(' ')) return
      const ref = normalize(expandAlias(v, aliases))
      if (!assets[ref] && /^(?:@|\.{0,2}\/|[\w-]+\/)/.test(v)) problems.push({ level: 'warning', message: `config: ${at}: ${v} is not in the work's folder` })
    } else if (Array.isArray(v)) v.forEach((x, i) => walkConfig(x, `${at}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkConfig(x, at ? `${at}.${k}` : k)
  }
  const { game: _game, actors: _actors, plugins: pluginsCfg, ...rest } = cfg
  const { use: _u, ...pluginTables } = pluginsCfg ?? {}
  walkConfig({ ...rest, plugins: pluginTables }, '')
  for (const [id, a] of Object.entries(actors)) {
    const tmpls = [a.sprites, ...Object.values(a.layers ?? {}).map((l) => l.src)].filter((t): t is string => !!t)
    for (const t of tmpls) {
      const full = expandAlias(t, aliases)
      const cut = full.indexOf('{')
      const prefix = cut < 0 ? normalize(full) : normalize(full.slice(0, cut) + 'x').slice(0, -1)
      if (!Object.keys(assets).some((r) => r.startsWith(prefix))) problems.push({ level: 'warning', message: `actors.${id}: no file in the folder matches ${t}` })
    }
  }

  // ---- script chunk and text files ----
  const textFiles: string[] = []
  const put = (path: string, value: unknown): number => {
    const bytes = enc.encode(JSON.stringify(value))
    files.set(path, bytes)
    textFiles.push(path)
    return bytes.length
  }
  for (const c of chunks.chunks) {
    const s = scripts.find((x) => x.id === c.id)!
    c.url = `chunks/scene/${c.id}.json`
    c.bytes = put(c.url, { id: c.id, body: s.body, labels: scanLabels(s.body) } satisfies ScriptChunk)
  }
  for (const l of languages) {
    const url = `chunks/locale/${l}/base.json`
    chunks.locales[l] = [{ id: 'base', scenes: [], url, bytes: put(url, catalogs[l] ?? {}) }]
  }
  chunks.engine = input.producer ?? ENGINE_VERSION
  chunks.assets = assets

  // ---- the configuration the package carries ----
  // `nilvn.json` states the entry, languages, title, speed, actors and plugin
  // list itself; `[path]` stays, since the scripts still spell `@bg/…`.
  const { entry: _e, scripts: _s, lang: _l, defaultLang: _d, title: _t, textSpeed: _ts, ...gameRest } = game
  const config: Record<string, unknown> = { ...rest }
  if (Object.keys(gameRest).length) config.game = gameRest
  if (Object.keys(pluginTables).length) config.plugins = pluginTables

  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    title,
    engine: input.producer ?? ENGINE_VERSION,
    lang,
    languages,
    actors,
    plugins,
    textSpeed: typeof game.textSpeed === 'number' ? game.textSpeed : 40,
    saveKey: input.saveKey ?? slugify(title),
    ...(Object.keys(config).length ? { config: config as WorkConfig } : {}),
    chunks,
  }
  files.set(PACKAGE_MANIFEST_FILE, enc.encode(JSON.stringify(manifest, null, 2)))
  return { manifest, files, textFiles, problems }
}

/** File extension → MIME type, for data URIs and servers. */
export const PACK_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  txt: 'text/plain',
}

/** The MIME type of a path by its extension. */
export function mimeOf(path: string): string {
  return PACK_MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** The single-file form's payload (`inlinePackage(data)`): chunk and text files
 *  as text, every asset as a data URI. `base64` encodes bytes (Node: `Buffer`,
 *  browsers: `btoa`). */
export function inlinePayload(result: PackResult, base64: (bytes: Uint8Array) => string): InlinePackageData {
  const text: Record<string, string> = {}
  for (const p of result.textFiles) text[p] = dec.decode(result.files.get(p)!)
  const assets: Record<string, string> = {}
  for (const [ref, a] of Object.entries(result.manifest.chunks.assets)) {
    const bytes = result.files.get(a.url)
    if (bytes) assets[ref] = `data:${mimeOf(a.url)};base64,${base64(bytes)}`
  }
  return { manifest: result.manifest, files: text, assets }
}
