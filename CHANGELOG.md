# Changelog

Notable changes to `@nilvn/core`, `@nilvn/engine` and `@nilvn/plugin-sdk`. The
three packages share one version and one `engine-v*` tag. Entries before the
repository was split out of the NilVN monorepo (September 2026) are condensed
from its history.

## Unreleased

### Added

- `bindingFromEvent` is exported: the binding a key press spells (`Ctrl+Shift+S`, `Space`), as the settings page stores it — for a host that records `[keys]` the same way.
- `[fonts]`: font files the work ships, by family name (`"Zcool KuaiLe" = "fonts/zcool.woff2"`). Each registers with the document as a `FontFace` (`font-display: swap`) shared between engines on one page; the title page and `start()` wait up to 1.5 s for them; a failed file is a `load` diagnostic; `reconfigure()` adds and releases families. Core's `isAssetRef` recognizes `ttf` / `otf` / `woff` / `woff2`, so `configAssetRefs` carries the files into packages.
- Choice theme tokens for a command-window list: `choices-list-bg` / `-border` / `-radius` / `-padding` / `-shadow` frame all options together, `choice-align` sets their text alignment, `choice-lift` how far a hovered one rises, and `choice-cursor` / `choice-cursor-color` draw a cursor (`"\25B6"`) beside the hovered or focused option, and `choice-focus-ring` replaces the focus outline on options. Defaults keep today's look.
- `engine.overlayOpen`: true while the game's own chrome holds Esc (the menu or one of its pages, a plugin screen, an input or confirm box), so a host that binds Esc itself can leave it to the game.

- In-scene branches nest in the IR (schema v14): a choice option either jumps (`target`) or carries a `body` played in the scene, after which the flow merges back after the choice; the new `branch` node plays the first `cases[].body` whose `condition` holds, else its `else`. `serializeProject` / `serializeChunk` flatten both into labels and jumps derived from node ids (`bodyLabel`, `mergeLabel`), so the engine, saves and chunks are unchanged.
- `walkNodes`, `allNodes`, `findNode`, `findProjectNode`, `childLists`, `jumpTargetsOf` and `structureProblems`: one way to walk a scene's node tree, nested bodies included. Code that loops over `scene.nodes` by hand misses nested nodes.
- Command schemas: `[char]` / `[hide]` / `[clear]` take `trans=` / `dir=` / `duration=`; `[input]` takes `type` / `min` / `max` / `step` / `lines`; `[bgm]` takes `restart`.
- `EditorProjectMeta.scenes[id].synopsis` and `EditorProjectMeta.uiTheme` (authoring notes, never serialized).
- `engine.reconfigure(cfg)` re-applies a config's presentation sections (`theme`, `window`, `choices`, `input`, `title`, `ending`, `saves` except `autosave`, `menu`, `settings`, `ui`, `strings`) on a live engine. They first return to the construction values, so a dropped key falls back to its default; the script's `[theme …]` layer is kept. An open title or ending page repaints in place with its music still playing, an open menu page stays open, and panels keep their show / hide decisions and poses.
- `createEngine({ audio: false })`: a silent engine (no track, sound effect or voice plays; volumes, tracks and saves still work). `engine.audioEnabled` reads it.
- `engine.ui.preview(ids | null)`: draws exactly the listed panels whatever their `show` policy and the session. A widget whose `if` fails is drawn with the class `is-off`, and buttons, sliders, keys and the close button do nothing. Every widget element carries `data-widget` (its index).
- `engine.previewMenu(on)` shows the menu's ☰ entry on an idle engine and keeps session changes from closing its pages. `openMenu(page)` and the new `closeMenu()` return `false` without a menu (`hasMenu`), and `MENU_PAGES` lists the pages.
- `sys.bgmVolume` / `sys.ambienceVolume` / `sys.sfxVolume` / `sys.voiceVolume` / `sys.textSpeed` / `sys.autoDelay` read the player's settings, and `[set]` writes them the way the settings page does (clamped, persisted). `sys.playTime` (read-only, `engine.playTime`) counts the seconds of play in the run, and saves carry it in `SaveState.playTime`.
- `[menu open saves|load|settings|backlog|replays]` / `[menu close]` open and close the system pages from a script or a panel button (title page included). Core has a `menu` command schema. The `theme` schema gains `op` (`reset`), so a command node can express `[theme reset]`.
- `[ui.<id>]` widgets: `slider` (`var`, `min`, `max`, `step`, `label`, `disabled`), which writes its variable through `setVar` (so `sys.bgmVolume` works) and follows the variable when it changes. Buttons take `disabled` (an expression), `key` (clicks it while the panel is up; a key an engine binding holds is reported), and `skin` / `slice` / `sliceWidth` / `background` / `color`.
- `[ui.<id>]` panels take `skin` / `slice` / `sliceWidth` / `background` / `border` / `radius`, `dir = "row"`, and for windows `close`, `dim` (a backdrop; the window holds the story — clicks and the advance key wait), `open = "fade" | "slide" | "pop"` (skipped under reduced motion). A window's widgets can be placed with `x` / `y` / `w` / `h` (percent of its body); such a window defaults to 40cqw × 36cqh.
- Panels are the recordable stage objects `ui:<id>` (kind `ui`, in core's `BUILTIN_OBJECT_KINDS` too). Their pose composes over the anchor's centring, survives redraws and rides in a save (`StageState.panels`).
- Skins and looks: `[window] nameSkin` / `nameSlice` / `nameSliceWidth` / `nameRadius` for the name tag; `[menu] skin` / `slice` / `sliceWidth` / `background` / `color` for the ☰ button; `[menu] panelSkin` / `panelSlice` / `panelSliceWidth` for the system pages. New theme tokens: `name-radius`, `name-skin`, `name-skin-slice`, `menu-button-bg`, `menu-button-color`, `menu-button-border`, `menu-button-radius`, `menu-button-skin`, `menu-button-skin-slice`, `panel-skin`, `panel-skin-slice`. `menuTheme` is exported beside `windowTheme`.
- Theme tokens for one shared scale: `radius-s` / `radius-m` / `radius-l` / `radius-pill`, `space-xs` / `space-s` / `space-m` / `space-l`, `control-height`, `font-size-s` / `font-size-m` / `font-size-l`, `focus-ring`, `shadow-s` / `shadow-m` / `shadow-l`, `duration` / `easing`, `surface` / `surface-hover`, `slider-thumb`, `hotspot-hover`, `dialog-shadow`, `dialog-clearance` and `menu-button-size`. Lengths follow the stage with a px floor. Chrome strings `ui.settings.group.text` / `.sound` / `.display` head the settings page's sections.

### Changed

- `ChoiceOption` is `JumpOption | BodyOption`: `target` is absent on an option with a `body`. TypeScript code reading `option.target.…` must check it first (or use `jumpTargetsOf`).
- `SceneNode` includes `BranchNode` (`kind: 'branch'`): an exhaustive `switch` over node kinds needs a case for it.
- `CURRENT_SCHEMA_VERSION` is 14; a v13 project is a valid v14 one, `migrateProject` only stamps the version. `plugin-spec.json` reports `irSchemaVersion: 14`.
- The default chrome is redrawn as one "soft dark" look on that scale: flat fills, rounded cards and pill buttons, a violet accent (`#a35cf0`), and hover, keyboard focus, pressed and disabled states on every control (disabled is the `disabled` colour, not a faded control). Line icons replace the ☰ ✕ ▶ 🔒 glyphs. The menu opens as a grid of icon tiles; the system pages (save / load, settings, backlog, replays, plugin screens) are a card over the dimmed story, with an icon close button, inside a new `.nilvn-page` / `.nilvn-page__card` / `.nilvn-page__head` / `.nilvn-page__body` shell (the old classes stay on the same elements). Save slots and replay cards fill as many columns as fit, an empty slot is drawn as one, and the settings page groups its rows into sections with segmented switches and themed sliders. The title, ending and loading pages get a soft gradient backdrop. Text and tap targets keep a readable minimum on a small stage, and `prefers-reduced-motion` stops the indicator, the lifts, the panel effects and the credits roll. The ☰ is a round chip drawn like a HUD (`menu-button-*` default to the `hud-*` tokens). Works that set their own tokens keep them; a look that relied on an old default changes with it. `[window] skin` also sets `dialog-shadow = none`, and `[window] position = "top"` sets `dialog-clearance`.
- `nilvn playtest` names an icon-only button by its `aria-label` (a window's close is `Close`, not `×`).

### Fixed

- `nilvn playtest` explore: a story that goes back to the title page itself (`[title]` after a "not tonight" option) ends the run instead of failing it.
- `nilvn pack` warns when the engine script it ships is older than the engine's or the plugins' sources in a source checkout; an explicit `build:iife` marks the script current even when its bytes did not change.
- `setBackground`: a background still loading its image when a newer one is set (or a save is restored) no longer lands over it afterwards.
- `nilvn playtest` explore treats a system menu page that a `[menu open …]` button opened like a plugin screen and closes it with Escape. Under a dimmed `[ui]` window it presses only that window's buttons; it used to try the ones the backdrop covers.
- `NodeBase.condition` ("the node runs only when truthy") was serialized on jumps only and silently dropped elsewhere. A guarded plugin command now takes the engine's trailing `if=`; any other node — nested bodies included — is jumped over when its condition fails. A project that set `condition` on a line or a command plays differently: those nodes no longer always run.
- `buildChunkedExport` collected text keys and prefetch targets from a scene's top-level nodes only; nested ones are included.
- The stage root did not contain its own layers: `.nilvn-root` is now its own stacking context (`isolation: isolate`). Its screens layer used to paint over the host page by z-index — in the editor, the canvas engine's HUD showed over the game preview's title page and over the header of its settings page.
- A top-right `[ui]` HUD (or plugin HUD) sat at a fixed `8cqw` from the edge, which a ☰ on a small stage outgrew, and it moved aside even when the ☰ was elsewhere. A HUD now stands beside the ☰ only on the ☰'s own corner, by the button's size; bottom anchors and the toast keep clear of the dialogue box through `dialog-clearance` instead of a fixed `30cqh`.

## 0.19.0 — 2026-09-28

### Fixed

- A key still being pressed through the last line, or the second half of a double click, pressed the ending page's focused Back-to-title button the moment it appeared, skipping the page and its credits (the title page's New game likewise). The title and ending pages now ignore the player's own input for their first 0.6 s; a host's `click()` is unaffected.
- A replay kept running past its `[replayend]` while the menu restored the interrupted session — in a multi-file work that restore waits for its chunk, and meanwhile the story after the marker (often an `[ending]`) ran and left the session on the ending page. The replay's run now stops at the marker.
- The title and ending pages' primary button took the plain `button-hover` background when hovered or focused from the keyboard while keeping `button-on-color`, so a light `accent` paired with dark `button-on-color` (as the docs advise) nearly vanished; it keeps `button-on-bg` and brightens instead.
- Docs: a choices prompt covers the whole stage (no hotspot or clickable sprite takes a click while it is up); `animate` leaves the resting value alone and cannot be stopped, so keep `iterations` finite; an effect handle's `id` is the full object id; `[bgm]` with the playing file starts it over.
- Several script files (`[game] scripts`, and every script package): a jump whose target happened to be the line right after it counted as running off the file, so the next file in the list ran first; and running off the end of the last file continued into whatever file a jump had loaded after it — an endless loop. A jump is now always a jump, and the last file ends the story.
- A script package's preload (`[preload] assets`) and backlog voice replay resolve `@alias` paths through `[path]`.
- `[actors.<id>] face` in a config file is the actor's default face, as documented; it was kept under `face`, which the engine never read.
- An effect's object handle carried the renderer as a readable property, so a plugin effect could reach the stage DOM; the handle now exposes only its verbs.
- A config file's `[game] entry` in a subfolder moved the path base to that folder, so the config's aliases, assets and plugin paths resolved from the script's directory; they resolve from the config file's directory, as with `[game] scripts`. A plugin that fails to load names the URL it requested.
- `enablePlugin(path)` resolved `false` for a plugin it had just activated, and a path that failed once was never tried again; it now resolves `true`, retries a failed path, and a later `[use]` of the same path re-activates by id.
- A background or sprite sheet that fails to load is a diagnostic, as a character image already was.
- A stage write verb a plugin calls with arguments it cannot use reports a plugin diagnostic instead of throwing into the plugin; `showSprite` checks its id and `spec.url`.
- The system menu scrolls when its items do not fit, and plugin entries sit before the replay exit; a title page with more than five buttons lays them out in two columns.
- A `[ui]` panel shown with `[ui show]` no longer stays over the ending page, and a replay starts with the panels at their `show` policy.
- A HUD whose widgets are all hidden by `if` draws no empty frame; a `list` widget skips empty entries of a comma-separated string.
- Docs: the SDK README lists the signatures of every stage verb, the effect handle and each hook (`plugin-spec.json` gains `runtime.signatures`, and its references name the public type declarations instead of source files); `objectKinds` is described as a contract with no instances of its own yet; replays are described as they behave; two broken tables fixed.

### Removed

- `ActorDef.voice` and `PackageActor.voice` (deprecated since 0.15), with the fallback that still read a top-level `voice` for voicefx when no manifest declared the field. `[actors.<id>] voice = 360` keeps working: voicefx declares `voice` in `contributes.actorFields`, and the engine files it under `ext["app.nilvn.voicefx"]`.

### Changed

- **Replays start from their scene.** When normal play reaches a replay's start label the engine keeps the session as it is (stage, music, variables, panels, plugin slices), and the run that unlocks the segment stores it with the unlock (`SaveStore` key `replays`), with the background on screen as its picture. `playReplay` starts from that scene, so a segment that relies on what came before looks the same in the gallery; a segment unlocked before 0.19 still starts clean. Persistent variables a replay writes are rolled back when it ends — a replay is a memory, not progress.
- The replay list in the menu is a gallery of cards with each segment's picture (`replayThumbnail(segId)`); a locked card shows `ui.replays.lockedShort`.
- `[bgm]` / `playTrack` with the file a track is already playing keeps it playing and only moves its volume (over `fade`); `restart=true` starts it over. Loading a save does the same for the saved tracks, so music that is already right does not restart.
- `MENU_ITEMS_DEFAULT` has a `plugins` slot after `backlog`: plugins' menu entries sit there instead of below `restart`.
- A script package keeps the config's `[path]` table (it was dropped with a diagnostic): its aliases expand onto the package's asset refs, so a packed work's scripts keep writing `@bg/sea.svg`.
- `[hotspot … if=]` stays live: the engine re-evaluates the condition whenever a variable changes, and the region is off (not drawn, takes no click) while it is false — a one-shot region turns off after its own click, and a region appears the moment its condition holds. A false condition used to leave the region out once, when the tag ran. The condition is saved with the region (`HotspotSpec.if`).

- Every session entry fires `onSessionChange` — a new game, `restart()`, loading a save while playing, a replay — even when the previous state was already `playing`, so a plugin can reset what it draws itself. A load announces the entry before the plugins' slices come back: `onSessionChange` → `restoreState` → `onRestored`.
- `ui.layer(className, { over })` places its container: `'scene'` above the picture and below the dialogue box, `'overlay'` (default) above the dialogue and choices and below the fade cover and the full-stage screens. It used to be appended last, covering the fade, menu panels and the title page.
- `ctx.t` resolves the author's `[strings.<lang>]` before the plugin's own `messages`, so a work can rename a plugin's text.
- `screen.close(id)` closes only the calling plugin's screen; `[keys.<name>]` takes a plugin's full id (a first-party `app.nilvn.*` plugin also answers to its short name), the same naming as `[plugins.<name>]`.
- **Breaking for third-party plugins:** a plugin's variables live under its full id. `ctx.vars.set / get / has / all` take the bare key and read and write `<id>.<key>` (`com.example.weather.intensity`, `-` → `_`); `vars.namespace` is that prefix, and it is what saves hold. Scripts may use it, or the short prefix — a first-party short name or a third-party id's last segment (`weather.intensity`) — while no other active plugin shares it and it is not `sys`. Plugins that share a short prefix all lose it, each with a diagnostic, whatever order they were enabled in. A short-prefixed variable written before its plugin activated moves under the full prefix. Read an author variable with the new `vars.global(name)`; `vars.get` reports once when it misses its namespace but an author variable has the name.
- `contributes.menuItems[].when` is deprecated and ignored (a validator warning): the system menu's list only opens while playing. A title-page entry is a `titleItems` entry.
- The default `choice-disabled-color` is `var(--nilvn-disabled)` (nearly the same colour, now following `text`).
- The theme-token table in the API docs names every token, and a generated table lists each default exactly (a test keeps it in step with `THEME_TOKENS`).

### Added

- `nilvn playtest` — plays a work in the local Chrome / Chromium / Edge (headless, over the DevTools protocol; no download, Node 22+) with real mouse and key events. Without a script it explores: runs from New game to an ending taking each prompt's least-taken option and each parked line's least-clicked object. A `playtest.mjs` / `.json` scripts routes through a driver (`newGame`, `advance`, `choose`, `click`, `button`, `press`, `type`, `playToEnd`, `expect`, `expectEnding`, `page` …; `@nilvn/engine/playtest` types it). A click checks what is at the target's centre first, so a covered object fails the route; any engine diagnostic fails it too. The target is a work (packed first), a package folder, a single-file `.html` or a URL; screenshots of failures and `report.json` go to `playtest-report/`, and the exit code is 1 on a failure. See `docs/playtest.md`.
- `engine.waitingForPlayer`: true while a shown line waits for the player to go on (not while it types, a transition or a command runs, or a prompt is up).
- A diagnostic when a choices prompt opens over an object that became clickable after the last line (`hotspot "shell" can never be clicked: …`): the prompt covers the whole stage, so the player could never click it. `Renderer.clickableIds()` lists what is clickable.
- The SDK README's Signatures section is generated from the same source as `plugin-spec.json` `runtime.signatures` (`src/spec.ts`, one row per call), and tests hold it to what the engine grants: every `stage.read` / `stage.write` verb has a row, and a live plugin gets exactly those verbs and effect-handle members.
- Animation lifecycle: `AnimOpts.key` names an animation on its object (a second one with the same key replaces it, so re-applying an effect never stacks), `AnimOpts.commit` makes the last frame the resting pose that `getProp` reads and a save keeps, and `stopAnimations(objId, key?)` (`stage.write`; `stopAnimations(key?)` on an effect handle) stops what `animate` started — the only way to end an `iterations: Infinity` animation.
- `sys.replaying`, `sys.session` and `sys.lang`: read-only variables for what the engine is doing (a `[set]` on one is reported and ignored).
- `[menu] items` and `[title] buttons` place plugins' entries: `<plugin>:<item>` (the full id or its last segment) where it is listed, `plugins` for the rest. A `[menu]` entry no active plugin contributes is reported.
- `[title]` / `[ending.<id>]` `shadow` (the heading's `text-shadow`), and theme tokens for every colour the chrome still drew itself: `screen-bg`, `screen-color`, `screen-heading-shadow`, `name-shadow`, `choice-glow` (derived from `choice-hover`), `divider`, `backdrop`, `panel-shadow`, `danger`. A test keeps the base stylesheet free of colour literals.
- `nilvn pack` — a command in `@nilvn/engine` (`npx nilvn pack <folder>`) that turns a config-driven work into a script package: `nilvn.config.toml`, its `.nvn` files (one chunk each, `[include]` spliced), the folder's assets, `catalogs.json`, and the plugins in `[plugins] use` — a `plugin.json` and its files, or a bare module, which travels with a generated `plugin.json` — into a directory with its own `index.html`, a `.nvs` zip and one self-contained `.html`. It reports at pack time what would fail in play: a missing script, plugin file or asset, a line the parser rejects, an unknown config key or `@alias`, a `[use]` line naming a plugin by path. `--check` reports only (and names the engine script it would ship, with its build time); `--strict` fails on warnings. The default file name is the title in Latin letters, else `game`; the pages expose `ADV` and `window.engine`. The planning is `packWork()` in the new `@nilvn/engine/pack` entry (with `inlinePayload`, `mimeOf`, `slugify`); `script-package.md` documents how each part of a work lands in the package.
- Plugin key bindings: `contributes.keybindings` (`{ id, default, label?, when? }`), the `input.keys` permission and `ctx.input.on(id, fn)`. They join the engine's actions in one key table, resolved player → author → default; a default already taken stays unbound with a diagnostic. `[keys."<plugin id>"] <id> = …` sets the author's default (a first-party `app.nilvn.*` plugin also answers to its short name, as in `[plugins]`) (`KeysConfig` accepts those tables; `KeyAction` is now an explicit union).
- The settings screen's `keys` row (in `SETTINGS_ROWS_DEFAULT`, after the plugin settings): the player rebinds any engine action but `menu` and every plugin binding — Esc cancels, Backspace clears, a modifier pressed alone binds itself — and "Reset keys" returns to the config. An assigned key leaves the binding that held it. Stored in `SettingsPayload.keys`; `onSettingsChange('keys', id)`. `Engine.keyTable`, `assignKey`, `resetKeys`; `formatBinding` and `KEY_ACTIONS` are exported.
- A script package can carry a third-party plugin: its files sit under `plugins/<id>/`, every one of them in the chunk manifest's `assets` table (`kind: "plugin"`), and `nilvn.json` `plugins[].entry` names its `plugin.json`. The engine imports the module from the URL the package's loader already serves, so the directory, zip, single-file and `.nvpk` forms all work; the engine entry must be one self-contained ES module. `packagePluginAssets(id, files)` in `@nilvn/core` builds the entry and the table rows. The zip loader types `.js` / `.mjs` / `.css` / font blobs.
- `plugin.json` `assets` lists a plugin's own resource files; `ctx.asset(path)` returns a URL for a listed one (through the package for a carried plugin, relative to plugin.json / the module for a URL-loaded one), or `undefined` with a diagnostic.
- Versioned save slices: `EnginePlugin.stateVersion` (default 1) and `migrateState(data, from)`, mirrored by `contributes.saveSlice: { version }`. `SaveState.extVersion` records non-1 versions, so existing saves are unchanged. An older slice is migrated before `restoreState`; one the plugin cannot read is dropped with a diagnostic and the load continues. Slices of inactive plugins keep their version when carried through.
- `isPluginRelPath` / `normalizePluginPath` in `@nilvn/core`; `validatePluginManifest` checks `assets` paths and the slice version.
- `ctx.screen.isOpen(id?)`, for a key that toggles a plugin screen.
- `ctx.session`: where the session is (`idle` / `title` / `playing` / `ending`), read synchronously — a `when: 'always'` binding checks it to act on the title page only.
- A `list` config field type (`contributes.config`, config only): a TOML array, with `items: 'string' | 'number'`; `ctx.config.get` returns an array (a comma-separated string from elsewhere is split). Author scope only: `scope: 'player'` on a list is a manifest error, and lists never show in the settings screen. `CONFIG_TYPES` / `ConfigFieldType` in `@nilvn/core`; `plugin-spec.json` `schemas.configTypes`.
- Theme tokens `muted` (secondary text) and `disabled` (a disabled control's text), both derived from `text` with `color-mix()`.
- `perActivation(init)` in `@nilvn/plugin-sdk`: per-activation state for a declarative module, keyed by the plugin context and dropped when the plugin is released.
- Public docs mark features newer than the last release with `since: unreleased`; `version:set` stamps them with the release version.
- `ctx.screen.open(…)` returns a promise that resolves when that screen closes, whichever way (Esc, the close button, `close`, another screen, the session leaving `playing`, the plugin being released) — a command awaits it instead of polling `isOpen`. A plugin's open screen now closes when the plugin is released.
- `ctx.input.label(id)`: the key a binding has now, as the settings screen shows it (`''` when unbound), for hints that stay right after the player rebinds.
- `[game] lang`: a work's starting language from the config (when the host passes no `lang`; also the fallback and the only language unless the host set them). A script package carries its language in `nilvn.json`, so the key is ignored there.
- `[input] promptColor` / `buttonBackground` / `buttonColor` and the tokens `input-prompt-color` / `input-button-bg` / `input-button-color`: the prompt text and the Cancel button on a light box skin.
- `[title] color` / `[ending.<id>] color`: the page's text colour, for a light background or CG.
- `trans=` on `[char]`, `[hide]` and `[clear]`, as on `[bg]`: the change happens at once under a scene transition (`dir=` `duration=` `color=` `mask=` `softness=`).
- `[input … type=number min= max= step=]` asks for a number (OK stays disabled outside the range) and writes a number; `[input … lines=4]` opens a multi-line area (Enter adds a line, Ctrl / ⌘ + Enter confirms). `dialog.prompt` takes the same options.
- `[choices] chosenStyle = "mark"`: an option taken in an earlier run keeps its usual look and gets a badge — an element of its own (`.nilvn-choice__mark`, so a choice effect's pseudo-elements do not hide it) drawn from the new token `choice-chosen-mark` (a CSS `content` value, `✓` by default), or `chosenMark = "…"` as plain text.
- Object conditions: `SpriteSpec.if` (saved with the sprite) and `CommandContext.condExpr` — the `if=` expression an `ifFalse: 'handle'` command receives — so a clickable sprite's condition stays live like a hotspot's. `Renderer.evalCondition` / `refreshConditions()` carry both.
- Services between plugins: `contributes.services` (`{ id, version }`), `ctx.services.provide(id, api)` and `ctx.services.get(pluginId, serviceId, range?)`. Calls are async with structured-cloned arguments and results; the consumer lists the provider in `dependencies`; the stub follows the provider across reloads and rejects once it is gone. `EnginePlugin.services` for a module without a manifest; `ServicesCap` / `ServiceApi` / `ServiceDef` types.
- Plugin theme tokens: `contributes.themeTokens` (`{ name, default, label? }`, names starting with the plugin's short name and a dash — `themeTokenPrefix(id)`). While the plugin is active the defaults sit on the stage root; a work's `[theme]` sets them without an unknown-token diagnostic (one set before its plugin loads is judged once the `[use]` plugins are in). `EnginePlugin.themeTokens`; `ThemeTokenDef`. `validatePluginManifest` checks both new points.
- `validatePluginManifest` checks the shapes inside `contributes`: param and config field types (`PARAM_TYPES`), command categories (`COMMAND_CATEGORIES`), `positional` as an index, enum `options` as `{ value, label }`; it warns when a contribution lacks the permission that wires it (`keybindings` / `input.keys`, `saveSlice` / `save.slice`, `menuItems` `titleItems` `hud` / `ui.screen`) or a label is missing from `messages.en`.
- A module's `permissions` field is documented as being only for modules loaded without a `plugin.json`; the template and examples declare permissions in the manifest only.
- `plugin-spec.json` gains `schemas` — every shape inside `contributes`, field by field, with the closed sets of param types and command categories — plus `ui.dialog.prompt`, the `onPreload` hook and the sandbox-readiness rules. The SDK README documents the runtime half in depth, and `examples/` holds two complete third-party plugins (weather, achievements) with a script that packs them into a zip and a single-file work.

## 0.18.0 — 2026-09-24

### Added

- A colour grade on the camera: six numeric channels — `hue` (degrees), `invert` and `grayscale` (0–1), `saturate` / `brightness` / `contrast` (multipliers) — composed into one CSS `filter` over everything under the camera. They work through `setProp` / `animate` (tweening; under `compose: 'offset'` hue / invert / grayscale add and the multipliers multiply), record on the camera's event-frame tracks and persist in saves (`StageState.camera`). Other objects ignore them.
- A trailing `if=condition` on every plugin command and macro, with the `[choice]` / `[hotspot]` grammar (runs to the end of the tag). The engine splits it off before dispatch — the command never sees it in `raw` / `args` / `params` — and a false condition skips the tag and its `onCommand` hook; a condition that fails to evaluate is a diagnostic and counts as false. A command whose `CommandSchema` declares `ifFalse: 'handle'` runs anyway with the new `CommandContext.cond === false` and decides what "not present" means.
- A clickable sprite (`onclick`) is probed for reachability like a `[hotspot]`, when it appears or moves: `sprite "id": "…" covers its centre`.
- `plugin-spec.json` documents `CommandContext.cond` and `CommandSchema.ifFalse`.

### Changed

- `DomRenderer.onObstructed` receives the object id (`hotspot:<id>` / `sprite:<id>`) instead of the bare hotspot id. The engine's diagnostic text for hotspots is unchanged.

## 0.17.1 — 2026-09-22

### Added

- `ObjectBand` (the band `setBand()` takes: `world` / `back` / `front`) is exported from `@nilvn/engine`; it was already part of the public renderer signatures.

- core: `PackageActor` carries what `ActorDef` does — `textColor`, `canvas` + `layers` (a layered sprite; `PackageActorLayer`) and `ext` (plugin actor fields). The engine already read these from the actor table; they were only missing from the package's type and its documentation. `voice` stays as a deprecated alias.

### Fixed

- A quoted choice guard — `[choice Go -> x if="day > 1"]`, what a serializer writes for a condition with spaces — was evaluated with its quotes and so was always true (a string literal). The quotes are stripped, as `[hotspot … if=]` already did.

## 0.17.0 — 2026-09-22

The work's configuration travels with the script package.

### Added

- `nilvn.json` takes an optional `config`: [nilvn.config.toml](packages/engine/docs/config.md) as JSON (`Project.config` in core). `load()` applies it once the package is open and its asset table is filled, so a skin, logo or background in it resolves by ref, and checks it like a config file. What the manifest carries itself — `game.entry` / `game.scripts`, `path`, `actors`, `plugins.use` — is dropped with a `load` diagnostic each; `game.title` is always the manifest's `title`. Older engines ignore the field; `PACKAGE_FORMAT` is unchanged.
- core: `Project.config` (`WorkConfig`, schema v12 — a pure addition); `buildChunkedExport` takes `scenes` (a scoped build: one chunk, jumps out of the scope route to the unset landing) and `anchorNodeId` / `anchorLabel`; `configAssetRefs()` lists the asset refs a configuration names.
- A `back` band (`ObjectBand`): between the background and the characters, still under the camera — for ambient particles and light shafts that must not cover a sprite. `setBand()` and the saved `band` carry it; the first-party `[layer]` command gains `layer=back` with the plugins' next release.

### Fixed

- A window opened from the title page (a `ui:<id>` button in `[title] buttons`) could not be closed from its own button: `runInline` returned at once with no story running. Panel and variable commands (`ui`, `set`) now run there; anything else is reported rather than dropped.

## 0.16.3 — 2026-09-21

Fixes and documentation from finishing the two sample works into complete short
visual novels, and from the acceptance round that played them with real clicks.

### Fixed

- `[trans slide]` no longer degrades to a cut: a camera at rest carries the literal `none` in its inline transform, and pasting that after the displacement made an invalid keyframe the browser dropped.
- A `[hotspot]` declared where a click cannot reach it — the dialogue box, a panel or the HUD is drawn over its centre — is now an `exec` diagnostic naming what covers it. The coordinates read fine in the script, and a test that drives the page with `element.click()` bypasses hit testing entirely, so this had no other way of surfacing. The probe runs where the region is declared or moved (not on a restore, which rebuilds the stage in pieces) and says nothing where there is no layout to measure.
- A resource path whose `@prefix` no `[path]` entry and no `[alias]` declares is now a `load` diagnostic. It used to travel on as a literal URL segment and surface far away — a 404 image, or an audio element reporting `MediaError` into the console — so a run with an empty `diagnostics` could still have a whole channel of sound silently broken.

### Documentation

- `[replaydef]` is registered when its chunk is parsed, so in a multi-file work every declaration belongs in the entry script (`api.md`, and the plugins README): a save loaded into a later chunk would otherwise open an incomplete replay gallery.
- `[input] default` is the field's **placeholder** and the fallback, never pre-filled text; the buttons read Cancel then OK (`script-syntax.md`, `config.md`).
- A `[choice]` may carry `if=` and `disabled=` together, each running to the end of its own value (`script-syntax.md`).
- An ending page has no text-colour key: colour it with a script-layer `[theme]` on the line before `[ending]`, which the session reset then clears (`config.md`, `api.md`).
- `list` widget items may hold `@key`s, whose translated text is free to contain commas (`config.md`).
- A hidden tab freezes rAF and Web Animations, so transitions, `[wait]` and `[preload wait=true]` settle only when the page is shown again (`api.md`).

## 0.16.2 — 2026-09-21

The first published build of the 0.16 line: the 0.16.0 and 0.16.1 tags
failed in this repository's publish step (a test read a sample that only the
private monorepo has) and never reached npm. Content: 0.16.0 + 0.16.1, plus
that test now skipping where the sample is absent.

## 0.16.1 — 2026-09-21

Fixes from a docs-only author round (a sample written against the public
documentation alone).

### Fixed

- `[game] scripts` no longer moves `baseUrl` to the script files' folder: assets, aliases and plugin packages resolve from the config file's directory, so scripts may live in a subfolder.
- `has(str, x)` on a string means "contains" (a comma-joined string works), as documented.
- `[hotspot] if=` runs to the end of the tag, spaces and all, like a `[choice]`'s.
- A language switch while the player is parked at a `{p}` page repaints that page (the tap ends the line when the new text has no page after it).
- `[window] overflow = "page"` clips the text box, not the dialogue box: the name plate is no longer cut.
- `list` widget items go through the catalogs (`@key`, `{$var}`); panels drawn before the script's first `[set]` show an undefined variable as empty without a diagnostic.
- A sprite, layer or logo image that fails to load is reported as a diagnostic.
- The typewriter wraps Latin words as words (CJK still per character).
- A click (hotspot, panel button, sprite) that runs `[jump]` / `[call]` while a line is still typing takes effect at once instead of after the next tap.

### Added

- `[choices timer= default=]`: a per-prompt override of the `[choices]` countdown and default (`timer=0` turns it off for that prompt).
- `[title] logoWidth`.

### Docs

- `[strings.<lang>]` lists every chrome string id; `hasContinue()` is async; the bare value in `[char id value]` is always the face layer; the map-screen example loops back; `skin=none` semantics and how to show a plain box for a scene.

## 0.16.0 — 2026-09-21

Batch I "core completion": text and variables, dialogue paging and the
choices prompt, script files as chunks with `[include]` / `[call]` /
`[preload]`, scene transitions and layered sprites, declarative UI, and a
config schema. `@nilvn/plugins` 0.3.0 pairs with it.

### Added

- **Config schema.** `CONFIG_SCHEMA` (plain data, a JSON-Schema subset) and
  `checkConfig(cfg)` describe `nilvn.config.toml`; `applyConfig` runs the
  check, so a misspelled section or key, a wrong type or a value off its list
  is a `load` diagnostic (`config: <path>: …`) instead of a silent no-op.
  `[game] defaultLang` is honoured.
- **Interpolation.** Dialogue, choice labels, actor names and config strings
  fill `{$var}` (a session or persistent variable) and `{@key}` (a catalog entry,
  re-resolved on a language switch) when shown. Placeholders nest inside an
  effect (`{wave:{$player}}`); an effect whose whole content is `@key` resolves
  it (`{pop:@route.name}`). An undefined variable shows as empty with one
  diagnostic. `engine.fill(text)`, `interpolateText` / `interpolateSegments`.
- **Persistent variables.** `[persist name = default …]` (or a `[persist]`
  config section) declares variables that outlive the session: kept in the save
  store's `globals` key (`GLOBALS_KEY`, `GlobalsPayload`), never in a
  `SaveState`; `[set]` writes them, expressions and `{$var}` read them,
  `onVarChange` fires. The engine maintains `sys.endings` (every ending reached)
  and `sys.chosen` (every choice taken, by target label). API: `globals`,
  `setGlobal`, `declarePersist`, `isPersistent`, `getVar`, `scope`.
- **Expression functions** `has(list, x)`, `rand(n)` / `rand(a, b)` / `rand()`,
  `min`, `max`, `floor`, `len` (`EXPR_FUNCTIONS`), and dotted variable names.
- **`[input var prompt= default= maxlength= pattern= persist=true]`**: an
  in-engine text box (never the browser's). Cancel or an empty OK yields
  `default` — or the variable's current value when it has one; `pattern` gates
  OK. The `[input]` config section (`skin` / `slice` / `sliceWidth`,
  `position`, `ok` / `cancel`, `background` / `border` / `radius`, `field*`) and
  ten `input-*` theme tokens style it; `inputTheme` exported; plugins get
  `ui.dialog.prompt()`; `ChromeRenderer.prompt()` is the renderer seam.

- **Paging.** `{p}` breaks a line into pages: the page waits for a tap (auto
  and skip turn it), then the box clears and the rest types; the backlog keeps
  the whole line and a voice clip plays on. `[window] overflow = "page"` also
  breaks where the text would run past the box (the box is fixed at `height`);
  `"shrink"` scales the text down until it fits; `"grow"` (default) is the old
  stretching box. `Segment` gains `{ kind: 'page' }`; `TypeLineOptions.onPage`.
- **`[choices]` config section** for the prompt: `position` (center / top /
  bottom / left / right), `layout` column or grid with `columns`, `width`,
  `gap`, `skin` (+ nine-slice `slice`), `chosenStyle = "dim"` (options taken in
  an earlier run, from `sys.chosen`), `timer` + `timerDefault` (a bar shows the
  time left, then the prompt picks by itself), and the look keys mapped onto
  new `choice-*` tokens (`choices-gap`, `choice-width`, `choice-skin`,
  `choice-skin-slice`, `choice-chosen-*`, `choice-disabled-*`,
  `choice-timer-*`). `choicesTheme` exported.
- **`[choice … disabled=cond]`** shows an option greyed and unpickable
  (`if=` hides). Renderer seam: `showChoices(views, onSpan, opts)` takes
  `ChoiceView`s (`segments`, `disabled`, `chosen`) and `ChoicesPromptOptions`;
  `setOverflow`, `setChoicesLayout`.

- **Several script files.** `[game] scripts = ["a.nvn", "b.nvn"]` (or
  `engine.loadScripts()`) plays files in order as chunks: labels are global, a
  file's stem names its first line, files fall through in list order, a save
  addresses the file. A label defined twice is reported. `[include path]`
  pastes a file in when the script file loads (relative to the including file,
  eight levels deep, cycles reported). `[call label]` / `[return]` with the
  return stack in `SaveState.calls`. `buildFileManifest`, `FileScriptLoader`,
  `expandIncludes`, `scanLabels`, `scriptId` exported.
- **Preloading.** The `[preload]` config section (`assets`, `auto`,
  `concurrency`, `screen`, `heading`, `background`) warms the opening assets in
  `prepare()` on a built-in loading page (`screens.loading`, `progress-*`
  tokens, `ui.loading.title`); `[preload ref …]` warms mid-story
  (`wait=true` blocks on the page); `engine.preload()`; the `onPreload` hook;
  `ChromeRenderer.setProgress`. `scanAssetRefs` / `isImageUrl` exported.
- Chunked play continues into a chunk's fall-through successor at its end even
  when another chunk was appended after it by a jump (list / scene order wins
  over physical order).

- **Scene transitions.** `[trans kind …]` freezes the picture (a snapshot of
  the camera), the scene changes underneath, and the next line — or
  `[trans end]` — reveals it with `fade`, `crossfade`, `wipe`, `slide`,
  `circle`, `blinds` or `rule` (`mask=` a luminance image, `softness=`);
  `[bg image trans=kind]` swaps a background the same way. Renderer seam:
  `beginTransition` / `endTransition` / `transitionPending`;
  `transitionScreen` takes `mask` too. `armTransition` / `commitTransition`.
- **Layered sprites.** `[actors.<id>] canvas = [w, h]` with
  `[actors.<id>.layers]` (`src` template `{layer}`, `default`, `offset`,
  `optional`) draws a character from several images on one canvas;
  `[char id face body=casual extra=blush]` sets layers by name,
  `speaker(face):` drives the `face` layer, `extra=none` clears an optional
  one. Saves keep the layer values (`StageState.chars[].layers`); a `face`
  keyframe repaints the face layer; `[preload] auto` warms every layer image.
  `CharOptions.layers` / `canvas` / `layerUrl`, `Renderer.charLayers`.

- **Declarative UI.** `[ui.<id>]` config sections draw a HUD (pinned to one of
  nine anchors) or a window from data-bound widgets — `text`, `bar`, `image`,
  `list`, `button` — with `if` conditions, `show = playing | always | manual`,
  `[ui show|hide|toggle id]` (the decisions ride in `SaveState.ui`), `ui:<id>`
  entries for `[menu] items` / `[title] buttons`, and `hud-*` / `window-*` /
  `bar-*` tokens. Panels re-render on every variable, language and session
  change. `engine.ui`, `UiPanels` exported.
- **Events are script commands.** A `button`'s `onclick`, `[hotspot id x= y=
  w= h= onclick= if=]` (`remove` / `clear`; saved with the stage) and
  `[sprite … onclick=]` run their commands in the current session through
  `engine.runInline()`; when they move the playhead the parked line is
  released. Renderer seam: `showHotspot` / `hideHotspot` / `clearHotspots`,
  `objectClick`, `SpriteSpec.onclick`, `StageState.hotspots`.

### Fixed

- A choice's `if=` condition was cut at the first space (the tag tokenizer);
  it is now read from the raw tag, so `if=has(sys.endings, "true") && x > 1`
  works.
- The settings blob is written only when a setting changed; reading a line or
  writing a variable no longer rewrites it (which pinned the current language
  as the player's choice).

- A `loadConfig()` after `createEngine()` — the documented order — left the
  system menu as it was built at construction: `[menu] items` / `entry` and
  `[strings]` labels did not apply (the config and `engine.t()` were right; the
  screen was not). `applyConfig` now rebuilds the menu (`engine.refreshMenu()`);
  plugin menu entries survive, and a changed `[menu] enabled` creates or removes it.

### Added

- **`[keys]`** / `createEngine({ keys })`: keyboard bindings for the shell —
  `advance`, `menu`, `skipHold`, `skip`, `auto`, `quicksave`, `quickload`,
  `backlog`, `save`, `load`, `settings`, `fullscreen`. Defaults: Space / Enter,
  Esc, Ctrl (held), Tab, `a`, F5, F9; the rest unbound. `Ctrl+` / `Shift+` /
  `Alt+` / `Meta+` prefixes, arrays, `false` to unbind; bound keys are consumed
  (F5 no longer reloads), text fields keep their keys. The menu's actions bind
  only while the menu exists. `KEYS_DEFAULT`, `matchKey`, `parseBinding` exported.
- The text-speed setting is a linear slider in characters per second
  (`[settings] textSpeedRange`, default `[10, 100]`); its top notch is
  **instant** (`textSpeed = 0`). The three-step slow / normal / fast row and its
  `ui.settings.speed.slow|normal|fast` strings are gone (`ui.settings.speed.cps`
  / `.instant` replace them).
- The backlog draws each speaker's name as the name tag does: the actor's
  `color` (background) and `textColor`, the theme's `name-*` tokens otherwise
  (`BacklogEntry.actor`).
- Theme tokens `button-on-bg` / `button-on-color` for the selected state of menu
  items, settings options and slot pages (was hard-wired to `accent`), so a
  light accent can keep a readable selection; the docs now list what `accent`
  reaches. `dialog-skin-slice` + `[window] slice` / `sliceWidth`: a nine-slice
  dialogue skin (`border-image`) instead of a whole-image stretch.
- Quick save / load from the keyboard confirm with a stage toast.
- The title and ending pages' primary button draws with `button-on-bg` /
  `button-on-color` too (it used `accent` with the plain button text colour, so
  a light accent lost its label). The text-speed slider's step is the coarsest
  of 1 / 2 / 5 / 10 that divides the configured range, so a configured speed
  always sits on a notch.

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
