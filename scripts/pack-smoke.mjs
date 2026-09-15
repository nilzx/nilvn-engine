#!/usr/bin/env node
// Publish gate for the public packages:
// pack @nilvn/core, @nilvn/engine, @nilvn/plugin-sdk and @nilvn/plugins exactly as
// `pnpm publish` would, unpack the tarballs into a throwaway consumer
// (node_modules/@nilvn/<name> = tarball contents, the shape a registry install
// produces) and prove they are consumable from OUTSIDE the workspace:
//   - tsc with skipLibCheck OFF, under both `bundler` and `NodeNext` resolution
//     (cross-package .d.ts references, `exports` + `types`, explicit .js specifiers);
//   - plain node ESM: core + sdk + the plugins' manifests load without a DOM, the
//     shipped plugin-spec.json equals what the shipped generator builds, the
//     template validates against the packed engine version;
//   - under jsdom: the engine's ESM dist AND the bare IIFE (`@nilvn/engine/iife`)
//     boot and play a line; the plugins' ESM registry and batteries IIFE
//     (`@nilvn/plugins/iife`) boot with `[use textfx]` and render the effect.
// Packages present under packages/ are packed; a missing one (the plugins repo
// has only @nilvn/plugins, the engine repo the other three) is borrowed from the
// workspace's node_modules — i.e. the published version it depends on.
// Usage: pnpm pack:smoke   (runs the packages' `prepack` builds first)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALL = ['core', 'engine', 'plugin-sdk', 'plugins']
const PKGS = ALL.filter((p) => existsSync(join(root, 'packages', p, 'package.json')))
// Where a package this repo does not carry is installed (the plugins repo keeps
// its engine deps under packages/plugins/node_modules; the engine repo has no
// plugins at all — its smoke then skips the plugin sections).
const borrowedFrom = (p) => [join(root, 'node_modules', '@nilvn', p), join(root, 'packages', 'plugins', 'node_modules', '@nilvn', p)].find((d) => existsSync(d))
const BORROWED = ALL.filter((p) => !PKGS.includes(p) && borrowedFrom(p))
const WITH_PLUGINS = PKGS.includes('plugins') || BORROWED.includes('plugins')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })

function main() {
  const work = mkdtempSync(join(tmpdir(), 'nilvn-pack-smoke-'))
  const tgz = join(work, 'tgz')
  const consumer = join(work, 'consumer')
  mkdirSync(tgz)
  mkdirSync(join(consumer, 'node_modules', '@nilvn'), { recursive: true })

  try {
    console.log(`-- packing into ${tgz}`)
    run('pnpm', [...PKGS.flatMap((p) => ['--filter', `@nilvn/${p}`]), 'pack', '--pack-destination', tgz])

    for (const p of PKGS) {
      const file = readdirSync(tgz).find((f) => f.startsWith(`nilvn-${p}-`) && f.endsWith('.tgz'))
      if (!file) throw new Error(`no tarball for @nilvn/${p} in ${tgz}`)
      const dest = join(consumer, 'node_modules', '@nilvn', p)
      mkdirSync(dest, { recursive: true })
      run('tar', ['xzf', join(tgz, file), '--strip-components=1', '-C', dest])
    }
    // Third-party deps the consumer needs, borrowed from the workspace install.
    const link = (name, from) => {
      const src = join(root, from, 'node_modules', name)
      if (!existsSync(src)) throw new Error(`${name} not installed under ${from}/node_modules`)
      const dst = join(consumer, 'node_modules', name)
      mkdirSync(dirname(dst), { recursive: true })
      symlinkSync(src, dst)
    }
    // The engine's own runtime dependency, wherever the engine resolves it from
    // (a workspace package, or a borrowed npm install under pnpm's .pnpm layout).
    const engineDir = PKGS.includes('engine') ? join(root, 'packages', 'engine') : realpathSync(borrowedFrom('engine'))
    const smolDir = packageDir(createRequire(join(engineDir, 'package.json')), 'smol-toml')
    mkdirSync(join(consumer, 'node_modules'), { recursive: true })
    symlinkSync(smolDir, join(consumer, 'node_modules', 'smol-toml'))
    link('jsdom', '.')
    link('typescript', '.')
    // Packages this repo does not carry come from its own install (published versions).
    for (const p of BORROWED) {
      const dst = join(consumer, 'node_modules', '@nilvn', p)
      symlinkSync(borrowedFrom(p), dst)
      console.log(`-- @nilvn/${p} borrowed from the workspace install`)
    }
    for (const p of ALL) if (!PKGS.includes(p) && !BORROWED.includes(p)) console.log(`-- @nilvn/${p} not available here — its smoke is skipped`)

    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'nilvn-pack-smoke', private: true, type: 'module' }, null, 2))
    writeFileSync(join(consumer, 'smoke.ts'), WITH_PLUGINS ? SMOKE_TS + SMOKE_TS_PLUGINS : SMOKE_TS)
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify(TSCONFIG('bundler'), null, 2))
    writeFileSync(join(consumer, 'tsconfig.nodenext.json'), JSON.stringify(TSCONFIG('NodeNext'), null, 2))
    writeFileSync(join(consumer, 'smoke.mjs'), WITH_PLUGINS ? SMOKE_MJS + SMOKE_MJS_PLUGINS : SMOKE_MJS)

    const tsc = join(consumer, 'node_modules', 'typescript', 'bin', 'tsc')
    console.log('-- tsc (bundler resolution, skipLibCheck off)')
    run(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: consumer })
    console.log('-- tsc (NodeNext resolution, skipLibCheck off)')
    run(process.execPath, [tsc, '-p', 'tsconfig.nodenext.json'], { cwd: consumer })
    console.log('-- node runtime smoke')
    run(process.execPath, ['--no-warnings', 'smoke.mjs'], { cwd: consumer })
    console.log(`✓ pack smoke passed for ${PKGS.map((p) => `@nilvn/${p}`).join(', ')}${BORROWED.length ? ` (with ${BORROWED.map((p) => `@nilvn/${p}`).join(', ')} borrowed)` : ''}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** The directory of `name` as `req` resolves it (walk up from its entry file). */
function packageDir(req, name) {
  let dir = dirname(req.resolve(name))
  for (;;) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === name) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error(`${name}: package.json not found above ${req.resolve(name)}`)
    dir = up
  }
}

function TSCONFIG(resolution) {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext',
      moduleResolution: resolution,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      verbatimModuleSyntax: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
    },
    files: ['smoke.ts'],
  }
}

const SMOKE_TS = `
import { validatePluginManifest, CURRENT_SCHEMA_VERSION, commandRegistry, type Project } from '@nilvn/core'
import { createEngine, ENGINE_VERSION, type EnginePlugin, type EngineOptions } from '@nilvn/engine'
import { definePlugin, defineManifest, buildPluginSpec, PERMISSIONS, type PluginContext } from '@nilvn/plugin-sdk'

const manifest = defineManifest({ id: 'com.example.smoke', name: 'plugin.smoke.name', version: '1.0.0', permissions: ['stage.write'] })
const report = validatePluginManifest(manifest, { engineVersion: ENGINE_VERSION })
const plugin: EnginePlugin = definePlugin({
  id: 'com.example.smoke',
  permissions: ['stage.write'],
  commands: {
    async boom({ num, plugin }) {
      await plugin.stage?.animate('camera', [{ x: num('strength', 8) }, { x: 0 }], { durationSec: 0.2, compose: 'offset' })
    },
  },
  activate(ctx: PluginContext) {
    ctx.onDispose(() => {})
  },
})
const opts: EngineOptions = { container: document.body, plugins: [plugin] }
const engine = createEngine(opts)
const schema: number = CURRENT_SCHEMA_VERSION
const spec = buildPluginSpec()
const proj: Project | null = null
export { engine, report, schema, spec, proj, manifest, PERMISSIONS, commandRegistry }
`

const SMOKE_TS_PLUGINS = `
import { withFirstParty, firstPartyPlugins, type FirstPartyName } from '@nilvn/plugins'
import { firstPartyManifests, FIRST_PARTY_IDS } from '@nilvn/plugins/manifests'
const full: EngineOptions = { ...withFirstParty(), container: document.body }
const registry = commandRegistry(firstPartyManifests)
const menuId: string = FIRST_PARTY_IDS.menu
const name: FirstPartyName = 'textfx'
export { full, registry, menuId, name, firstPartyPlugins }
`

const SMOKE_MJS = `
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const core = await import('@nilvn/core')
const sdk = await import('@nilvn/plugin-sdk')
assert.equal(typeof globalThis.document, 'undefined')
const template = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@nilvn/plugin-sdk/template/plugin.json')), 'utf8'))
const spec = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@nilvn/plugin-sdk/plugin-spec.json')), 'utf8'))
assert.deepEqual(sdk.buildPluginSpec(), spec, 'shipped plugin-spec.json equals what the shipped generator builds')
assert.equal(sdk.definePlugin(template), template)
assert.ok(core.CURRENT_SCHEMA_VERSION >= 11)
console.log('  ✓ core + plugin-sdk load in bare node; plugin-spec.json fresh; IR schema', core.CURRENT_SCHEMA_VERSION)

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' })
for (const k of ['window', 'document', 'HTMLElement', 'HTMLMediaElement', 'Element', 'Node', 'Audio', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'localStorage']) {
  if (dom.window[k] === undefined) continue
  try { Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: dom.window[k] }) } catch {}
}
Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
const tick = () => new Promise((r) => setTimeout(r, 10))
const until = async (cond, what) => { for (let i = 0; i < 200 && !cond(); i++) await tick(); assert.ok(cond(), what) }

const engineMod = await import('@nilvn/engine')
const report = core.validatePluginManifest(template, { engineVersion: engineMod.ENGINE_VERSION })
assert.deepEqual(report.errors, [], 'template manifest has no errors')
console.log('  ✓ template manifest validates against engine', engineMod.ENGINE_VERSION)

{
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const engine = engineMod.createEngine({ container, textSpeed: 0 })
  engine.loadSource('[label s1]\\nyuki: Hello from the ESM dist\\n')
  void engine.start()
  await until(() => (container.textContent ?? '').includes('Hello from the ESM dist'), 'ESM engine played the line')
  engine.destroy()
  container.remove()
  console.log('  ✓ @nilvn/engine ESM dist boots and plays under jsdom')
}
{
  const code = readFileSync(fileURLToPath(import.meta.resolve('@nilvn/engine/iife')), 'utf8')
  const ADV = new Function(code + '; return ADV')()
  assert.equal(typeof ADV.createEngine, 'function')
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const engine = ADV.createEngine({ container, textSpeed: 0 })
  engine.loadSource('[label s1]\\nyuki: Hello from the IIFE\\n')
  void engine.start()
  await until(() => (container.textContent ?? '').includes('Hello from the IIFE'), 'IIFE engine played the line')
  engine.destroy()
  console.log('  ✓ @nilvn/engine/iife boots and plays; bytes:', code.length)
}
`


// Appended when @nilvn/plugins is packed or borrowed (the engine repo has neither).
const SMOKE_MJS_PLUGINS = `
{
  const manifests = await import('@nilvn/plugins/manifests')
  assert.ok(manifests.firstPartyManifests.length >= 10, 'first-party manifests load (already under jsdom here, but the module is DOM-free)')
  for (const m of manifests.allFirstPartyManifests) assert.deepEqual(core.validatePluginManifest(m).errors, [], m.id)
  console.log('  ✓ @nilvn/plugins/manifests: every first-party manifest validates')
}
{
  const plugins = await import('@nilvn/plugins')
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const engine = engineMod.createEngine({ ...plugins.withFirstParty(), container, textSpeed: 0 })
  engine.loadSource('[use textfx]\\n[label s1]\\nyuki: {wave:Hi} from the plugins dist\\n')
  void engine.start()
  await until(() => (container.textContent ?? '').includes('Hi from the plugins dist'), 'ESM engine + plugins played the line')
  assert.deepEqual([...engine.activePlugins], ['app.nilvn.textfx'])
  assert.equal(container.querySelectorAll('.tfx-wave').length, 2)
  engine.destroy()
  container.remove()
  console.log('  ✓ @nilvn/plugins ESM dist registers and activates by short name')
}
{
  const code = readFileSync(fileURLToPath(import.meta.resolve('@nilvn/plugins/iife')), 'utf8')
  const ADV = new Function(code + '; return ADV')()
  assert.equal(typeof ADV.createEngine, 'function')
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const engine = ADV.createEngine({ container, textSpeed: 0 })
  engine.loadSource('[use textfx menu]\\n[label s1]\\nyuki: {wave:Hi} from the batteries IIFE\\n')
  void engine.start()
  await until(() => (container.textContent ?? '').includes('Hi from the batteries IIFE'), 'batteries IIFE played the line')
  assert.deepEqual([...engine.activePlugins], ['app.nilvn.textfx', 'app.nilvn.menu'])
  assert.ok(container.querySelector('.nilvn-menu'), 'menu shell rendered')
  engine.destroy()
  console.log('  ✓ @nilvn/plugins/iife boots with the first-party set; bytes:', code.length)
}
`

main()
