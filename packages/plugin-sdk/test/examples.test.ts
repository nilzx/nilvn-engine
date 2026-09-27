// @vitest-environment jsdom
// The example third-party plugins (examples/weather, examples/achievements) stay
// valid and working: their manifests pass the validator clean, and both run in a
// real engine loaded the way a work loads them — by plugin.json path — through
// commands, a key binding, a save / load and the achievements screen.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validatePluginManifest } from '@nilvn/core'
import { createEngine, type PluginLoader } from '@nilvn/engine'

// Path strings throughout: jsdom replaces the global URL, which node:url rejects.
const dir = join(dirname(fileURLToPath(import.meta.url)), '../examples/')
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Wait for a state rather than a fixed time (the plugin imports take longer under load). */
async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out waiting for the engine')
    await tick(10)
  }
}
const key = (k: string): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {}, cancel() {} })
})

describe('example plugins', () => {
  it.each(['weather', 'achievements'])('%s: the manifest validates with no errors or warnings', (name) => {
    const manifest = JSON.parse(readFileSync(`${dir}${name}/plugin.json`, 'utf8'))
    expect(validatePluginManifest(manifest)).toEqual({ errors: [], warnings: [] })
  })

  it('both run in an engine: weather, its key, a save / load; an unlock and the screen', async () => {
    // Files come from disk: manifests and styles as text, modules by file URL.
    const loader: PluginLoader = {
      fetchManifest: async (url) => JSON.parse(readFileSync(fileURLToPath(String(url)), 'utf8')),
      importModule: (url) => import(/* @vite-ignore */ url),
      fetchText: async (url) => readFileSync(fileURLToPath(String(url)), 'utf8'),
    }
    const container = document.createElement('div')
    document.body.append(container)
    const e = createEngine({ container, textSpeed: 0, pluginLoader: loader, baseUrl: pathToFileURL(dir).href })
    e.loadSource('[use ./weather/plugin.json ./achievements/plugin.json]\n[label s]\nA dry evening.\n[weather rain]\n[achieve prologue]\nIt rains.\n')
    void e.start()
    const text = (): string => container.querySelector('.nilvn-text')?.textContent ?? ''
    await until(() => text() === 'A dry evening.')
    key(' ') // past the dry line: the rain starts
    await until(() => e.getVar('weather.kind') === 'rain')

    expect(e.activePlugins).toEqual(expect.arrayContaining(['com.example.weather', 'com.example.achievements']))
    const layer = container.querySelector<HTMLElement>('.exw-layer')!
    expect(layer.dataset.kind).toBe('rain')
    expect(layer.children.length).toBeGreaterThan(0)
    expect(layer.nextElementSibling?.classList.contains('nilvn-dialog')).toBe(true) // under the dialogue box

    key('w')
    expect(layer.classList.contains('is-hidden')).toBe(true)
    key('w')

    const save = e.saveState()
    expect(save.ext?.['com.example.weather']).toEqual({ kind: 'rain', intensity: 0.6 })
    expect(save.extVersion?.['com.example.weather']).toBe(2)
    await e.restart()
    await until(() => text() === 'A dry evening.')
    expect(layer.dataset.kind).toBe('clear') // a restart is a session entry: parked on the dry line again
    await e.restoreState(save)
    await until(() => text() === 'It rains.')
    expect(layer.dataset.kind).toBe('rain')

    key('k')
    const screen = container.querySelector('.nilvn-screen-plugin')
    expect(screen?.textContent).toContain('1 / 3')
    key('k')
    expect(container.querySelector('.nilvn-screen-plugin')).toBeNull()
    expect(e.diagnostics).toEqual([])
    e.destroy()
  })
})
