// @vitest-environment jsdom
// Smoke-tests the SHIPPED bare-engine artifact (`@nilvn/engine/iife`, no
// plugins): builds the IIFE from scripts/build-iife.ts and boots a real engine
// from those minified bytes. (The batteries-included bundle exports inline —
// engine + first-party plugins — has the same smoke in @nilvn/plugins.)
// Unit tests import the TS source; only this file exercises the bundle form —
// minification, the smol-toml stub, the ADV global — so a change that breaks
// the artifact while the source stays green fails here, in plain `pnpm test`,
// instead of in a player's exported game.
//
// Also pins the inc-3 erasure rule: the engine may import @nilvn/core TYPE-ONLY
// (esbuild erases it ⇒ the IIFE carries zero core runtime). A value import
// would silently bundle core; the source scan + byte markers below catch it.
import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_SRC = join(HERE, '..', 'src')
const BUILDER = join(HERE, '..', 'scripts', 'build-iife.ts')

interface AdvGlobal {
  createEngine(opts: { container: HTMLElement; textSpeed?: number }): {
    loadSource(src: string): void
    start(label?: string): Promise<void>
    destroy(): void
  }
  parseScript(src: string): unknown
  WebContentLoader: unknown
}

let code = ''
beforeAll(() => {
  // Build in a child node process (the shared builder's CLI form): esbuild's JS
  // API won't run under this file's jsdom environment.
  const dest = join(tmpdir(), `nilvn-iife-smoke-${process.pid}.js`)
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', BUILDER, dest], { stdio: 'pipe' })
    code = readFileSync(dest, 'utf8')
  } finally {
    rmSync(dest, { force: true })
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
}, 30_000)

/** Evaluate the IIFE the way an exported page does and hand back its global. */
function evalBundle(): AdvGlobal {
  return new Function(`${code}; return ADV`)() as AdvGlobal
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('engine IIFE artifact', () => {
  it('builds to a sane self-contained bundle exposing the export surface', () => {
    expect(code.length).toBeGreaterThan(20_000) // not an accidental stub
    expect(code.length).toBeLessThan(1_000_000) // no dependency explosion
    const ADV = evalBundle()
    // What the export bootstraps actually reach for on the global.
    expect(typeof ADV.createEngine).toBe('function')
    expect(typeof ADV.parseScript).toBe('function')
    expect(typeof ADV.WebContentLoader).toBe('function')
  })

  it('boots and plays real script from the minified bytes', async () => {
    const ADV = evalBundle()
    const container = document.createElement('div')
    document.body.append(container)
    const engine = ADV.createEngine({ container, textSpeed: 0 })
    engine.loadSource('[label s1]\n[set x = 1]\nyuki: Hello from the bundle\n')
    void engine.start()
    await until(() => (container.textContent ?? '').includes('Hello from the bundle'))
    expect(container.querySelector('.nilvn-root')).toBeTruthy()
    engine.destroy()
    container.remove()
  })

  it('imports @nilvn/core type-only (inc-3 erasure rule), so the bundle ships zero core runtime', () => {
    for (const file of walk(ENGINE_SRC)) {
      const src = readFileSync(file, 'utf8')
      // One statement per line-start `import … from '…'`; the lazy span stops at
      // the statement's own specifier, so statements can't bleed into each other.
      for (const stmt of src.match(/^import\b[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? []) {
        if (!stmt.includes('@nilvn/core')) continue
        expect(stmt.startsWith('import type'), `${file}: value import from @nilvn/core:\n${stmt}`).toBe(true)
      }
      // A bare side-effect import would also drag core runtime in.
      expect(/^import\s*['"]@nilvn\/core['"]/m.test(src), `${file}: side-effect import of @nilvn/core`).toBe(false)
    }
    // Byte-level tripwires: literals that exist ONLY in core source. Any of them
    // appearing means a core module got bundled despite the rule above.
    expect(code).not.toContain('__nilvn_unset__') // core serialize.ts
    expect(code).not.toContain('authorUsage') // core's manifest schema field, set only by @nilvn/plugins
    // …and the engine ships NO plugin of its own: the first-party set is @nilvn/plugins' business.
    expect(code).not.toContain('app.nilvn.textfx')
    expect(code).not.toContain('nilvn-menu')
    // Positive control — an engine-own literal proving the scan target is real.
    expect(code).toContain('nilvn-root')
  })
})
