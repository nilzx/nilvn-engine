// `nilvn playtest [target] [options]` — plays a work in a real, headless Chrome
// with real mouse and key events, and reports what a player would hit: a route
// that cannot go on, an option or object that is not there or is covered, and
// every engine diagnostic along the way.
//
// Two ways to play:
//   routes    a playtest file (`playtest.mjs` / `.json`, see ../playtest.ts):
//             scripted playthroughs, run in order in one browser profile
//   explore   no script: runs from New game to an ending, taking each prompt's
//             least-taken option and each parked line's least-clicked object,
//             so a few runs spread over the branches
//
// The target is a page URL, a single-file `.html`, a package folder (served
// here), or a work (its config / folder), packed into a temporary folder first.

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Playtest, PlaytestRoute } from '../playtest.js'
import { launchChrome, findChrome, type CdpPage } from './chrome.js'
import { Driver, RouteError, leastUsed } from './driver.js'
import { UsageError, shown } from './common.js'
import { pack } from './pack.js'
import { serveDirectory } from './serve.js'

export const PLAYTEST_USAGE = `Usage: nilvn playtest [target] [options]

Plays a work in a headless Chrome with real mouse and key events and reports
failed routes, unreachable options and objects, and engine diagnostics.

The target: a page URL, a single-file .html, a package folder, or a work (its
nilvn.config.toml or folder — packed first). Default: the current folder.
The page must expose its engine as window.engine (nilvn pack's pages do).

Options:
  -r, --routes <file>     a playtest file, .mjs or .json (default: playtest.mjs
                          or playtest.json in the current folder, when present)
      --only <names>      run only these routes (comma-separated)
      --explore [runs]    explore runs, New game to an ending (default 3; the
                          default mode when there are no routes)
  -o, --out <dir>         screenshots and report.json (default: playtest-report)
      --chrome <path>     the browser (default: a local Chrome, Chromium or
                          Edge; or NILVN_CHROME)
      --headful           show the browser window
      --gap <ms>          pause after each key or click (default 250)
      --allow-diagnostics engine diagnostics do not fail a route
      --engine <file>     when packing a work: the engine script to ship
  -h, --help              this text
`

export interface PlaytestOptions {
  target?: string
  routes?: string
  only?: string[]
  explore?: number
  out: string
  chrome?: string
  headful: boolean
  gap: number
  allowDiagnostics: boolean
  engine?: string
}

export function parsePlaytestArgs(argv: string[]): PlaytestOptions {
  const o: PlaytestOptions = { out: 'playtest-report', headful: false, gap: 250, allowDiagnostics: false }
  const value = (i: number, flag: string): string => {
    const v = argv[i]
    if (v === undefined || v.startsWith('-')) throw new UsageError(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    switch (a) {
      case '-r':
      case '--routes':
        o.routes = value(++i, a)
        break
      case '--only':
        o.only = value(++i, a).split(',').map((s) => s.trim()).filter(Boolean)
        break
      case '--explore': {
        const n = argv[i + 1]
        if (n !== undefined && /^\d+$/.test(n)) {
          o.explore = Number(n)
          i++
        } else o.explore = 3
        break
      }
      case '-o':
      case '--out':
        o.out = value(++i, a)
        break
      case '--chrome':
        o.chrome = value(++i, a)
        break
      case '--headful':
        o.headful = true
        break
      case '--gap':
        o.gap = Number(value(++i, a))
        if (!(o.gap >= 0)) throw new UsageError('--gap takes milliseconds')
        break
      case '--allow-diagnostics':
        o.allowDiagnostics = true
        break
      case '--engine':
        o.engine = value(++i, a)
        break
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`)
        if (o.target) throw new UsageError(`one target at a time (got ${o.target} and ${a})`)
        o.target = a
    }
  }
  return o
}

/** What a target names: how the page is reached. */
export type TargetKind = 'url' | 'html' | 'package' | 'work' | 'site'

/** Classify a target from what is on disk (a pure decision, given `exists`). */
export function targetKind(target: string, isDir: boolean, exists: (rel: string) => boolean): TargetKind | undefined {
  if (/^(https?|file):/i.test(target)) return 'url'
  if (!isDir) {
    if (/\.html?$/i.test(target)) return 'html'
    if (/\.toml$/i.test(target)) return 'work'
    return undefined
  }
  if (exists('nilvn.json') && exists('index.html')) return 'package'
  if (exists('nilvn.config.toml')) return 'work'
  if (exists('index.html')) return 'site'
  return undefined
}

interface RouteResult {
  name: string
  ok: boolean
  error?: string
  diagnostics: string[]
  endings: string[]
  seconds: number
  log: string[]
  screenshot?: string
}

async function loadPlaytest(file: string): Promise<Playtest> {
  const abs = resolve(file)
  if (extname(abs) === '.json') {
    const data = JSON.parse(await readFile(abs, 'utf8')) as Playtest | Record<string, PlaytestRoute>
    return 'routes' in data && typeof data.routes === 'object' ? (data as Playtest) : { routes: data as Record<string, PlaytestRoute> }
  }
  const mod = (await import(pathToFileURL(abs).href)) as { default?: Playtest; routes?: Playtest['routes'] }
  const pt = mod.default ?? (mod.routes ? { routes: mod.routes } : undefined)
  if (!pt || typeof pt.routes !== 'object') throw new UsageError(`${file} exports no routes (export default definePlaytest({ routes: { … } }))`)
  return pt
}

async function openPage(page: CdpPage, url: string): Promise<void> {
  await page.send('Page.navigate', { url })
  for (let i = 0; i < 200; i++) {
    const ready = await page.evaluate<boolean>('!!window.engine && document.readyState === "complete"').catch(() => false)
    if (ready) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`${url}: no window.engine after 20 s — does the page expose its engine?`)
}

export async function playtest(opts: PlaytestOptions): Promise<number> {
  // ---- the page ----
  const cleanups: (() => Promise<void> | void)[] = []
  let url: string
  const target = opts.target ?? '.'
  const abs = resolve(target)
  const info = /^(https?|file):/i.test(target) ? undefined : await stat(abs).catch(() => undefined)
  if (!info && !/^(https?|file):/i.test(target)) throw new UsageError(`no such target: ${target}`)
  const kind = targetKind(target, !!info?.isDirectory(), (rel) => existsSync(join(abs, rel)))
  if (!kind) throw new UsageError(`${target}: not a page, a package folder or a work (no index.html / nilvn.json / nilvn.config.toml)`)
  if (kind === 'url') url = target
  else if (kind === 'html') url = pathToFileURL(abs).href
  else {
    let dir = abs
    if (kind === 'work') {
      const tmp = mkdtempSync(join(tmpdir(), 'nilvn-playtest-pack-'))
      cleanups.push(() => rmSync(tmp, { recursive: true, force: true }))
      const code = await pack({ target, out: tmp, forms: new Set(['dir']), name: 'work', engine: opts.engine, exclude: [], check: false, strict: false })
      if (code !== 0) return code
      dir = join(tmp, 'work')
    }
    const served = await serveDirectory(dir)
    cleanups.push(() => served.close())
    url = served.url
  }

  // ---- what to play ----
  const routesFile = opts.routes ?? ['playtest.mjs', 'playtest.json'].find((f) => existsSync(f))
  const playtestFile = routesFile ? await loadPlaytest(routesFile) : undefined
  let routes = Object.entries(playtestFile?.routes ?? {})
  if (opts.only) {
    const missing = opts.only.filter((n) => !routes.some(([name]) => name === n))
    if (missing.length) throw new UsageError(`no route ${missing.map((n) => JSON.stringify(n)).join(', ')} in ${routesFile}`)
    routes = routes.filter(([name]) => opts.only!.includes(name))
  }
  const exploreRuns = opts.explore ?? (routes.length ? 0 : 3)

  const chrome = findChrome(opts.chrome)
  if (!chrome) {
    console.error(`error: no Chrome, Chromium or Edge found${opts.chrome ? ` at ${opts.chrome}` : ''} — install one, or pass --chrome <path> (or set NILVN_CHROME)`)
    return 1
  }
  const outDir = resolve(opts.out)
  await mkdir(outDir, { recursive: true })
  console.log(`playtest: ${kind === 'url' ? url : shown(abs)}${routesFile ? ` · routes: ${shown(resolve(routesFile))}` : ''}${exploreRuns ? ` · explore ×${exploreRuns}` : ''}`)

  const browser = await launchChrome(chrome, { headful: opts.headful })
  cleanups.push(() => browser.close())
  const results: RouteResult[] = []
  try {
    await openPage(browser.page, url)
    const p = new Driver(browser.page, { outDir, gap: opts.gap })

    const run = async (name: string, body: () => Promise<void>): Promise<void> => {
      const started = Date.now()
      await p.begin()
      let error: string | undefined
      try {
        await body()
      } catch (err) {
        error = err instanceof RouteError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)
      }
      const diagnostics = await p.diagnostics().catch(() => [])
      const r: RouteResult = { name, ok: !error && (opts.allowDiagnostics || diagnostics.length === 0), error, diagnostics, endings: [...p.endings], seconds: Math.round((Date.now() - started) / 1000), log: [...p.lines] }
      if (!r.ok) r.screenshot = await p.screenshot(name).catch(() => undefined)
      results.push(r)
      print(r)
      // A failed route leaves the page anywhere: start the next one from a fresh load
      // (the profile — saves, settings, persistent variables — stays).
      if (error) await openPage(browser.page, url)
    }

    for (const [name, route] of routes) {
      await run(name, async () => {
        if (Array.isArray(route)) await p.steps(route)
        else await route(p)
      })
    }

    const taken = new Map<string, number>()
    for (let i = 1; i <= exploreRuns; i++) {
      await run(`explore ${i}`, async () => {
        // Each run starts from the title page: a route may have left the story
        // anywhere, so load the page again (saves and progress stay).
        if ((await p.state()).session !== 'title') await openPage(browser.page, url)
        await p.newGame()
        let choices = 0
        let clicks = 0
        let lastStop = ''
        let repeats = 0
        for (let round = 0; round < 400; round++) {
          const r = await p.advance()
          const here = `${r.stop}\u0000${r.state.text}`
          repeats = here === lastStop ? repeats + 1 : 0
          lastStop = here
          if (repeats >= 5) throw new RouteError(`stuck: the same ${r.stop} on ${JSON.stringify(r.state.text)} six times in a row`)
          if (r.stop === 'ending') {
            p.log(`${choices} option${choices === 1 ? '' : 's'} taken, ${clicks} click${clicks === 1 ? '' : 's'} on the stage`)
            await p.toTitle()
            return
          }
          if (r.stop === 'choices') {
            const key = r.state.choices.join('\u0001')
            const i = leastUsed(r.state.choices, taken, (o) => `${key}\u0002${o}`)
            taken.set(`${key}\u0002${r.state.choices[i]}`, (taken.get(`${key}\u0002${r.state.choices[i]}`) ?? 0) + 1)
            await p.choose(i)
            choices++
          } else if (r.stop === 'input') p.log(`answered an input with ${await p.answerAnyhow()} at ${JSON.stringify(r.state.text)}`)
          else if (r.stop === 'parked') {
            await p.clickLeastUsed(r.state)
            clicks++
          }
          else if (r.stop === 'screen') {
            p.log(`closed a screen with Escape at ${JSON.stringify(r.state.text)}`)
            await p.press('Escape')
            await p.wait(600)
            if ((await p.state()).screen) throw new RouteError(`a screen at ${JSON.stringify(r.state.text)} does not close with Escape — explore cannot play it; write a route`)
          } else if (r.stop === 'title') {
            // The story itself went back (`[title]`, a "not now" option): the run is over, not broken.
            p.log(`the story went back to the title page — ${choices} option${choices === 1 ? '' : 's'} taken, ${clicks} click${clicks === 1 ? '' : 's'} on the stage`)
            return
          }
          else throw new RouteError(`stalled at ${JSON.stringify(r.state.text)} (session ${r.state.session}): Space does nothing and nothing is clickable`)
        }
        throw new RouteError('no ending within 400 stops')
      })
    }
  } finally {
    for (const c of cleanups.reverse()) await c()
  }

  const failed = results.filter((r) => !r.ok)
  const endings = [...new Set(results.flatMap((r) => r.endings))]
  console.log(`\n${failed.length ? '✗' : '✓'} ${results.length - failed.length} / ${results.length} passed${endings.length ? ` · endings: ${endings.join(', ')}` : ''}`)
  const reportFile = join(outDir, 'report.json')
  await writeFile(reportFile, JSON.stringify({ target: kind === 'url' ? url : relative(process.cwd(), abs), results, endings }, null, 2))
  console.log(`  report: ${shown(reportFile)}`)
  return failed.length ? 1 : 0
}

function print(r: RouteResult): void {
  const head = `${r.ok ? '✓' : '✗'} ${r.name}${r.endings.length ? ` → ${r.endings.join(', ')}` : ''} (${r.seconds} s)`
  console.log(head)
  for (const l of r.log) console.log(`    ${l}`)
  if (r.error) console.log(`    ${r.error.split('\n').join('\n    ')}`)
  for (const d of r.diagnostics) console.log(`    diagnostic: ${d}`)
  if (r.screenshot) console.log(`    screenshot: ${shown(r.screenshot)}`)
}
