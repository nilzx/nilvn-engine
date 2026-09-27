// @vitest-environment jsdom
// Plugin-to-plugin services (`contributes.services` + ctx.services) and plugin
// theme tokens (`contributes.themeTokens`): the two v3 points that waited for a
// real consumer.
import { describe, it, expect } from 'vitest'
import type { PluginManifest } from '@nilvn/core'
import { createEngine, MemorySaveStore, type Engine } from '../src/index'
import { applyConfig } from '../src/config'
import type { EnginePlugin, PluginContext, ServiceApi } from '../src/types'

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

const GALLERY = 'com.example.gallery'
const BOOK = 'com.example.book'
const man = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({ id, name: id, version: '1.0.0', entries: { engine: 'bundled' }, ...extra })

function boot(registry: EnginePlugin[], manifests: PluginManifest[], use: string[]): Engine {
  const container = document.createElement('div')
  document.body.append(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), registry, manifests, use })
}

describe('ctx.services', () => {
  it('a consumer calls a declared service through async, structured-cloning methods', async () => {
    const unlocked = new Set<string>()
    let seen: unknown
    const gallery: EnginePlugin = {
      id: GALLERY,
      activate(ctx) {
        ctx.services.provide('cg', {
          unlock: (id: string) => void unlocked.add(id),
          list: () => [...unlocked],
          echo: (x: { tags: string[] }) => {
            x.tags.push('mutated') // the caller's object is a clone
            return x
          },
        })
      },
    }
    let book!: PluginContext
    const consumer: EnginePlugin = { id: BOOK, activate: (ctx) => void (book = ctx) }
    const e = boot([gallery, consumer], [man(GALLERY, { contributes: { services: [{ id: 'cg', version: '1.2.0' }] } }), man(BOOK, { dependencies: { [GALLERY]: '^1.0.0' } })], [BOOK])
    e.loadSource('[label s]\nnarr: x\n')
    await e.prepare()
    const cg = book.services.get<ServiceApi & { unlock(id: string): Promise<void>; list(): Promise<string[]>; echo(x: unknown): Promise<unknown> }>(GALLERY, 'cg', '^1.1')!
    expect(cg).toBeDefined()
    await cg.unlock('sunset')
    expect(await cg.list()).toEqual(['sunset'])
    const arg = { tags: ['a'] }
    seen = await cg.echo(arg)
    expect(arg.tags).toEqual(['a'])
    expect(seen).toEqual({ tags: ['a', 'mutated'] })
    await expect((cg as unknown as { echo(x: unknown): Promise<unknown> }).echo({ fn: () => 1 })).rejects.toThrow()
    expect(book.services.get(GALLERY, 'cg', '^2')).toBeUndefined() // range miss
    expect(e.diagnostics.some((d) => d.message.includes('is 1.2.0, needs ^2'))).toBe(true)
    // Withdrawn with the provider: a held stub rejects, a new get finds nothing.
    e.disablePlugin(GALLERY)
    await expect(cg.list()).rejects.toThrow(/no longer available/)
    expect(book.services.get(GALLERY, 'cg')).toBeUndefined()
    e.destroy()
  })

  it('needs the provider in dependencies and the service declared', async () => {
    let book!: PluginContext
    let offered: (() => void) | undefined
    const gallery: EnginePlugin = { id: GALLERY, activate: (ctx) => void (offered = ctx.services.provide('nope', { a: () => 1 })) }
    const consumer: EnginePlugin = { id: BOOK, activate: (ctx) => void (book = ctx) }
    const e = boot([gallery, consumer], [man(GALLERY), man(BOOK)], [GALLERY, BOOK])
    e.loadSource('[label s]\nnarr: x\n')
    await e.prepare()
    expect(typeof offered).toBe('function')
    expect(book.services.get(GALLERY, 'nope')).toBeUndefined()
    const msgs = e.diagnostics.map((d) => d.message)
    expect(msgs.some((m) => m.includes('service "nope" is not declared'))).toBe(true)
    expect(msgs.some((m) => m.includes(`list "${GALLERY}" in dependencies`))).toBe(true)
    e.destroy()
  })
})

describe('contributes.themeTokens', () => {
  const rainId = 'com.example.rain'
  const rain = (tokens: PluginManifest['contributes'] = {}): PluginManifest => man(rainId, { contributes: tokens })

  it('puts the defaults on the stage root while active; [theme] sets them without a diagnostic; they go with the plugin', async () => {
    const e = boot([{ id: rainId }], [rain({ themeTokens: [{ name: 'rain-drop', default: 'var(--nilvn-accent)' }, { name: 'rain-speed', default: '0.8s' }] })], [rainId])
    applyConfig(e, { theme: { 'rain-drop': '#88ccff' } })
    e.loadSource('[label s]\n[theme rain-speed=2s]\nnarr: x\n')
    void e.start()
    await tick(30)
    const css = [...document.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${rainId}"]`)].map((s) => s.textContent).join('')
    expect(css).toContain('--nilvn-rain-drop:var(--nilvn-accent)')
    expect(css).toContain('--nilvn-rain-speed:0.8s')
    expect(e.theme).toMatchObject({ 'rain-drop': '#88ccff', 'rain-speed': '2s' })
    expect(e.diagnostics.filter((d) => d.message.includes('theme token'))).toEqual([])
    e.disablePlugin(rainId)
    expect(document.querySelector(`style[data-plugin="${rainId}"]`)).toBeNull()
    e.destroy()
  })

  it('an unknown token set before the plugins load is judged once they are', async () => {
    const e = boot([{ id: rainId }], [rain({ themeTokens: [{ name: 'rain-drop', default: '#fff' }] })], [rainId])
    applyConfig(e, { theme: { 'rain-drop': '#000', 'rain-bogus': '1' } })
    e.loadSource('[label s]\nnarr: x\n')
    await e.prepare()
    const msgs = e.diagnostics.map((d) => d.message).filter((m) => m.includes('theme token'))
    expect(msgs).toEqual([expect.stringContaining('unknown theme token "rain-bogus"')])
    e.destroy()
  })

  it('module-only plugins: a name outside the prefix, an engine token, a bad value and a taken name are skipped', async () => {
    const mod: EnginePlugin = {
      id: rainId,
      themeTokens: [
        { name: 'snow-flake', default: '#fff' },
        { name: 'rain-ok', default: '1px; color: red' },
        { name: 'rain-fine', default: '#123' },
      ],
    }
    const other: EnginePlugin = { id: 'org.other.rain', themeTokens: [{ name: 'rain-fine', default: '#456' }] }
    const dialog: EnginePlugin = { id: 'org.kit.dialog', themeTokens: [{ name: 'dialog-bg', default: '#000' }] }
    const e = boot([mod, other, dialog], [], [rainId, 'org.other.rain', 'org.kit.dialog'])
    e.loadSource('[label s]\nnarr: x\n')
    await e.prepare()
    const msgs = e.diagnostics.map((d) => d.message)
    expect(msgs.some((m) => m.includes('"snow-flake" must be lower-case words starting with "rain-"'))).toBe(true)
    expect(msgs.some((m) => m.includes('"dialog-bg" is the engine\'s own'))).toBe(true)
    expect(msgs.some((m) => m.includes('"rain-ok": default must be one CSS value'))).toBe(true)
    expect(msgs.some((m) => m.includes(`"rain-fine" is already declared by ${rainId}`))).toBe(true)
    e.destroy()
  })
})
