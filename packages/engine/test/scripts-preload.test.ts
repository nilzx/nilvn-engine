// @vitest-environment jsdom
// Batch I inc 3 — multi-file works as chunks (`[game] scripts` / `loadScripts`),
// `[include]`, `[call]` / `[return]` with the call stack in the save, and asset
// preloading (`[preload]` section + command, the loading page, `onPreload`).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, buildFileManifest, expandIncludes, scanAssetRefs, scanLabels, scriptId, type Engine } from '../src/index'
import type { EnginePlugin, PluginContext } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
  ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve()
})
afterEach(() => vi.unstubAllGlobals())

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, baseUrl: 'http://game.test/play/', ...opts })
}
/** A fetch that serves text files by URL and records what was asked for. */
function serve(files: Record<string, string>, delayMs = 0): string[] {
  const asked: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input)
    asked.push(url)
    if (delayMs) await tick(delayMs)
    const body = files[url]
    if (body === undefined) return new Response('nope', { status: 404 })
    return new Response(body, { status: 200 })
  })
  return asked
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''

describe('file chunks', () => {
  it('scriptId / scanLabels / buildFileManifest: one chunk per file, global label index, duplicates, fall-through', () => {
    expect(scriptId('scenes/ch1.nvn?x=1')).toBe('ch1')
    expect(scanLabels('[label a]\n  [label b ]\nx: [label c]\n')).toEqual(['a', 'b'])
    const { manifest, duplicates } = buildFileManifest(
      [
        { id: 'one', url: 'u1', body: '[label a]\n[label shared]\n' },
        { id: 'two', url: 'u2', body: '[label b]\n[label shared]\n' },
      ],
      'en',
    )
    expect(manifest.entry.label).toBe('one')
    expect(manifest.labelIndex).toEqual({ one: 'one', a: 'one', shared: 'one', two: 'two', b: 'two' })
    expect(manifest.chunks.map((c) => c.next)).toEqual([['two'], []])
    expect(duplicates).toEqual([{ label: 'shared', first: 'one', second: 'two' }])
  })

  it('[game] scripts plays the files in order; jumps cross files; a file stem is a label; saves address the file', async () => {
    const asked = serve({
      'http://game.test/play/a.nvn': 'narr: in a\n[jump c_label]\n[label after]\nnarr: back in a\n',
      'http://game.test/play/b.nvn': 'narr: in b\n[set done = 1]\n',
      'http://game.test/play/c.nvn': '[label c_label]\nnarr: in c\n[jump after]\n',
    })
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    applyConfig(e, { game: { scripts: ['a.nvn', 'b.nvn', 'c.nvn'] } })
    void e.start()
    await until(() => text(e) === 'in a')
    expect(asked.filter((u) => u.endsWith('.nvn'))).toHaveLength(3) // all fetched up front (the label index needs them)
    e.stage.root.click()
    await until(() => text(e) === 'in c')
    const save = e.saveState()
    expect(save.at.label).toBe('c_label')
    e.stage.root.click()
    await until(() => text(e) === 'back in a')
    e.stage.root.click()
    await until(() => text(e) === 'in b') // a falls through into b (list order), not into c (physically next)
    e.stage.root.click()
    await until(() => e.vars.done === 1)
    // A fresh engine restores the save: the file's chunk is made resident on demand.
    // showTitle() loads the files too (a work with `scripts` and no `entry`).
    const f = engineWith({}, store)
    applyConfig(f, { game: { scripts: ['a.nvn', 'b.nvn', 'c.nvn'] } })
    await f.showTitle()
    expect(f.session).toBe('title')
    expect(f.stage.chrome.currentScreen()).toBe('title')
    expect(await f.restoreState(save)).toBe(true)
    await until(() => text(f) === 'in c')
    e.destroy()
    f.destroy()
  })

  it('a label defined in two files is reported and the first wins; a missing file rejects prepare', async () => {
    serve({
      'http://game.test/play/a.nvn': '[label dup]\nnarr: first\n',
      'http://game.test/play/b.nvn': '[label dup]\nnarr: second\n',
    })
    const e = engineWith()
    applyConfig(e, { game: { scripts: ['a.nvn', 'b.nvn'] } })
    e.loadSource('') // nothing resident: prepare loads the files
    await e.prepare()
    expect(e.diagnostics.some((d) => d.message.includes('label "dup" is defined in both "a" and "b"'))).toBe(true)
    e.destroy()
    const g = engineWith()
    applyConfig(g, { game: { scripts: ['a.nvn', 'missing.nvn'] } })
    await expect(g.prepare()).rejects.toThrow(/missing\.nvn: 404/)
    g.destroy()
  })
})

describe('[include]', () => {
  it('splices files in, nested, relative to the including file; cycles and missing files are reported', async () => {
    const files: Record<string, string> = {
      'http://h/x/main.nvn': 'a\n[include parts/head.nvn]\nz\n',
      'http://h/x/parts/head.nvn': 'h1\n[include deeper.nvn]\n',
      'http://h/x/parts/deeper.nvn': 'd1\n[include "../main.nvn"]\n[include gone.nvn]\n',
    }
    const reports: string[] = []
    const out = await expandIncludes(files['http://h/x/main.nvn']!, 'http://h/x/main.nvn', {
      fetchText: (url) => (files[url] !== undefined ? Promise.resolve(files[url]!) : Promise.reject(new Error('HTTP 404'))),
      resolve: (path, from) => new URL(path, from).href,
      report: (m) => reports.push(m),
    })
    expect(out).toBe('a\nh1\nd1\nz\n')
    expect(reports).toEqual(['[include ../main.nvn] skipped — it includes itself', '[include gone.nvn] failed: HTTP 404'])
    expect(await expandIncludes('plain\n', 'u', { fetchText: () => Promise.reject(new Error('x')), resolve: (p) => p, report: () => {} })).toBe('plain\n')
  })

  it('a script file with [include] plays the included lines; loadSource text reports instead', async () => {
    serve({
      'http://game.test/play/main.nvn': '[include header.nvn]\nme: hi\n',
      'http://game.test/play/header.nvn': '[actor me name=Included]\n',
    })
    const e = engineWith()
    await e.loadScript('main.nvn')
    void e.start()
    await until(() => text(e) === 'hi')
    expect(e.stage.root.querySelector('.nilvn-name')?.textContent).toBe('Included')
    e.loadSource('[include header.nvn]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    expect(e.diagnostics.some((d) => d.message.includes('[include header.nvn] is resolved when a script file loads'))).toBe(true)
    e.destroy()
  })
})

describe('[call] / [return]', () => {
  it('returns to the line after the call, nests, survives a save / restore, and reports a stray [return]', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    e.loadSource(['[label main]', '[call sub]', 'narr: back', '[return]', '[set done = 1]', '[end 0]', '[label sub]', '[call inner]', 'narr: in sub', '[return]', '[label inner]', 'narr: in inner', '[return]'].join('\n'))
    void e.start()
    await until(() => text(e) === 'in inner')
    const save = e.saveState()
    expect(save.calls).toEqual([{ label: 'main', offset: 2 }, { label: 'sub', offset: 2 }]) // the line AFTER each call
    e.stage.root.click()
    await until(() => text(e) === 'in sub')
    e.stage.root.click()
    await until(() => text(e) === 'back')
    e.stage.root.click()
    await until(() => e.vars.done === 1)
    expect(e.diagnostics.some((d) => d.message.includes('[return] with no [call]'))).toBe(true)
    expect(e.saveState().calls).toBeUndefined()
    // Restore mid-inner: both returns still work.
    expect(await e.restoreState(save)).toBe(true)
    await until(() => text(e) === 'in inner')
    e.stage.root.click()
    await until(() => text(e) === 'in sub')
    e.stage.root.click()
    await until(() => text(e) === 'back')
    e.destroy()
  })

  it('an unknown [call] target reports and remembers nothing', async () => {
    const e = engineWith()
    e.loadSource('[call nowhere]\n[return]\n[set done = 1]\n')
    void e.start()
    await until(() => e.vars.done === 1)
    expect(e.diagnostics.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringContaining('unknown label "nowhere"'), expect.stringContaining('[return] with no [call]')]))
    e.destroy()
  })
})

describe('preload', () => {
  it('scanAssetRefs finds the built-in commands\' assets and face sprites, skipping colours', () => {
    const e = engineWith({ actors: { yuki: { sprites: '@char/yuki-{face}.png', defaultFace: 'smile' } } })
    e.loadSource(['[bg @bg/a.png]', '[bg color=#000]', '[bg #fff]', '[char yuki angry]', '[char yuki src=@char/alt.png]', '[char yuki]', 'yuki(happy): hi', '[sprite star @fx/s.svg]', '[bgm @bgm/t.mp3]', '[se @se/x.wav]', '[voice @v/1.ogg]', '[window skin=@ui/box.png]', '[bg @bg/a.png]'].join('\n'))
    expect(scanAssetRefs(e['nodes' as never] as never, e.actors)).toEqual(['@bg/a.png', '@char/yuki-angry.png', '@char/alt.png', '@char/yuki-smile.png', '@char/yuki-happy.png', '@fx/s.svg', '@bgm/t.mp3', '@se/x.wav', '@v/1.ogg', '@ui/box.png'])
    e.destroy()
  })

  it('prepare() warms [preload] assets + auto refs on the loading page, in order, reporting failures; onPreload fires', async () => {
    const asked = serve({ 'http://game.test/play/snd/a.wav': 'x', 'http://game.test/play/snd/b.wav': 'x' }, 3)
    const log: string[] = []
    const spy: EnginePlugin = {
      id: 'test.pre',
      activate(ctx: PluginContext) {
        ctx.on('onPreload', (done: number, total: number, ref: string) => log.push(`${done}/${total} ${ref}`))
      },
    }
    const e = engineWith({ plugins: [spy], alias: { '@img': 'img', '@snd': 'snd' } })
    applyConfig(e, { preload: { assets: ['@snd/a.wav', '@snd/missing.wav'], auto: true, concurrency: 1, heading: 'Warming up' } })
    e.loadSource('[bg @img/bg.png]\n[se @snd/b.wav]\nnarr: go\n')
    let sawScreen = false
    let sawProgress = ''
    const watch = setInterval(() => {
      const s = e.stage.root.querySelector<HTMLElement>('.nilvn-screen--loading')
      if (s) {
        sawScreen = true
        sawProgress = s.querySelector<HTMLElement>('.nilvn-screen__progress')?.style.getPropertyValue('--progress') ?? ''
      }
    }, 1)
    await e.prepare()
    clearInterval(watch)
    expect(sawScreen).toBe(true)
    expect(sawProgress).not.toBe('')
    expect(e.stage.root.querySelector('.nilvn-screen--loading')).toBeNull()
    expect(log).toEqual(['1/4 @snd/a.wav', '2/4 @snd/missing.wav', '3/4 @img/bg.png', '4/4 @snd/b.wav'])
    expect(asked).toEqual(['http://game.test/play/snd/a.wav', 'http://game.test/play/snd/missing.wav', 'http://game.test/play/snd/b.wav']) // the image decodes, not fetches
    expect(e.diagnostics.some((d) => d.message.includes('preload of "@snd/missing.wav" failed: HTTP 404'))).toBe(true)
    // Only once per loaded content.
    await e.prepare()
    expect(log).toHaveLength(4)
    e.destroy()
  })

  it('[preload …] warms mid-story without a screen; wait=true blocks on one; screens.loading = false hides it', async () => {
    const asked = serve({ 'http://game.test/play/x.wav': 'x', 'http://game.test/play/y.wav': 'x' })
    const e = engineWith()
    e.loadSource('[preload x.wav]\nnarr: one\n[preload y.wav wait=true]\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    expect(asked).toContain('http://game.test/play/x.wav')
    expect(e.stage.root.querySelector('.nilvn-screen--loading')).toBeNull()
    e.stage.root.click()
    await until(() => text(e) === 'two')
    expect(asked).toContain('http://game.test/play/y.wav')
    e.destroy()
    const quiet = engineWith({ screens: { loading: false } })
    applyConfig(quiet, { preload: { assets: ['x.wav'] } })
    quiet.loadSource('narr: q\n')
    let seen = false
    const watch = setInterval(() => {
      if (quiet.stage.root.querySelector('.nilvn-screen--loading')) seen = true
    }, 1)
    await quiet.prepare()
    clearInterval(watch)
    expect(seen).toBe(false)
    quiet.destroy()
    // With the title page up, a preload keeps it (the loading page would replace it).
    const t = engineWith()
    t.loadSource('narr: t\n')
    await t.showTitle()
    await t.preload(['x.wav'], { screen: true })
    expect(t.stage.chrome.currentScreen()).toBe('title')
    t.destroy()
  })
})
