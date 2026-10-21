// Shared by the `nilvn` subcommands: argument errors, the work folder's file
// list, the engine script a page ships, and how paths / sizes / times print.

import { existsSync, realpathSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A command-line mistake: printed with the usage text, exit code 2. */
export class UsageError extends Error {}

/** Files that are a project's tooling, never a work's asset. */
export const TOOLING = /(?:^|\/)(?:node_modules|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[^/]+|README[^/]*|LICENSE[^/]*|[^/]+\.(?:ts|tsx|map|md|html|log))$/i

/** Every file under `root`, `/`-separated, minus dot-entries, tooling and the output folder. */
export async function listFolder(root: string, skip: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      const rel = relative(root, full).split(sep).join('/')
      if (skip(rel) || TOOLING.test(rel)) continue
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) out.push(rel)
    }
  }
  await walk(root)
  return out.sort()
}

/** The engine script to ship, and where it came from. */
export function findEngine(engine: string | undefined, from: string[]): { file: string; batteries: boolean } | undefined {
  if (engine) return { file: resolve(engine), batteries: true }
  for (const dir of from) {
    try {
      const file = createRequire(join(dir, 'package.json')).resolve('@nilvn/plugins/iife')
      if (existsSync(file)) return { file, batteries: true }
    } catch {
      /* not installed there */
    }
  }
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/cli/common.js → dist/nilvn-engine.iife.js; src/cli/ (tsx) → dist/
  for (const file of [join(here, '..', 'nilvn-engine.iife.js'), join(here, '..', '..', 'dist', 'nilvn-engine.iife.js')]) if (existsSync(file)) return { file, batteries: false }
  return undefined
}


/** In a source checkout (a `src/` beside the script's `dist/`), the newest
 *  source the engine script is older than — it was built before that edit and
 *  a page would ship yesterday's engine. Undefined when it is current, or for
 *  an installed package (no sources). The batteries script of `@nilvn/plugins`
 *  carries the engine's sources too. */
export async function staleSource(engineFile: string): Promise<string | undefined> {
  const pkg = dirname(dirname(engineFile)), dirs = [join(pkg, 'src')]
  // The engine beside it (its `exports` are import-only, so look it up by folder).
  for (let dir = pkg; ; dir = dirname(dir)) {
    const engine = join(dir, 'node_modules', '@nilvn', 'engine')
    if (existsSync(engine)) {
      dirs.push(join(realpathSync(engine), 'src'))
      break
    }
    if (dirname(dir) === dir) break
  }
  const built = (await stat(engineFile)).mtimeMs
  let newest: { file: string; ms: number } | undefined
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'cli') await walk(full) // the command line is not in the page's script
      } else if (/\.(ts|js|css)$/.test(e.name)) {
        const ms = (await stat(full)).mtimeMs
        if (ms > built && (!newest || ms > newest.ms)) newest = { file: full, ms }
      }
    }
  }
  for (const dir of new Set(dirs)) if (existsSync(dir)) await walk(dir)
  return newest?.file
}

/** `2026-09-28 01:58`, local time. */
export function localTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A path as the user reads it best: relative inside the working folder, absolute outside it. */
export function shown(path: string): string {
  const rel = relative(process.cwd(), path)
  return rel && !rel.startsWith('..') ? rel : path
}

export const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

