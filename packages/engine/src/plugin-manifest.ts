// Runtime mirror of core's plugin-manifest catalogs: the engine validates a `plugin.json` and gates
// capability objects by permission WITHOUT a runtime dependency on @nilvn/core,
// so the shipped IIFE stays self-contained. Only what the runtime needs is
// mirrored — permission ids + status, the id grammar, the contract version; the
// core↔engine contract test pins these against core's catalogs.

import type { PluginManifest } from '@nilvn/core'
import { isValidRange, satisfiesRange } from './semver.js'
import { ENGINE_VERSION } from './version.js'

/** = core PLUGIN_API_VERSION. */
export const PLUGIN_API_VERSION = 2
/** = core PLUGIN_MANIFEST_FILE. */
export const PLUGIN_MANIFEST_FILE = 'plugin.json'
/** = core BUNDLED_ENTRY. */
export const BUNDLED_ENTRY = 'bundled'
/** = core FIRST_PARTY_ID_PREFIX: the reserved id namespace of the first-party
 *  plugins (`@nilvn/plugins`). A plugin under it also answers to its short name. */
export const FIRST_PARTY_ID_PREFIX = 'app.nilvn.'

/** `app.nilvn.textfx` → `textfx`; undefined for any other id. */
export function firstPartyShortName(id: string): string | undefined {
  if (!id.startsWith(FIRST_PARTY_ID_PREFIX)) return undefined
  const short = id.slice(FIRST_PARTY_ID_PREFIX.length)
  return short && !short.includes('.') ? short : undefined
}

export interface PermissionMirror {
  id: string
  status: 'active' | 'reserved'
  pattern?: boolean
  /** Which side implements it (`engine` = a capability object here). */
  side: 'engine' | 'editor' | 'host'
}

/** = core PERMISSIONS (id / status / pattern / side). */
export const PERMISSION_IDS: readonly PermissionMirror[] = [
  { id: 'stage.read', status: 'active', side: 'engine' },
  { id: 'stage.write', status: 'active', side: 'engine' },
  { id: 'stage.layer:', status: 'reserved', pattern: true, side: 'engine' },
  { id: 'audio.play', status: 'active', side: 'engine' },
  { id: 'audio.bus:', status: 'reserved', pattern: true, side: 'engine' },
  { id: 'audio.capture', status: 'reserved', side: 'host' },
  { id: 'vars.read', status: 'active', side: 'engine' },
  { id: 'vars.write', status: 'active', side: 'engine' },
  { id: 'save.slice', status: 'active', side: 'engine' },
  { id: 'session.save', status: 'active', side: 'engine' },
  { id: 'session.settings', status: 'active', side: 'engine' },
  { id: 'session.backlog', status: 'active', side: 'engine' },
  { id: 'session.replay', status: 'active', side: 'engine' },
  { id: 'ui.layer', status: 'active', side: 'engine' },
  { id: 'ui.panel', status: 'active', side: 'editor' },
  { id: 'ui.window', status: 'active', side: 'editor' },
  { id: 'ui.toast', status: 'active', side: 'editor' },
  { id: 'ui.inspector', status: 'reserved', side: 'editor' },
  { id: 'project.read', status: 'active', side: 'editor' },
  { id: 'project.commit', status: 'active', side: 'editor' },
  { id: 'assets.read', status: 'active', side: 'editor' },
  { id: 'assets.write', status: 'active', side: 'editor' },
  { id: 'fs.pick', status: 'reserved', side: 'host' },
  { id: 'fs.project', status: 'reserved', side: 'host' },
  { id: 'net:', status: 'reserved', pattern: true, side: 'host' },
  { id: 'clipboard', status: 'reserved', side: 'host' },
  { id: 'timer', status: 'active', side: 'engine' },
  { id: 'ai.text', status: 'reserved', side: 'host' },
  { id: 'ai.image', status: 'reserved', side: 'host' },
  { id: 'ai.audio', status: 'reserved', side: 'host' },
  { id: 'ai.code', status: 'reserved', side: 'host' },
  { id: 'ai.context', status: 'reserved', side: 'host' },
]

/** Resolve a permission id (exact, or a pattern id with a suffix). */
export function matchPermission(id: string): PermissionMirror | undefined {
  for (const p of PERMISSION_IDS) {
    if (p.pattern ? id.startsWith(p.id) && id.length > p.id.length : id === p.id) return p
  }
  return undefined
}

/** Whether the ENGINE can grant `id` (in the catalog, active, engine-side). */
export function engineGrantable(id: string): boolean {
  const def = matchPermission(id)
  return !!def && def.status === 'active' && def.side === 'engine'
}

/** = core PLUGIN_ID_RE. */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

export function isPluginId(s: string): boolean {
  return PLUGIN_ID_RE.test(s)
}

/** Structural check for a fetched `plugin.json` — the subset the runtime needs. */
export function isPluginManifest(x: unknown): x is PluginManifest {
  if (!x || typeof x !== 'object') return false
  const m = x as Partial<PluginManifest>
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.version === 'string'
}

/** Runtime validation of a manifest: what would make the engine refuse to run
 *  it. Returns human-readable problems (empty = OK). Mirrors the error half of
 *  core's `validatePluginManifest` for the fields the runtime acts on. */
export function manifestProblems(m: PluginManifest, engineVersion = ENGINE_VERSION): string[] {
  const out: string[] = []
  if (!isPluginId(m.id)) out.push(`invalid plugin id "${m.id}"`)
  if (m.apiVersion !== undefined && m.apiVersion > PLUGIN_API_VERSION) out.push(`requires plugin API v${m.apiVersion}, engine is v${PLUGIN_API_VERSION}`)
  if (m.engine !== undefined) {
    if (!isValidRange(m.engine)) out.push(`invalid "engine" range "${m.engine}"`)
    else if (!satisfiesRange(engineVersion, m.engine)) out.push(`requires engine ${m.engine}, this engine is ${engineVersion}`)
  }
  for (const [dep, range] of Object.entries(m.dependencies ?? {})) {
    if (!isPluginId(dep)) out.push(`invalid dependency id "${dep}"`)
    if (!isValidRange(range)) out.push(`invalid range "${range}" for dependency "${dep}"`)
  }
  for (const p of m.permissions ?? []) if (!matchPermission(p)) out.push(`unknown permission "${p}"`)
  return out
}
