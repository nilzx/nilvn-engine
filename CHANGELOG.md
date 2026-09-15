# Changelog

Notable changes to `@nilvn/core`, `@nilvn/engine` and `@nilvn/plugin-sdk`. The
three packages share one version and one `engine-v*` tag. Entries before the
repository was split out of the NilVN monorepo (September 2026) are condensed
from its history.

## 0.14.0 — 2026-09-15

### Breaking

- **The engine ships no plugins.** `createEngine` registers nothing by itself; a
  host passes `registry` + `manifests` (`withFirstParty()` from `@nilvn/plugins`),
  `plugins`, or lets the script `[use …]` a path. The first-party set lives in the
  `@nilvn/plugins` package (repository `nilzx/nilvn-plugins`). `@nilvn/engine/iife`
  is a bare engine bundle; the batteries-included one is `@nilvn/plugins/iife`.
- **No chrome strings in the engine.** Menu text is the menu plugin's manifest
  `messages`; `tUI` / `setUILang` / `uiLangName` remain as the lookup mechanism.
- **Default content language is `en`** when `createEngine` receives no `lang` /
  `defaultLang` (was `zh`).
- **`@nilvn/core` holds no first-party manifests.** `BUNDLED_PLUGIN_IDS`,
  `bundledManifest`, `isBundledPlugin`, `defaultPluginRefs` and `ALL_COMMAND_MAP`
  are gone; `serializeChunk` / `buildScriptPackage` default to the built-in
  commands, so pass `commands: commandRegistry(manifests)` for plugin commands.
  `resolvePluginId` is a prefix rule: a dotless name resolves into `app.nilvn.`.
- **Plugin platform v2.** `AdvPlugin` became `EnginePlugin` (`id`, `permissions`,
  `activate` / `deactivate`); a command context no longer exposes the engine or
  the stage — capabilities come through `ctx.plugin.*`; hooks, text effects and
  effects receive the plugin context last; `onCommand` receives
  `(name, args, params)`; `SaveState.ext` is keyed by plugin id.
- `plugin-spec.json` v2: the `bundled` section is `firstParty: { idPrefix, package, repository }`.

### Added

- `@nilvn/plugin-sdk`: manifest types and validator, the extension-point and
  permission catalogs, the engine's runtime types (type-only), `definePlugin` /
  `defineManifest`, a template package and the generated `plugin-spec.json`.
- Plugin host: `plugin.json` packages (`[use ./x/plugin.json]`, `EngineOptions.pluginLoader`),
  `manifests` / `grant` options, dependencies with version ranges, `activation`
  (`eager` / `onCommand` / `manual`), hot plug (`enablePlugin` / `disablePlugin` /
  `reloadPlugin` / `setPlugins`) with save-slice carry-over and rollback,
  `pluginState`, `ENGINE_VERSION`, `ENGINE_CAPABILITIES`, `firstPartyShortName`.
- Capability surface: `CommandContext.numOpt(key)`, `SettingsCap.languageName(code)`,
  `ObjectKindDecl.recordable` accepts the standard channel names,
  `StageCap.playFrames` / `startLoop` / `stopLoop` accept keyframe wire strings.
- Robustness contract: `EngineDiagnostic`, `EngineOptions.onError` and the
  `onError` hook, `engine.diagnostics` / `missingPlugins` / `isolatedPlugins`,
  `strict`, `pluginFailureLimit`. Content problems never throw to the host.
- Script packages: `nilvn.json` (`PackageManifest`, `buildScriptPackage`,
  `fillPackageAssets`), `Engine.load()` as the one content entry (directory URL,
  zip bytes, inline payload, `ScriptPackage`), `openPackage`, `inlinePackage`,
  `ZipContentLoader`, `InlineContentLoader`, `PackageFormatError`,
  `EngineOptions.saveKey` / `buildInfo`.
- Engine composition: `Engine.destroy()`, the dialogue layer behind the renderer
  seam (`ChoiceHandle` instead of elements), saves that store asset references,
  `FORMAT_VERSIONS` and a table-driven `migrateProject`.
- Core: `FIRST_PARTY_ID_PREFIX`, `isFirstPartyId`, `pluginSlug`,
  `manifestCommandMap`, `commandRegistry(manifests)`.
- Publishable builds: `@nilvn/core` and `@nilvn/plugin-sdk` build to `dist/`,
  `@nilvn/engine/iife` subpath export, `pnpm pack:smoke` consumes the packed
  tarballs from a throwaway project (part of CI), English reference documentation
  under `packages/engine/docs/`.

## 0.13.1 — 2026-09-03

- Chunked play: released chunks are freed for real (`maxResidentChunks`), the
  next chunk and branch targets prefetch in the background, a language switch
  fills the resident chunks' text slices, empty chunks fall through.
- Typing blips follow the voice volume; a failing `<audio>` element reports a
  `MediaError` diagnostic instead of staying silent.

## 0.13.0 — 2026-08-09

- The animation runtime, A–B replays and the per-line voice UI became plugins;
  `SaveState.ext` carries per-plugin state; the dialogue box is a stage object
  (`window:dialog`, `[window skin=]`); editor-only plugins.
- Multi-track audio (`[bgm track=]`), `Engine.destroy()`, no DOM handles reach
  plugins; the IIFE build boots from its minified bytes in CI.

## 0.12.0 — 2026-07-21

- Screenplay contract in core: `parseScreenplay`, `formatScreenplay`, `stripScreenplayMarkup`.

## 0.11.0 — 2026-07-20

- Chunked streaming export and the on-demand runtime (`ContentLoader`, chunk
  manifest, label index, eviction), the large-project data plane, stable
  dotted-id chrome i18n, the vitest base and CI.

## 0.10.0 — 2026-06-29

- Recorded keyframe animation: scene event-frames, single-object loops,
  discrete channels (face / band / visibility), the keyframe wire codec and
  sampling exported for tooling.

## 0.9.0 — 2026-06-24

- Sprite-sheet animation objects, generic object effects, fixed z-bands.

## 0.8.0 — 2026-06-22

- Stage-object runtime model, generic renderer verbs, the object and effect
  registry; plugin hooks no longer receive DOM elements.

## 0.7.0 — 2026-06-22

- The `Renderer` interface; `Stage` became `DomRenderer`.

## 0.6.1 — 2026-06-19

- In-game menu volume controls.
