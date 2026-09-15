# @nilvn/core

The contract layer of [NilVN](https://github.com/nilzx/nilvn-engine), a small
visual-novel engine. No DOM, no dependencies. Every other NilVN piece — the
runtime, the studio that authors games, plugins and tooling — agrees on the
shapes defined here, so they can be versioned and shipped separately.

```bash
pnpm add @nilvn/core
```

## What is in it

| Module | Exports | Use it to |
|---|---|---|
| **IR** | `Project`, `Scene`, `SceneNode` (`SayNode`, `NarrateNode`, `CommandNode`, `ChoiceNode`, `SetNode`, `JumpNode`, `LabelNode`, …), `Actor`, `VariableDef`, `ResourceRegistry`, `PluginRef`, `CURRENT_SCHEMA_VERSION`, `migrateProject` | Read, generate or transform a NilVN project: the structured document the studio edits. Text lives in per-language catalogs and nodes hold keys. `migrateProject` brings an older project to the current schema. |
| **Command schema** | `CommandSchema`, `ParamSchema`, `BUILTIN_COMMANDS`, `BUILTIN_COMMAND_MAP`, `getCommandSchema` | Know every built-in script command's parameters, types and defaults — the same data the studio builds its forms from and a linter checks against. |
| **Plugin manifest** | `PluginManifest`, `PluginContributions`, `validatePluginManifest`, `manifestErrors`, `isPluginId`, `PLUGIN_API_VERSION`, `PLUGIN_MANIFEST_FILE`, `EXTENSION_POINTS`, `PERMISSIONS`, `matchPermission`, `hasEngineHalf`, `hasEditorHalf` | Validate a `plugin.json` and introspect the extension-point and permission catalogs. |
| **Plugin ids** | `FIRST_PARTY_ID_PREFIX`, `resolvePluginId`, `isFirstPartyId`, `pluginSlug`, `manifestCommandMap`, `commandRegistry` | The id conventions (`textfx` → `app.nilvn.textfx`, the reserved first-party namespace) and manifest-derived command registries; `commandRegistry(manifests)` is built-ins plus the commands those manifests contribute, what the serializer needs. The first-party plugins themselves live in `@nilvn/plugins`. |
| **Script package** | `PackageManifest`, `PackageActor`, `PackagePlugin`, `PACKAGE_FORMAT`, `PACKAGE_MANIFEST_FILE`, `isPackageManifest`, `buildScriptPackage`, `fillPackageAssets`, `packageLanguages`, `packageActors` | Produce a `nilvn.json` package from a project (pure: returns the manifest and file contents; you write the files). |
| **Chunks** | `ChunkManifest`, `ScriptChunk`, `TextCatalogSlice`, `ContentLoader`, `CHUNK_MANIFEST_FORMAT`, `isChunkManifest`, `buildChunkedExport`, `sceneTextKeys` | The streaming wire format and the loader interface a custom host implements. |
| **Serialization** | `serializeProject`, `serializeChunk`, `SerializeOptions`, `isAssetRef` | IR → the `.nvn` script the engine plays (`keepKeys` emits `@key` references for runtime language switching; `scenes` scopes the output to a chunk). |
| **Catalogs** | `exportCatalog`, `importCatalog`, `catalogToText`, `catalogFromText`, `catalogCompleteness`, `authoredKeys`, `nativeLangName` | Round-trip a project's text through a plain-text translation file. |
| **Screenplay** | `parseScreenplay`, `formatScreenplay`, `stripScreenplayMarkup` | A human-readable markdown screenplay grammar and its normalizer, for writing tools. |
| **Chrome i18n** | `createI18n`, `applyCatalogs`, `registerEnabledPluginCatalogs` | Stable-id UI string lookup shared by hosts and plugins (a plugin's own `messages` register into it). |
| **Versions** | `FORMAT_VERSIONS`, `parseSemVer`, `compareSemVer`, `isValidRange`, `satisfiesRange` | Every independently-versioned format in one table, and the semver subset plugin manifests use. |

## Examples

Validate a plugin manifest against an engine version:

```ts
import { validatePluginManifest } from '@nilvn/core'

const { errors, warnings } = validatePluginManifest(manifest, { engineVersion: '0.14.0' })
if (errors.length) throw new Error(errors.join('\n'))
```

Turn a project into a playable package:

```ts
import { buildScriptPackage, fillPackageAssets, serializeProject } from '@nilvn/core'

const plan = buildScriptPackage(project, { engine: '0.14.0' })
// plan.manifest  → nilvn.json (chunks.assets still empty)
// plan.files     → chunk + locale JSON files to write
// plan.assetRefs → asset references to resolve, then:
const manifest = fillPackageAssets(plan.manifest, { 'assets/bg/street.svg': { url: 'assets/bg/street.svg', bytes: 12034, kind: 'bg' } })

const script = serializeProject(project)   // or a single .nvn for the whole project
```

Walk a project:

```ts
for (const scene of project.scenes) {
  for (const node of scene.nodes) {
    if (node.kind === 'say') console.log(node.actor, project.catalogs[project.meta.defaultLang][node.textKey])
  }
}
```

## Versioning

`FORMAT_VERSIONS` lists the on-disk and on-wire shapes that version independently
of the package: the IR schema (`migrateProject` steps older projects forward),
the chunk manifest, the script package, the engine save state and the plugin API.
Each bumps only when its own shape changes incompatibly.

The runtime that plays what this package describes is
[`@nilvn/engine`](https://www.npmjs.com/package/@nilvn/engine); plugin authors
start from [`@nilvn/plugin-sdk`](https://www.npmjs.com/package/@nilvn/plugin-sdk).

MIT.
