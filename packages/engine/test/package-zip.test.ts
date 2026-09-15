// The zip form of a script package: ZipContentLoader over bytes in memory
// (central directory walk, STORE + DEFLATE entries via DecompressionStream,
// lazily minted asset blob URLs). Node env — no DOM needed; URL.createObjectURL
// is stubbed since Node has no blob URL registry.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { openPackage, PackageFormatError, ZipContentLoader } from '../src/index'
import { makePackage } from './package-fixture'

/** A minimal zip writer (STORE, or DEFLATE when `deflate` is set) — enough to
 *  hand the loader a standards-shaped archive without depending on the editor. */
function zip(entries: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
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

const enc = new TextEncoder()
function packZip(): Uint8Array {
  const data = makePackage()
  return zip([
    { name: 'nilvn.json', data: enc.encode(JSON.stringify(data.manifest)), deflate: true },
    ...Object.entries(data.files).map(([name, text]) => ({ name, data: enc.encode(text), deflate: name.endsWith('s1.json') })),
    { name: 'assets/bg/room.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'assets/', data: new Uint8Array(0) }, // directory entry, skipped
  ])
}

const minted: Blob[] = []
beforeAll(() => {
  ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    minted.push(b)
    return `blob:mock/${minted.length}`
  }
})
afterAll(() => {
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
})

describe('ZipContentLoader', () => {
  it('opens nilvn.json (deflated) and serves stored + deflated entries', async () => {
    const pkg = await openPackage(packZip())
    expect(pkg.loader).toBeInstanceOf(ZipContentLoader)
    expect(pkg.manifest.title).toBe('Pack')
    expect((await pkg.loader.loadChunk('s1')).body).toContain('[set x = 1]') // deflated
    expect((await pkg.loader.loadChunk('s2')).body).toContain('[set x = x + 1]') // stored
    expect(await pkg.loader.loadLocale('en', 'base')).toEqual({ 'actor.yuki': 'Yuki' })
  })

  it('accepts an ArrayBuffer and a Blob too', async () => {
    const bytes = packZip()
    const buf = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect((await openPackage(buf)).manifest.saveKey).toBe('pack-1')
    expect((await openPackage(new Blob([buf]))).manifest.saveKey).toBe('pack-1')
  })

  it('mints one blob URL per asset ref, typed by extension, and keeps it stable', async () => {
    const pkg = await openPackage(packZip())
    const before = minted.length
    const a = await pkg.loader.assetUrl('bg/room.png')
    const b = await pkg.loader.assetUrl('bg/room.png')
    expect(a).toBe(b)
    expect(minted.length).toBe(before + 1)
    expect(minted[minted.length - 1]!.type).toBe('image/png')
    expect(await pkg.loader.assetUrl('not/indexed.png')).toBe('not/indexed.png')
  })

  it('rejects non-zip bytes and a zip without nilvn.json', async () => {
    await expect(openPackage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(PackageFormatError)
    await expect(openPackage(zip([{ name: 'readme.txt', data: enc.encode('hi') }]))).rejects.toThrow(/nilvn\.json not found/)
  })
})
