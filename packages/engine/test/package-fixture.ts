// Shared script-package fixture for the engine tests (inline / zip forms).
import { deflateRawSync } from 'node:zlib'
import type { PackageManifest } from '@nilvn/core'
import type { InlinePackageData } from '../src/index'

/** A two-scene, pure-flow package (no dialogue, so start() resolves). s1 falls
 *  through to s2; both carry a zh text slice; one bg asset; one actor. */
export function makePackage(): InlinePackageData {
  const manifest: PackageManifest = {
    format: 1,
    title: 'Pack',
    engine: '0.15.0',
    lang: 'zh',
    languages: ['zh', 'en'],
    actors: { yuki: { name: '由纪', nameKey: 'actor.yuki', sprites: 'char/yuki/{face}.png', defaultFace: 'happy' } },
    // A first-party-style short name: the engine resolves it against its registry.
    plugins: [{ id: 'fx' }],
    textSpeed: 55,
    saveKey: 'pack-1',
    chunks: {
      format: 1,
      engine: '0.15.0',
      schemaVersion: 10,
      entry: { label: 's1' },
      defaultLang: 'zh',
      sceneOrder: ['s1', 's2'],
      chunks: [
        { id: 's1', scenes: ['s1'], url: 'chunks/scene/s1.json', bytes: 0, labels: ['s1'], assets: ['bg/room.png'], next: ['s2'], branchTargets: [] },
        { id: 's2', scenes: ['s2'], url: 'chunks/scene/s2.json', bytes: 0, labels: ['s2'], assets: [], next: [], branchTargets: [] },
      ],
      labelIndex: { s1: 's1', s2: 's2' },
      locales: {
        zh: [
          { id: 'base', scenes: [], url: 'chunks/locale/zh/base.json', bytes: 0 },
          { id: 's1', scenes: ['s1'], url: 'chunks/locale/zh/s1.json', bytes: 0 },
        ],
        en: [{ id: 'base', scenes: [], url: 'chunks/locale/en/base.json', bytes: 0 }],
      },
      assets: { 'bg/room.png': { url: 'assets/bg/room.png', bytes: 3, kind: 'bg' } },
    },
  }
  const files: Record<string, string> = {
    'chunks/scene/s1.json': JSON.stringify({ id: 's1', body: '[label s1]\n[set x = 1]\n', labels: ['s1'] }),
    'chunks/scene/s2.json': JSON.stringify({ id: 's2', body: '[label s2]\n[set x = x + 1]\n', labels: ['s2'] }),
    'chunks/locale/zh/base.json': JSON.stringify({ 'actor.yuki': '由纪' }),
    'chunks/locale/zh/s1.json': JSON.stringify({ 's1.hello': '你好' }),
    'chunks/locale/en/base.json': JSON.stringify({ 'actor.yuki': 'Yuki' }),
  }
  return { manifest, files, assets: { 'bg/room.png': 'data:image/png;base64,AAA=' } }
}

/** A minimal zip writer (STORE, or DEFLATE when `deflate` is set) — enough to
 *  hand the loader a standards-shaped archive without depending on the editor. */
export function zip(entries: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const stored = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data
    const method = e.deflate ? 8 : 0
    const lh = new Uint8Array(30 + name.length)
    const ldv = new DataView(lh.buffer)
    ldv.setUint32(0, 0x04034b50, true)
    ldv.setUint16(8, method, true)
    ldv.setUint32(18, stored.length, true)
    ldv.setUint32(22, e.data.length, true)
    ldv.setUint16(26, name.length, true)
    lh.set(name, 30)
    parts.push(lh, stored)
    const ch = new Uint8Array(46 + name.length)
    const cdv = new DataView(ch.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(10, method, true)
    cdv.setUint32(20, stored.length, true)
    cdv.setUint32(24, e.data.length, true)
    cdv.setUint16(28, name.length, true)
    cdv.setUint32(42, offset, true)
    ch.set(name, 46)
    central.push(ch)
    offset += lh.length + stored.length
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, entries.length, true)
  edv.setUint16(10, entries.length, true)
  edv.setUint32(12, centralSize, true)
  edv.setUint32(16, offset, true)
  const all = [...parts, ...central, eocd]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}
