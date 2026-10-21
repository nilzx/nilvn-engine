// `nilvn pack [config | folder] [options]` — packs a config-driven work
// (nilvn.config.toml + .nvn files + assets + the plugins it carries) into a
// script package, in up to three forms:
//
//   <out>/<name>/        a directory package with index.html + nilvn.js beside
//                        nilvn.json — upload it to any static host
//   <out>/<name>.nvs     the package as one zip, for Engine.load(bytes) / players
//   <out>/<name>.html    one self-contained file (engine + package), double-click to play
//
// The planning is `packWork()` (../pack.ts); this file is the file system,
// the zip and the HTML shells around it.

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as zlib from 'node:zlib'
import { parse as parseToml } from 'smol-toml'
import type { AdvConfig } from '../types.js'
import { inlinePayload, packWork, slugify, type PackProblem, type PackResult } from '../pack.js'
import { UsageError, findEngine, kb, listFolder, localTime, shown, staleSource } from './common.js'

export const PACK_USAGE = `Usage: nilvn pack [config | folder] [options]

Packs a work — nilvn.config.toml, its .nvn files, assets and carried plugins —
into a script package. With a folder, its nilvn.config.toml is used; with
nothing, the one in the current directory.

Options:
  -o, --out <dir>       where to write (default: dist-pack)
  -f, --form <list>     dir, zip, html — comma-separated (default: all three)
  -n, --name <name>     file / folder name (default: the title in Latin letters,
                        else "game")
      --engine <file>   the engine script to ship (default: @nilvn/plugins/iife
                        when installed, else this engine's own)
      --catalogs <file> content catalogs, { lang: { key: text } } (default:
                        catalogs.json beside the config, when there is one)
      --save-key <key>  namespaces the player's saves (default: from the title)
      --exclude <path>  leave files under this folder-relative path out (repeatable)
      --check           report problems only, write nothing
      --strict          treat warnings as errors
  -h, --help            this text
`


export interface PackOptions {
  target?: string
  out: string
  forms: Set<'dir' | 'zip' | 'html'>
  name?: string
  engine?: string
  catalogs?: string
  saveKey?: string
  exclude: string[]
  check: boolean
  strict: boolean
}

export function parsePackArgs(argv: string[]): PackOptions {
  const o: PackOptions = { out: 'dist-pack', forms: new Set(['dir', 'zip', 'html']), exclude: [], check: false, strict: false }
  const value = (i: number, flag: string): string => {
    const v = argv[i]
    if (v === undefined || v.startsWith('-')) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    switch (a) {
      case '-o':
      case '--out':
        o.out = value(++i, a)
        break
      case '-f':
      case '--form': {
        const forms = value(++i, a).split(',').map((s) => s.trim()).filter(Boolean)
        for (const f of forms) if (f !== 'dir' && f !== 'zip' && f !== 'html') throw new UsageError(`unknown form "${f}" (dir, zip, html)`)
        o.forms = new Set(forms as ('dir' | 'zip' | 'html')[])
        break
      }
      case '-n':
      case '--name':
        o.name = value(++i, a)
        break
      case '--engine':
        o.engine = value(++i, a)
        break
      case '--catalogs':
        o.catalogs = value(++i, a)
        break
      case '--save-key':
        o.saveKey = value(++i, a)
        break
      case '--exclude':
        o.exclude.push(value(++i, a).replace(/^\.\//, '').replace(/\/$/, ''))
        break
      case '--check':
        o.check = true
        break
      case '--strict':
        o.strict = true
        break
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`)
        if (o.target) throw new UsageError(`one config or folder at a time (got ${o.target} and ${a})`)
        o.target = a
    }
  }
  return o
}

// ---- zip (DEFLATE where it pays, STORE otherwise) ----

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 =
  (zlib as { crc32?: (b: Uint8Array) => number }).crc32 ??
  ((b: Uint8Array): number => {
    let c = 0xffffffff
    for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  })

function zip(entries: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, raw] of entries) {
    const n = enc.encode(name)
    const crc = crc32(raw)
    const packed = raw.length > 64 ? new Uint8Array(zlib.deflateRawSync(raw)) : raw
    const deflate = packed !== raw && packed.length < raw.length * 0.95
    const data = deflate ? packed : raw
    const local = new Uint8Array(30 + n.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, 0x0800, true) // UTF-8 names
    l.setUint16(8, deflate ? 8 : 0, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, raw.length, true)
    l.setUint16(26, n.length, true)
    local.set(n, 30)
    const cen = new Uint8Array(46 + n.length)
    const c = new DataView(cen.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, deflate ? 8 : 0, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, raw.length, true)
    c.setUint16(28, n.length, true)
    c.setUint32(42, offset, true)
    cen.set(n, 46)
    parts.push(local, data)
    central.push(cen)
    offset += local.length + data.length
  }
  const size = central.reduce((s, x) => s + x.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, size, true)
  e.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const buf = new Uint8Array(all.reduce((s, x) => s + x.length, 0))
  let at = 0
  for (const x of all) {
    buf.set(x, at)
    at += x.length
  }
  return buf
}

// ---- HTML shells ----

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** Script text safe inside a <script> element. */
const inScript = (s: string): string => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

function page(result: PackResult, engineTag: string, source: string): string {
  const m = result.manifest
  return `<!doctype html>
<html lang="${escapeHtml(m.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(m.title)}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#stage{position:absolute;inset:0;margin:auto;width:min(100vw,177.78vh);height:min(100vh,56.25vw)}</style>
</head>
<body>
<div id="stage"></div>
${engineTag}
<script>
(async () => {
  const engine = ADV.createEngine({ container: document.getElementById('stage') })
  window.engine = engine
  await engine.load(${source})
  // ?lang=xx opens in one of the work's languages
  const lang = new URLSearchParams(location.search).get('lang')
  if (lang && lang !== engine.lang && engine.languages.includes(lang)) await engine.setLanguage(lang)
  await engine.showTitle()
})()
</script>
</body>
</html>
`
}

function printProblems(problems: PackProblem[]): void {
  for (const p of problems) {
    const where = p.file ? `${p.file}${p.line !== undefined ? `:${p.line}` : ''}: ` : ''
    console.error(`${p.level}: ${where}${p.message}`)
  }
}

/** Pack; returns the exit code. */
export async function pack(opts: PackOptions): Promise<number> {
  const target = resolve(opts.target ?? '.')
  const configFile = (await stat(target).catch(() => undefined))?.isDirectory() ? join(target, 'nilvn.config.toml') : target
  if (!existsSync(configFile)) throw new UsageError(`no config at ${relative(process.cwd(), configFile) || configFile}`)
  const root = dirname(configFile)
  let config: AdvConfig
  try {
    config = parseToml(await readFile(configFile, 'utf8')) as AdvConfig
  } catch (err) {
    console.error(`error: ${basename(configFile)}: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const catalogFile = opts.catalogs ? resolve(opts.catalogs) : join(root, 'catalogs.json')
  let catalogs: Record<string, Record<string, string>> | undefined
  if (existsSync(catalogFile)) {
    try {
      catalogs = JSON.parse(await readFile(catalogFile, 'utf8')) as Record<string, Record<string, string>>
    } catch (err) {
      console.error(`error: ${relative(process.cwd(), catalogFile)}: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  } else if (opts.catalogs) throw new UsageError(`no catalogs at ${opts.catalogs}`)

  const outDir = resolve(opts.out)
  const outRel = relative(root, outDir).split(sep).join('/')
  const inside = outRel !== '' && !outRel.startsWith('..')
  const files = await listFolder(root, (rel) => (inside && (rel === outRel || rel.startsWith(outRel + '/'))) || opts.exclude.some((x) => rel === x || rel.startsWith(x + '/')))
  const result = await packWork({
    config,
    files,
    read: async (p) => {
      if (p.startsWith('..')) return undefined
      return readFile(join(root, ...p.split('/'))).then(
        (b) => new Uint8Array(b),
        () => undefined,
      )
    },
    catalogs,
    saveKey: opts.saveKey,
    // A bare plugin module says who it is by its default export.
    describeModule: async (p) => {
      const mod = (await import(pathToFileURL(join(root, ...p.split('/'))).href)) as { default?: Record<string, unknown> }
      const plugin = (mod.default ?? mod) as { id?: unknown; permissions?: unknown; version?: unknown }
      if (typeof plugin.id !== 'string') throw new Error('its default export has no id')
      return {
        id: plugin.id,
        ...(Array.isArray(plugin.permissions) ? { permissions: plugin.permissions.filter((x): x is string => typeof x === 'string') } : {}),
        ...(typeof plugin.version === 'string' ? { version: plugin.version } : {}),
      }
    },
  })
  const problems = opts.strict ? result.problems.map((p) => ({ ...p, level: 'error' as const })) : result.problems
  printProblems(problems)
  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.length - errors

  const m = result.manifest
  const assetCount = Object.keys(m.chunks.assets).length
  const summary = `${m.chunks.chunks.length} script file${m.chunks.chunks.length === 1 ? '' : 's'}, ${assetCount} asset${assetCount === 1 ? '' : 's'}, ${m.plugins.length} plugin${m.plugins.length === 1 ? '' : 's'} (${m.plugins.filter((p) => p.entry).length} carried)`
  if (errors) {
    console.error(`\n✗ ${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''} — nothing written`)
    return 1
  }
  // The engine script the pages ship (checked with --check too: a stale or
  // missing one is what a first pack would stumble on).
  const pages = opts.forms.has('dir') || opts.forms.has('html')
  const engine = pages ? findEngine(opts.engine, [root, process.cwd()]) : undefined
  if (pages && !engine) {
    console.error('error: no engine script found — build @nilvn/engine, install @nilvn/plugins, or pass --engine <file>')
    return 1
  }
  const firstParty = m.plugins.filter((p) => !p.entry && p.id.startsWith('app.nilvn.'))
  if (engine && !engine.batteries && firstParty.length) {
    console.error(`error: the work uses first-party plugins (${firstParty.map((p) => p.id.slice('app.nilvn.'.length)).join(', ')}) — install @nilvn/plugins (its engine script carries them) or pass --engine <file>`)
    return 1
  }
  const stale = engine && !opts.engine ? await staleSource(engine.file) : undefined
  const engineLine = engine
    ? `  engine: ${shown(engine.file)} (built ${localTime((await stat(engine.file)).mtimeMs)})` +
      (stale ? `\n  ⚠ older than its sources (${shown(stale)} changed since) — rebuild it (pnpm build in its package) or the pages ship the old engine` : '')
    : ''
  if (opts.check) {
    console.log(`✓ ${m.title}: ${summary}${warnings ? ` — ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`)
    if (engineLine) console.log(engineLine)
    return 0
  }

  // A file / folder name safe on any host: the title's ASCII letters and digits,
  // else "game" (pass --name for a non-Latin title).
  const ascii = slugify(m.title).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const name = opts.name ?? (ascii || 'game')
  await mkdir(outDir, { recursive: true })
  const written: string[] = []
  const engineCode = engine ? await readFile(engine.file, 'utf8') : ''

  if (opts.forms.has('dir')) {
    const dir = join(outDir, name)
    await rm(dir, { recursive: true, force: true })
    for (const [p, bytes] of result.files) {
      const f = join(dir, ...p.split('/'))
      await mkdir(dirname(f), { recursive: true })
      await writeFile(f, bytes)
    }
    await writeFile(join(dir, 'nilvn.js'), engineCode)
    await writeFile(join(dir, 'index.html'), page(result, '<script src="nilvn.js"></script>', `'./'`))
    written.push(`${shown(dir)}/  (${result.files.size + 2} files — serve over http)`)
  }
  if (opts.forms.has('zip')) {
    const f = join(outDir, `${name}.nvs`)
    const bytes = zip([...result.files])
    await writeFile(f, bytes)
    written.push(`${shown(f)}  (${kb(bytes.length)})`)
  }
  if (opts.forms.has('html')) {
    const f = join(outDir, `${name}.html`)
    const payload = inlinePayload(result, (b) => Buffer.from(b).toString('base64'))
    const json = JSON.stringify(payload).replace(/</g, '\\u003c')
    const html = page(result, `<script>${inScript(engineCode)}</script>`, `ADV.inlinePackage(${json})`)
    await writeFile(f, html)
    written.push(`${shown(f)}  (${kb(Buffer.byteLength(html))} — double-click to play)`)
  }
  console.log(`✓ ${m.title}: ${summary}${warnings ? ` — ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`)
  if (engineLine) console.log(engineLine)
  if (!opts.name && !ascii) console.log(`  (named "game": the title has no Latin letters — pass --name to choose)`)
  for (const w of written) console.log(`  → ${w}`)
  return 0
}

