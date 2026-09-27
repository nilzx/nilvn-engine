// @nilvn/plugin-sdk — everything a NilVN plugin author needs behind one import.
//
// The manifest side (plugin.json types, the validator, the extension-point and
// permission catalogs, the id conventions) is re-exported from @nilvn/core.
// The runtime side (EnginePlugin, PluginContext, the capability objects) is
// re-exported TYPE-ONLY from @nilvn/engine, so importing this package never pulls
// the DOM engine into a Node process (spec generation, linters, tests).
//
// The machine-readable contract is `plugin-spec.json` at this package's root
// (generated from ./spec.ts, `pnpm spec:check` keeps it honest); the human one is
// this package's README. A starter package lives under ./template; the first-party
// plugins (@nilvn/plugins) are written against exactly this surface.

import type { PluginManifest } from '@nilvn/core'
import type { EnginePlugin, PluginContext } from '@nilvn/engine'

export {
  PLUGIN_API_VERSION,
  PLUGIN_MANIFEST_FILE,
  BUNDLED_ENTRY,
  PLUGIN_ID_RE,
  PERMISSIONS,
  EXTENSION_POINTS,
  isPluginId,
  matchPermission,
  validatePluginManifest,
  manifestErrors,
  hasEngineHalf,
  hasEditorHalf,
  FIRST_PARTY_ID_PREFIX,
  resolvePluginId,
  isFirstPartyId,
  pluginSlug,
  manifestCommandMap,
  commandRegistry,
  parseSemVer,
  compareSemVer,
  isValidRange,
  satisfiesRange,
  FORMAT_VERSIONS,
  CURRENT_SCHEMA_VERSION,
} from '@nilvn/core'
export type {
  PluginManifest,
  PluginContributions,
  PluginActivation,
  PanelDef,
  Permission,
  PermissionDef,
  PermissionSide,
  CatalogStatus,
  ExtensionPointDef,
  ManifestReport,
  ValidateManifestOptions,
  CommandSchema,
  CommandCategory,
  ParamSchema,
  ParamType,
  ParamOption,
  TextEffectDef,
  ObjectKindSchema,
  EffectSchema,
  ServiceDef,
  ThemeTokenDef,
  SemVer,
} from '@nilvn/core'
export type {
  EnginePlugin,
  EngineOptions,
  PluginContext,
  CommandContext,
  CommandFn,
  TextSpan,
  TextEffectFn,
  StageObjectHandle,
  EffectDef,
  EffectFn,
  EffectParams,
  ObjectKind,
  ObjectKindDecl,
  StandardChannel,
  RecordableProp,
  RecordableValue,
  SaveState,
  SavedLoop,
  DecodedTrack,
  DecodedFrame,
  TransformProp,
  TransformValue,
  TransformKeyframe,
  AnimFrame,
  AnimOpts,
  StageState,
  EngineHooks,
  EngineDiagnostic,
  DiagnosticPhase,
  StageCap,
  AudioCap,
  VarsCap,
  SavesCap,
  SettingsCap,
  BacklogCap,
  ReplayCap,
  ReplayDef,
  UiCap,
  TimerCap,
  ServicesCap,
  ServiceApi,
  VolumeChannel,
  PluginLoader,
  PluginState,
  ActorDef,
  Segment,
  ScriptNode,
  DialogueNode,
  CommandNode,
  LabelNode,
  ChoicesNode,
  ChoiceItem,
} from '@nilvn/engine'
export { buildPluginSpec, PLUGIN_SPEC_VERSION } from './spec.js'
export type { PluginSpecJson, FieldDoc } from './spec.js'

/** Identity helper: `export default definePlugin({ … })` gives the runtime half
 *  full type inference and completion without a build step for JS authors
 *  (`// @ts-check` + JSDoc `@type` work too). */
export function definePlugin<T extends EnginePlugin>(plugin: T): T {
  return plugin
}

/** Identity helper for a `plugin.json` authored in TS/JS and written out later. */
export function defineManifest<T extends PluginManifest>(manifest: T): T {
  return manifest
}

/** Per-activation state for a declarative module. `perActivation(init)` returns
 *  `state(ctx)`: the state object of that activation, created by `init(ctx)` on
 *  first use and dropped when the plugin is released. Commands (`plugin`),
 *  hooks and the save-slice methods get the same `ctx` that `activate` did, so
 *  they all reach the same object:
 *
 *    const state = perActivation(() => ({ kind: 'clear', layer: null }))
 *    export default definePlugin({
 *      activate(ctx) { state(ctx).layer = ctx.ui?.layer('rain') ?? null },
 *      commands: { weather({ str, plugin }) { state(plugin).kind = str(0, 'clear') } },
 *    })
 *
 *  Nothing is shared with the engine: the state stays in the plugin's own realm. */
export function perActivation<S>(init: (ctx: PluginContext) => S): (ctx: PluginContext) => S {
  const live = new WeakMap<PluginContext, S>()
  return (ctx) => {
    if (live.has(ctx)) return live.get(ctx)!
    const s = init(ctx)
    live.set(ctx, s)
    ctx.onDispose(() => live.delete(ctx))
    return s
  }
}
