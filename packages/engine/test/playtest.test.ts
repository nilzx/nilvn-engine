// `nilvn playtest`: the pure decisions under the browser-driving parts — which
// key event a name sends, which option / object explore takes next, what a target
// is, where a browser is looked for, the arguments. The browser itself is covered
// by pack:smoke and the demo's routes (they need a local Chrome).
import { describe, it, expect } from 'vitest'
import { keyInfo, leastUsed } from '../src/cli/driver'
import { chromeCandidates } from '../src/cli/chrome'
import { parsePlaytestArgs, targetKind } from '../src/cli/playtest'
import { definePlaytest } from '../src/playtest'

describe('nilvn playtest', () => {
  it('names keys the way the DevTools protocol wants them', () => {
    expect(keyInfo('Space')).toEqual({ key: ' ', code: 'Space', keyCode: 32 })
    expect(keyInfo('Escape')).toEqual({ key: 'Escape', code: 'Escape', keyCode: 27 })
    expect(keyInfo('F5')).toEqual({ key: 'F5', code: 'F5', keyCode: 116 })
    expect(keyInfo('j')).toEqual({ key: 'j', code: 'KeyJ', keyCode: 74 })
    expect(keyInfo('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55 })
    expect(() => keyInfo('Hyper')).toThrow(/unknown key/)
  })

  it('explore takes the least-taken option (the first on a tie)', () => {
    const taken = new Map([['a', 2], ['b', 1]])
    expect(leastUsed(['a', 'b', 'c'], taken)).toBe(2)
    expect(leastUsed(['a', 'b'], taken)).toBe(1)
    expect(leastUsed(['x', 'y'], new Map())).toBe(0)
    expect(leastUsed(['a', 'b'], new Map([['k:a', 1]]), (o) => `k:${o}`)).toBe(1)
  })

  it('tells a URL, a page, a package folder and a work apart', () => {
    const has = (files: string[]) => (rel: string) => files.includes(rel)
    expect(targetKind('http://localhost:5183/', false, has([]))).toBe('url')
    expect(targetKind('dist/game.html', false, has([]))).toBe('html')
    expect(targetKind('public/nilvn.config.toml', false, has([]))).toBe('work')
    expect(targetKind('dist/game', true, has(['nilvn.json', 'index.html']))).toBe('package')
    expect(targetKind('public', true, has(['nilvn.config.toml']))).toBe('work')
    expect(targetKind('dist', true, has(['index.html']))).toBe('site')
    expect(targetKind('src', true, has([]))).toBeUndefined()
  })

  it('looks for a browser where each platform keeps one, NILVN_CHROME first', () => {
    expect(chromeCandidates('darwin', { NILVN_CHROME: '/opt/chrome' })[0]).toBe('/opt/chrome')
    expect(chromeCandidates('darwin', {})).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(chromeCandidates('linux', { PATH: '/usr/bin' })).toContain('/usr/bin/google-chrome')
    expect(chromeCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' }).some((p) => p.endsWith('chrome.exe'))).toBe(true)
  })

  it('parses its arguments', () => {
    expect(parsePlaytestArgs(['public', '--explore', '5', '--only', 'A,B', '-o', 'out', '--headful'])).toMatchObject({ target: 'public', explore: 5, only: ['A', 'B'], out: 'out', headful: true })
    expect(parsePlaytestArgs(['--explore'])).toMatchObject({ explore: 3 })
    expect(() => parsePlaytestArgs(['--gap', 'fast'])).toThrow(/milliseconds/)
    expect(() => parsePlaytestArgs(['a', 'b'])).toThrow(/one target/)
  })

  it('definePlaytest hands its argument back (typing only)', () => {
    const pt = { routes: { smoke: [{ newGame: true as const }, { playToEnd: true as const }] } }
    expect(definePlaytest(pt)).toBe(pt)
  })
})
