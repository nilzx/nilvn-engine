# Changelog

Notable changes to `@nilvn/core`, `@nilvn/engine` and `@nilvn/plugin-sdk`. The
three packages share one version and one `engine-v*` tag. Entries before the
repository was split out of the NilVN monorepo (September 2026) are condensed
from its history.

## 0.15.0 — 2026-09-20

A finished visual novel out of the box: the engine now carries the whole shell —
title and ending pages, the in-game menu, auto / skip, persisted settings, a
themeable dialogue box — configured from `nilvn.config.toml`, no plugin, no CSS.
Read [docs/getting-started.md](packages/engine/docs/getting-started.md) for the
path from an empty folder to a deployed game.

### Added

- **Boot on the title page.** `engine.showTitle()` after `load()` /
  `loadConfig()` is the recommended host pattern (`start()` plays at once and
  resolves when the story ends); NilVN Studio's exports, the desktop player and
  `@nilvn/plugins`' bundler do this. A loaded package's `title` is the title
  page's heading. Skip mode reveals each line at once.
- `docs/getting-started.md`: from an empty folder to a deployed game; npm-user
  commands kept apart from contributor commands; the no-bundler path; small
  screens (`ui-scale`).

- **Plugin platform v3.** Plugin settings: `contributes.config` (a
  `ConfigFieldSchema[]`), the config file's `[plugins.<id>]` tables /
  `createEngine({ pluginConfig })` / `engine.setPluginConfig()`, `ctx.config`
  (`get` / `all` / `onChange`; schema default ← author ← player), `scope: player`
  rows in the game's settings panel, persisted per work. Per-plugin storage:
  `storage.local` → `ctx.storage`. Chrome contributions behind `ui.screen`:
  `contributes.menuItems` / `titleItems` / `hud` wired with `ctx.screen`
  (`menuItem` / `titleItem` / `hud`, plus `open` / `close` for full-stage plugin
  screens). In-engine dialogs: `ui.dialog` → `ctx.dialog` (`confirm` / `alert` /
  `toast`). Actor fields: `contributes.actorFields` — a plugin's keys on an actor
  declaration (`[actors.<id>] voice = 360`, `[actor yuki voice=360]`) land in the
  actor's `ext[pluginId]` and are read with `ctx.actorField()`; `ActorDef.voice`
  is deprecated (still honoured for voicefx). `plugin-spec.json` is v3.

- **The in-game system menu is built in** (`[menu]` in the config: entry
  position, item set, wheel-to-backlog): save / load slots (pages × slots,
  scene-background thumbnails, delete with an in-engine confirm), quick save /
  quick load, the autosave cell, the backlog with voice replay, the replay
  gallery, back-to-title / restart (in-engine confirms), and a settings panel
  (`[settings]`: text speed, auto delay, skip reach, four volumes, language,
  fullscreen, dialogue-box opacity, text size). The title page's Load / Settings
  buttons open the same panels; `engine.openMenu(panel)`.
- **Auto and skip modes** as engine mechanisms: `setAuto` / `setSkip`, `autoDelay`,
  `skipMode = read | all` with per-work read-line tracking, Ctrl held = skip;
  both stop at a choice, a tap ends auto.
- **Player settings persist** per work through the `SaveStore` (`settings`
  key) and are restored at `prepare()`; slot API `saveSlot` / `loadSlot` /
  `quickSave` / `quickLoad` / `writeSave` / `readSave` / `loadSave` /
  `deleteSave`; `Renderer.chrome.overlay()` / `confirm()`.

### Breaking

- The `menu` plugin is retired (`@nilvn/plugins` 0.2 no longer ships it).
  `[use menu]` / `app.nilvn.menu` in a script, config or package is ignored with
  one `load` diagnostic. Saves, volumes and replay unlocks the plugin kept in
  `localStorage` migrate into the store on first `prepare()`. `screens: false`
  now also disables the menu; `screens.menu` toggles it alone.

- **Built-in title and ending pages.** `showTitle()` draws a title page from
  the config's new `[title]` (heading, subtitle, logo, background, music,
  buttons, layout, version) and an ending draws `[ending.<id>]` (heading,
  background, music, rolling credits, `after = title | restart`); both follow
  the theme tokens and the work's language. `screens: false` / `enabled = false`
  keep the state machine without the pages. Chrome strings ship in the engine
  again (`en` base, `zh`, `ja`; `CHROME_STRING_IDS`), overridable per work via
  `messages` / `[strings.<lang>]`; `engine.t()`; a plugin's `ctx.t` falls back
  to them.
- **Autosave and Continue.** `[saves] autosave = label | line | false` writes a
  `SlotPayload` under `AUTOSAVE_KEY`; the title page's Continue calls
  `continueGame()`. Persistence goes through the new `SaveStore` seam
  (`engine.saveStore`; `LocalStorageSaveStore` default, `MemorySaveStore`,
  `saveStore` option for a shell's own).
- `Renderer.chrome.showScreen(id, model)` takes a `ScreenModel`;
  `titleModel` / `endingModel` build one (exported).

- **Session lifecycle.** `engine.prepare()` brings content and plugins in
  without playing and resolves `engine.ready` (`onReady` option / hook) — the
  moment a host shows a title page; `start()` calls it and keeps resolving when
  the *story* ends. `engine.session` is `idle` / `title` / `playing` / `ending`
  (`onSessionChange(state, prev)` as a method, an option and a plugin hook);
  `showTitle()` and the new `[title]` command stop the run and clear the session;
  `[ending id]` finishes into a named ending (`engine.ending`; `[end]` is
  `default`). `Renderer.chrome` (`showScreen` / `hideScreen` / `currentScreen`)
  is the screen seam the built-in title / ending screens will use.
- **Plugin hooks**: `onReady`, `onSessionChange`, `onLabel(label)`,
  `onSaved(state)` / `onRestored(state)`, `onSettingsChange(key, value)`
  (`textSpeed`, `volume:<channel>`, `lang`), `onVarChange(name, value)`.
  `engine.setVar()` / `setVolume()` back `[set]` / `vars.set` / `settings.setVolume`.

- **Theme contract.** Every colour, size and font the built-in chrome draws with
  is a `--nilvn-<token>` custom property on the stage root, with its default in
  the engine stylesheet (`THEME_TOKENS`). Override from `createEngine({ theme })`
  / `engine.setTheme()` (the base layer), from the config file's new `[theme]`
  and `[window]` sections, or mid-story with the new `[theme token=value …]`
  command (the script layer: saved with the stage, cleared by a restart or
  `[theme reset]`). `engine.theme` / `onThemeChange`; plugins get `ctx.theme`.
  Unknown tokens are diagnostics, painted anyway. `ui-scale` scales every chrome
  font size for small screens.
- `[window]` config: `skin`, `position = top|bottom`, `offset`, `opacity`,
  `background`, `border`, text and name-tag keys — shorthand over the tokens.
- `[actor … textColor=]` / `[actors.<id>] textColor`: the name tag's text colour.
  A later `[actor]` line keeps the fields it does not mention.
- `StageState.nameTextColor` and `StageState.theme` (optional; `SaveState` stays v2).

### Changed

- `actor.color` is documented as what it always was: the name tag's
  **background** colour. The name tag no longer reads `--name-color`; it is still
  set on the tag (deprecated read alias, removed in the next minor) — use the
  `name-bg` token or the actor's `color`.
- The dialogue box paints its background on a `::before` layer so
  `dialog-opacity` dims the chrome and not the text; `[window skin=…]` still
  overrides it inline for the scene.

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
