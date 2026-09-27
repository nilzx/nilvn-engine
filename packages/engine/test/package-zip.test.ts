// The zip form of a script package: ZipContentLoader over bytes in memory
// (central directory walk, STORE + DEFLATE entries via DecompressionStream,
// lazily minted asset blob URLs). Node env — no DOM needed; URL.createObjectURL
// is stubbed since Node has no blob URL registry.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openPackage, PackageFormatError, ZipContentLoader } from '../src/index'
import { makePackage, zip } from './package-fixture'

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
