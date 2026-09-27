// @vitest-environment jsdom
// Config-driven works → script packages (`packWork`, behind `nilvn pack`): a
// folder of nilvn.config.toml + several .nvn files + assets + a carried plugin
// becomes a package that plays the way the config did — files as chunks with
// global labels and fall-through, [include] spliced, [path] aliases resolving
// onto the asset table, `face` as the default face, catalogs as text slices —
// and what would go wrong at play time is reported at pack time.
import { describe, it, expect, beforeAll } from 'vitest'
import { applyConfig, inlinePackage, type EnginePlugin, type PluginLoader } from '../src/index'
import { inlinePayload, packWork, type PackInput } from '../src/pack'
import type { AdvConfig } from '../src/types'
import { newEngine } from './helpers'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {} })
})

const enc = new TextEncoder()
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64')

/** A work folder in memory. */
function folder(files: Record<string, string>, config: AdvConfig, over: Partial<PackInput> = {}): PackInput {
  return {
    config,
    files: Object.keys(files),
    read: (p) => Promise.resolve(p in files ? enc.encode(files[p]) : undefined),
    ...over,
  }
}

const PLUGIN_JSON = JSON.stringify({
  id: 'com.example.bell',
  name: 'Bell',
  version: '1.2.0',
  entries: { engine: 'engine.js' },
  permissions: ['vars.write'],
  assets: ['ring.wav'],
})

/** A three-file work with a shared header, aliases, an actor, catalogs and a carried plugin. */
const WORK: Record<string, string> = {
  'nilvn.config.toml': '',
  'story/header.nvn': '[set shared = 1]',
  'story/intro.nvn': '[include header.nvn]\n[bg @bg/sea.svg]\n[bell]\n[jump night]\n',
  'story/day.nvn': '[label day_skipped]\n[set day = 1]\n',
  'story/night.nvn': '[set night = 1]\n[bg @bg/moon.svg]\n',
  'assets/bg/sea.svg': '<svg/>',
  'assets/bg/moon.svg': '<svg/>',
  'assets/char/yu-calm.svg': '<svg/>',
  'assets/ui/logo.svg': '<svg/>',
  'plugins/bell/plugin.json': PLUGIN_JSON,
  'plugins/bell/engine.js': 'export default { id: "com.example.bell" }',
  'plugins/bell/ring.wav': 'RIFF',
  'catalogs.json': '{}',
}
const CONFIG: AdvConfig = {
  game: { title: 'Sea Bell', lang: 'zh', textSpeed: 30, scripts: ['story/intro.nvn', 'story/day.nvn', 'story/night.nvn'] },
  path: { '@bg': 'assets/bg', '@char': 'assets/char' },
  actors: { yu: { name: 'Yu', sprites: '@char/yu-{face}.svg', face: 'calm' } as never },
  plugins: { use: ['textfx', 'plugins/bell/plugin.json'], textfx: { speed: 2 } },
  title: { logo: 'assets/ui/logo.svg' },
}

/** The bell plugin, served to the engine by the loader the package names. */
const bell: EnginePlugin = {
  id: 'com.example.bell',
  commands: { bell: ({ plugin }) => void plugin.vars!.set('rang', plugin.asset('ring.wav')?.startsWith('data:audio/wav') ?? false) },
}
const loader: PluginLoader = {
  fetchManifest: (url) => Promise.resolve(JSON.parse(Buffer.from(url.split(',')[1]!, 'base64').toString('utf8'))),
  importModule: () => Promise.resolve({ default: bell }),
}

describe('packWork', () => {
  it('plans the package the config describes', async () => {
    const r = await packWork(folder(WORK, CONFIG, { catalogs: { en: { 'k.1': 'One' } } }))
    expect(r.problems).toEqual([])
    const m = r.manifest
    expect(m).toMatchObject({ title: 'Sea Bell', lang: 'zh', languages: ['zh', 'en'], textSpeed: 30, saveKey: 'sea-bell' })
    expect(m.chunks.sceneOrder).toEqual(['intro', 'day', 'night'])
    expect(m.chunks.chunks.map((c) => c.next)).toEqual([['day'], ['night'], []])
    expect(m.chunks.labelIndex).toMatchObject({ intro: 'intro', day_skipped: 'day', night: 'night' })
    expect(m.chunks.entry.label).toBe('intro')
    expect(m.chunks.chunks[0]!.assets).toEqual(['assets/bg/sea.svg'])
    // the header is spliced into the chunk, not shipped on its own
    expect(JSON.parse(new TextDecoder().decode(r.files.get('chunks/scene/intro.json'))).body).toContain('[set shared = 1]')
    expect(Object.keys(m.chunks.assets).sort()).toEqual([
      'assets/bg/moon.svg',
      'assets/bg/sea.svg',
      'assets/char/yu-calm.svg',
      'assets/ui/logo.svg',
      'plugins/com.example.bell/engine.js',
      'plugins/com.example.bell/plugin.json',
      'plugins/com.example.bell/ring.wav',
    ])
    expect(m.plugins).toEqual([{ id: 'app.nilvn.textfx' }, { id: 'com.example.bell', version: '1.2.0', entry: 'plugins/com.example.bell/plugin.json' }])
    expect(m.actors.yu).toEqual({ name: 'Yu', sprites: '@char/yu-{face}.svg', defaultFace: 'calm' })
    // what nilvn.json states itself leaves the config; [path] and the rest stay
    expect(m.config).toEqual({ path: CONFIG.path, plugins: { textfx: { speed: 2 } }, title: { logo: 'assets/ui/logo.svg' } })
    expect(m.chunks.locales.en![0]!.url).toBe('chunks/locale/en/base.json')
    expect(r.files.has('nilvn.json')).toBe(true)
  })

  it('plays: the files fall through, labels are global, aliases and the carried plugin resolve', async () => {
    // (jsdom decodes no images: the scripts here leave [bg] out)
    const files = { ...WORK, 'story/intro.nvn': '[include header.nvn]\n[bell]\n[jump night]\n', 'story/night.nvn': '[set night = 1]\n', 'assets/bgm/theme.mp3': 'ID3' }
    // a preload by alias goes through the package's loader, alias expanded
    const config: AdvConfig = { ...CONFIG, path: { ...CONFIG.path, '@bgm': 'assets/bgm' }, preload: { assets: ['@bgm/theme.mp3'] } }
    const r = await packWork(folder(files, config))
    const e = newEngine({ textSpeed: 0, pluginLoader: loader, registry: [{ id: 'app.nilvn.textfx' }] })
    await e.load(inlinePackage(inlinePayload(r, b64)))
    await e.start()
    expect(e.vars).toMatchObject({ shared: 1, night: 1, 'com.example.bell.rang': true })
    expect(e.vars.day).toBeUndefined() // jumped over, as the config-driven work would
    expect(e.resolve('@bg/moon.svg')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(e.actors.yu?.defaultFace).toBe('calm')
    expect(e.diagnostics).toEqual([])
    e.destroy()
  })

  it('reports at pack time what would fail at play time', async () => {
    const files = {
      ...WORK,
      'story/intro.nvn': '[bg @bg/fog.svg]\n[bg @cg/x.png]\n[use ./plugins/bell/plugin.json]\n[unclosed\n',
      'plugins/bell/plugin.json': JSON.stringify({ ...JSON.parse(PLUGIN_JSON), assets: ['ring.wav', 'gone.wav'] }),
    }
    const config: AdvConfig = {
      ...CONFIG,
      game: { ...CONFIG.game, scripts: ['story/intro.nvn', 'story/missing.nvn'] },
      plugins: { use: ['plugins/bell/plugin.json', 'extra.js'] },
      title: { logo: 'assets/ui/nope.svg', heading: '@title.heading' },
    }
    const r = await packWork(folder(files, config))
    const msgs = r.problems.map((p) => `${p.level}: ${p.message}`)
    expect(msgs).toEqual(
      expect.arrayContaining([
        'error: script story/missing.nvn not found',
        'error: [plugins] use "extra.js": extra.js not found',
        'error: plugins/bell/plugin.json: lists gone.wav, which is not there',
        'warning: @bg/fog.svg is not in the work\'s folder',
        'warning: unknown path alias "@cg" in "@cg/x.png"',
        expect.stringMatching(/^warning: \[use \.\/plugins\/bell\/plugin\.json\] names a plugin by path/),
        'warning: config: title.logo: assets/ui/nope.svg is not in the work\'s folder',
      ]),
    )
    expect(r.problems.find((p) => p.message.includes('fog.svg'))?.file).toBe('story/intro.nvn')
    expect(msgs.some((m) => m.includes('@title.heading'))).toBe(false) // a catalog key, not a path
  })

  it('a bare plugin module travels with a generated plugin.json when it can be described', async () => {
    const files = { 'main.nvn': '[glitch]\n', 'fx/glitch.js': 'export default { id: "com.example.glitch", permissions: ["stage.write"] }' }
    const config: AdvConfig = { game: { entry: 'main.nvn' }, plugins: { use: ['fx/glitch.js'] } }
    const blind = await packWork(folder(files, config))
    expect(blind.problems.map((p) => p.message)).toEqual(['[plugins] use "fx/glitch.js": a bare module needs a plugin.json to travel in a package'])
    const r = await packWork(folder(files, config, { describeModule: () => Promise.resolve({ id: 'com.example.glitch', permissions: ['stage.write'] }) }))
    expect(r.problems).toEqual([])
    expect(r.manifest.plugins).toEqual([{ id: 'com.example.glitch', entry: 'plugins/com.example.glitch/plugin.json' }])
    expect(JSON.parse(new TextDecoder().decode(r.files.get('plugins/com.example.glitch/plugin.json')))).toEqual({
      id: 'com.example.glitch',
      name: 'com.example.glitch',
      version: '0.0.0',
      entries: { engine: 'glitch.js' },
      permissions: ['stage.write'],
    })
    expect(Object.keys(r.manifest.chunks.assets)).toEqual(['plugins/com.example.glitch/plugin.json', 'plugins/com.example.glitch/glitch.js'])
  })

  it('names outside ASCII stay as written', async () => {
    const r = await packWork(folder({ '序章.nvn': '[bg @bg/海边.svg]\n', 'assets/bg/海边.svg': '<svg/>' }, { game: { entry: '序章.nvn' }, path: { '@bg': 'assets/bg' } }))
    expect(r.problems).toEqual([])
    expect(r.manifest.chunks.chunks[0]).toMatchObject({ id: '序章', assets: ['assets/bg/海边.svg'] })
  })

  it('an entry-only work is one chunk; no script at all is an error', async () => {
    const one = await packWork(folder({ 'main.nvn': '[set a = 1]\n' }, { game: { entry: 'main.nvn' } }))
    expect(one.problems).toEqual([])
    expect(one.manifest).toMatchObject({ title: 'NilVN', lang: 'en', languages: ['en'], textSpeed: 40 })
    expect(one.manifest.chunks.chunks.map((c) => c.id)).toEqual(['main'])
    const none = await packWork(folder({}, {}))
    expect(none.problems[0]).toMatchObject({ level: 'error', message: expect.stringContaining('names no script') })
  })
})

describe('[actors.<id>] face in a config file', () => {
  it('is the default face (the runtime\'s defaultFace)', () => {
    const e = newEngine()
    applyConfig(e, { actors: { yu: { name: 'Yu', sprites: 'y-{face}.png', face: 'calm' } as never, rin: { defaultFace: 'sad', face: 'calm' } as never } })
    expect(e.actors.yu).toEqual({ name: 'Yu', sprites: 'y-{face}.png', defaultFace: 'calm' })
    expect(e.actors.rin?.defaultFace).toBe('sad')
    e.destroy()
  })
})
