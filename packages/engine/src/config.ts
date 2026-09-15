import type { AdvConfig } from './types.js'
import type { Engine } from './engine.js'

/** Stringify and merge per-command default params into the engine table */
export function mergeDefaults(
  target: Record<string, Record<string, string>>,
  source: Record<string, Record<string, string | number | boolean>> | undefined,
): void {
  for (const [cmd, table] of Object.entries(source ?? {})) {
    const t = (target[cmd] ??= {})
    for (const [key, value] of Object.entries(table)) t[key] = String(value)
  }
}

/** Apply a parsed nilvn.config.toml onto an engine instance */
export function applyConfig(engine: Engine, cfg: AdvConfig): void {
  engine.config = cfg
  const game = cfg.game ?? {}
  if (typeof game.title === 'string') document.title = game.title
  if (typeof game.textSpeed === 'number') engine.textSpeed = game.textSpeed
  if (typeof game.entry === 'string') engine.entry = game.entry
  Object.assign(engine.alias, cfg.path)
  Object.assign(engine.actors, cfg.actors)
  Object.assign(engine.macros, cfg.macros)
  mergeDefaults(engine.defaults, cfg.defaults)
  if (cfg.plugins?.use) engine.queueUse(cfg.plugins.use)
}

/** Fetch and parse a TOML config file (the parser loads lazily) */
export async function fetchConfig(url: string): Promise<AdvConfig> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load config ${url}: ${res.status}`)
  const { parse } = await import('smol-toml')
  return parse(await res.text()) as AdvConfig
}
