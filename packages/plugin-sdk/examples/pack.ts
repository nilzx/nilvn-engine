// Packs the example plugins into a small playable work, in the two forms a
// finished game ships as: a zip script package (`demo.nvs`, played by
// `index.html`) and one self-contained HTML file (`demo.html`). The plugins
// travel INSIDE the package — every file under plugins/<id>/ and in the asset
// table, indexed by `packagePluginAssets` — so the engine loads them with no
// host-side registration at all.
//
//   pnpm --filter @nilvn/engine build      # the engine IIFE the pages embed
//   pnpm --filter @nilvn/plugin-sdk examples:pack
//   → examples/dist/{demo.nvs, index.html, demo.html, nilvn-engine.iife.js}

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizePluginPath, packagePluginAssets, type ManifestAsset, type PackageManifest, type PackagePlugin, type PluginManifest } from '@nilvn/core'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist')
const PLUGINS = ['weather', 'achievements']

// ---- the story ----

const STORY = readFileSync(join(here, 'demo.nvn'), 'utf8')
const LABELS = [...STORY.matchAll(/^\[label (\S+)\]/gm)].map((m) => m[1]!)

// ---- plugin files ----

interface Carried {
  plugin: PackagePlugin
  assets: Record<string, ManifestAsset>
  /** Package path → bytes. */
  files: Map<string, Uint8Array>
}

function carry(dir: string): Carried {
  const root = join(here, dir)
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')) as PluginManifest
  const paths = ['plugin.json', manifest.entries?.engine, ...(manifest.styles ?? []), ...(manifest.assets ?? [])].filter((p): p is string => !!p)
  const bytes = new Map(paths.map((p) => [p, new Uint8Array(readFileSync(join(root, p)))] as const))
  const { plugin, assets } = packagePluginAssets(manifest.id, [...bytes].map(([path, b]) => ({ path, bytes: b.length })))
  const files = new Map<string, Uint8Array>()
  for (const [path, b] of bytes) files.set(assets[`plugins/${manifest.id}/${normalizePluginPath(path)}`]!.url, b)
  return { plugin, assets, files }
}

const carried = PLUGINS.map(carry)
const enc = new TextEncoder()

// ---- nilvn.json ----

const chunkFile = 'chunks/scene/main.json'
const manifest: PackageManifest = {
  format: 1,
  title: 'Plugin examples',
  engine: 'examples',
  lang: 'en',
  languages: ['en'],
  actors: {},
  plugins: carried.map((c) => c.plugin),
  textSpeed: 40,
  saveKey: 'nilvn-plugin-examples',
  config: {
    title: { heading: 'Plugin examples', subtitle: 'weather · achievements' },
    plugins: { 'com.example.weather': { intensity: 0.7 } },
  },
  chunks: {
    format: 1,
    engine: 'examples',
    schemaVersion: 12,
    entry: { label: 'start' },
    defaultLang: 'en',
    sceneOrder: ['start'],
    chunks: [{ id: 'main', scenes: ['start'], url: chunkFile, bytes: 0, labels: LABELS, assets: [], next: [], branchTargets: [] }],
    labelIndex: Object.fromEntries(LABELS.map((l) => [l, 'main'])),
    locales: { en: [{ id: 'base', scenes: [], url: 'chunks/locale/en/base.json', bytes: 2 }] },
    assets: Object.assign({}, ...carried.map((c) => c.assets)),
  },
}
const chunk = JSON.stringify({ id: 'main', body: STORY, labels: LABELS })
const textFiles: Record<string, string> = { [chunkFile]: chunk, 'chunks/locale/en/base.json': '{}' }

// ---- zip (STORE) ----

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const n = enc.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + n.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, n.length, true)
    local.set(n, 30)
    const cen = new Uint8Array(46 + n.length)
    const c = new DataView(cen.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
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

// ---- single file: every plugin file becomes a data URI ----

const MIME: Record<string, string> = { json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', woff2: 'font/woff2' }
const dataUri = (path: string, b: Uint8Array): string => `data:${MIME[path.split('.').pop()!] ?? 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`

// ---- write ----

const req = createRequire(import.meta.url)
let iifePath: string
try {
  iifePath = req.resolve('@nilvn/engine/iife')
} catch {
  iifePath = ''
}
if (!iifePath || !existsSync(iifePath)) {
  console.error('engine IIFE not built — run `pnpm --filter @nilvn/engine build` first')
  process.exit(1)
}
const iife = readFileSync(iifePath, 'utf8')

mkdirSync(out, { recursive: true })
const zipEntries: [string, Uint8Array][] = [['nilvn.json', enc.encode(JSON.stringify(manifest, null, 2))], ...Object.entries(textFiles).map(([p, t]) => [p, enc.encode(t)] as [string, Uint8Array])]
for (const c of carried) for (const [p, b] of c.files) zipEntries.push([p, b])
writeFileSync(join(out, 'demo.nvs'), zip(zipEntries))

const page = (title: string, head: string, boot: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#000}#stage{position:absolute;inset:0;margin:auto;width:min(100vw,177.78vh);height:min(100vh,56.25vw)}</style>
${head}</head><body><div id="stage"></div>
<script>(async () => {
  const engine = ADV.createEngine({ container: document.getElementById('stage') })
  window.engine = engine
  ${boot}
  await engine.showTitle()
})()</script></body></html>
`
writeFileSync(join(out, 'nilvn-engine.iife.js'), iife)
writeFileSync(join(out, 'index.html'), page('Plugin examples (zip)', '<script src="nilvn-engine.iife.js"></script>', `await engine.load(new Uint8Array(await (await fetch('demo.nvs')).arrayBuffer()))`))

const assets: Record<string, string> = {}
for (const c of carried) for (const [p, b] of c.files) assets[p] = dataUri(p, b)
const inline = { manifest, files: textFiles, assets }
writeFileSync(
  join(out, 'demo.html'),
  page('Plugin examples (single file)', `<script>${iife.replace(/<\/script/gi, '<\\/script')}</script>`, `await engine.load(ADV.inlinePackage(${JSON.stringify(inline).replace(/</g, '\\u003c')}))`),
)
console.log(`wrote ${out}/{demo.nvs, index.html, demo.html}`)
