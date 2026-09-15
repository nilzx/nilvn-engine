// Plugin id conventions and manifest-derived registries — the parts of the plugin
// platform that are CONTRACT, not inventory. Which plugins exist is not core's
// business: the first-party set (manifests + runtime modules + messages) lives in
// @nilvn/plugins, third-party ones in their own packages. Core only knows the id
// grammar, the reserved first-party namespace, and how to derive lookup tables
// from whatever manifests a host hands it.

import type { CommandSchema } from './schema.js'
import type { PluginManifest } from './plugin-manifest.js'
import { BUILTIN_COMMAND_MAP } from './commands.js'

/** The reserved id namespace of the first-party plugins (`app.nilvn.textfx`).
 *  A plugin under it also answers to its short name everywhere a plugin is named
 *  (`[use textfx]`, authoring docs, old projects / packages) — see
 *  {@link resolvePluginId}. Third-party ids must be reverse-DNS under their own
 *  domain, so a dotless name can only ever mean a first-party short name. */
export const FIRST_PARTY_ID_PREFIX = 'app.nilvn.'

/** A short first-party name → its id (`textfx` → `app.nilvn.textfx`); anything
 *  with a dot (already an id) is returned as-is. Pure convention, no table: the
 *  engine aliases the same way when it registers a first-party module. */
export function resolvePluginId(nameOrId: string): string {
  return nameOrId.includes('.') ? nameOrId : FIRST_PARTY_ID_PREFIX + nameOrId
}

/** Whether `id` lives in the first-party namespace (short name or id). */
export function isFirstPartyId(nameOrId: string): boolean {
  return resolvePluginId(nameOrId).startsWith(FIRST_PARTY_ID_PREFIX)
}

/** The last dotted segment of a plugin id (`app.nilvn.textfx` → `textfx`): the
 *  first-party plugins' i18n-id prefix (`plugin.textfx.*`) and style-element suffix. */
export function pluginSlug(id: string): string {
  const i = id.lastIndexOf('.')
  return i < 0 ? id : id.slice(i + 1)
}

/** The commands a set of manifests contributes, keyed by name. */
export function manifestCommandMap(manifests: readonly PluginManifest[]): Record<string, CommandSchema> {
  return Object.fromEntries(manifests.flatMap((m) => (m.contributes?.commands ?? []).map((c) => [c.name, c] as const)))
}

/** A serializer / editor command registry: the built-in commands plus every
 *  command these manifests contribute. Hosts build it once from the manifests
 *  they know (the first-party set and any third-party ones) and pass it to
 *  `serializeChunk` / `buildScriptPackage` so plugin commands round-trip with the
 *  correct positional / named args. Enabled-agnostic on
 *  purpose: round-trip is a document concern, independent of the toggled set. */
export function commandRegistry(manifests: readonly PluginManifest[]): Record<string, CommandSchema> {
  return { ...BUILTIN_COMMAND_MAP, ...manifestCommandMap(manifests) }
}
