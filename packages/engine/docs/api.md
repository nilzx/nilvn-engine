# Engine API

```ts
import { createEngine } from '@nilvn/engine'

const engine = createEngine({ container: document.getElementById('app')! })
await engine.loadConfig('./nilvn.config.toml')
await engine.prepare()        // content + plugins in place: show your title page here
startButton.onclick = () => {
  void engine.start()         // resolves when the STORY ends, so don't await it to hide the title
}
```

`start()` resolves when the script finishes — `[end]`, `[ending]`, running off
the end — not when play begins. Use `prepare()` / `ready` for "loaded, show the
title"; see [Session](#session).

`createEngine(options)` returns an `Engine`. Everything below is on that
instance unless noted. All content problems are reported as diagnostics; the
only exceptions the engine throws are host programming errors (for example
`start()` with nothing loaded).

## EngineOptions

| Option | Type | Meaning |
|---|---|---|
| `container` | `HTMLElement` | Where the stage renders. Required. |
| `baseUrl` | string | Base for asset and plugin paths. Defaults to the loaded script's directory (or the page URL). |
| `textSpeed` | number | Typewriter speed, characters per second (default 40). |
| `plugins` | `EnginePlugin[]` | Host plugins activated immediately; every permission they declare is granted (subject to `grant`) and `setPlugins` never removes them. |
| `registry` | `EnginePlugin[]` | Plugins made available to `[use id]` / `enablePlugin` without activating them. |
| `manifests` | `PluginManifest[]` | Manifests for registry and `[use]` plugins; a manifest's `permissions` / `dependencies` / `activation` win over the module's inline fields. |
| `use` | string[] | Plugins to activate at `start()` — the same entries as `[use …]`. |
| `grant` | `(id, requested) => Permission[]` | Host authorization: which of a plugin's requested permissions to grant. Default: every one the engine can honor. |
| `pluginLoader` | `PluginLoader` | How `[use …/plugin.json]` and `[use ./x.js]` fetch and import (default `fetch` + dynamic `import()`). |
| `alias` | `Record<string, string>` | Path prefix aliases, e.g. `{ '@bg': 'assets/bg' }`. |
| `actors` | `Record<string, ActorDef>` | Actor declarations; `[actor]` lines extend them. |
| `lang`, `defaultLang`, `languages` | string, string, string[] | Content language, fallback language (default `'en'`), and the set the in-game switcher offers. |
| `catalogs` | `Record<lang, Record<key, text>>` | Content text by key; values carry inline markup. Dialogue, choice and actor-name `@key` references resolve here. |
| `macros` | `Record<string, string>` | Command macros (see [config.md](config.md#macros)). |
| `defaults` | `Record<cmd, Record<param, value>>` | Per-command default parameters. |
| `theme` | `Record<token, value>` | Theme overrides — the base layer (see [Theming](#theming)). |
| `title`, `endings`, `saves`, `menu`, `settings` | `TitleConfig`, `Record<id, EndingConfig>`, `SavesConfig`, `MenuConfig`, `SettingsConfig` | The built-in pages, the slots and autosave, the system menu and the settings panel — the config file's `[title]` / `[ending.<id>]` / `[saves]` / `[menu]` / `[settings]` (see [config.md](config.md#title)). |
| `keys` | `KeysConfig` | Keyboard bindings (`[keys]`, see [config.md](config.md#keys)); `KEYS_DEFAULT` is the base. |
| `messages` | `Record<lang, Record<id, string>>` | Chrome string overrides (`[strings.<lang>]`). |
| `pluginConfig` | `Record<pluginId, Record<key, value>>` | Plugin settings (`[plugins.<id>]`); short first-party names work. |
| `screens` | `false` \| `{ title?, ending?, menu? }` | `false` = the engine draws no chrome at all (a host that owns its own); per piece otherwise. |
| `saveStore` | `SaveStore` | Where saves persist (default `localStorage` namespaced by `saveKey`). |
| `assets` | `Record<string, string>` | Virtual asset table: resolved path → inline URL (data URIs). Single-file builds use it so nothing is fetched. |
| `onEnd` | `() => void` | The script finished (`[end]`, `[ending]`, or it ran off the end). |
| `onReady` | `() => void` | Content and plugins are in place (see [Session](#session)). |
| `onSessionChange` | `(state, prev) => void` | The session moved between `idle` / `title` / `playing` / `ending`. |
| `onError` | `(info: EngineDiagnostic) => void` | Host diagnostic sink (same information as the `onError` plugin hook). |
| `strict` | boolean | Log every diagnostic with `console.error` each time (the studio preview). Lenient mode dedupes and warns. Never changes playback. |
| `pluginFailureLimit` | number | Consecutive command failures after which a plugin is quarantined (default 3). |
| `saveKey` | string | Per-work id the menu namespaces saves by (a loaded package supplies its own). |
| `buildInfo` | string | Tool version label the menu shows (a package supplies its own). |
| `manifest`, `loader` | `ChunkManifest`, `ContentLoader` | Chunked play from a custom loader; `load()` sets these for you. |
| `maxResidentChunks` | number | Memory ceiling for chunked play (see [script-package.md](script-package.md)). |

## Loading content

| Member | Description |
|---|---|
| `loadConfig(url)` | Fetch and apply a [config file](config.md). Sets `baseUrl` to its directory. |
| `load(source)` | The one content entry. A `.nvn` URL loads that script; anything else is a [script package](script-package.md): a directory URL (or its `nilvn.json`), zip bytes / a `Blob`, or an opened `ScriptPackage`. Rejects only for an unreachable URL or a `PackageFormatError`. |
| `loadScript(url)` | Fetch and parse a `.nvn` script; assets resolve relative to its directory. |
| `loadSource(text)` | Parse script text you already have. |
| `loadPackage(pkg)` | Adopt an opened package (`openPackage()` output). Replaces anything loaded before. |
| `entry` | Script `start()` auto-loads when nothing was loaded explicitly (from the config's `[game] entry`). |
| `queueUse(names)` / `usePlugins(names)` | Queue plugins for `start()`, or activate them now — the `[use]` entries. |

Config, script and package are alternatives, not layers: a package carries its own
actors, languages and plugin set.

## Playing

| Member | Description |
|---|---|
| `prepare(label?)` | Content and plugins in place without playing (the auto-loaded entry script, the entry chunk, the queued `[use]` plugins). Resolves `ready` and fires `onReady` the first time. Returns `false` when a reported content problem leaves nothing playable. |
| `ready` | A promise that resolves after the first successful `prepare()` / `start()`. Never rejects. |
| `start(label?)` | Run from the top or from `label` (calls `prepare()` first). Resolves when the script **finishes**, not when play begins. |
| `jump(label)` | Move the playhead to a label (loads its chunk first in chunked play). |
| `restart()` | Fresh variables, blank stage, silence, then play from the beginning. |
| `showTitle()` | Stop any run, clear the session (variables, stage, audio, backlog), enter the `title` state and draw the title page — what `[title]` does. `start()` from there is a fresh game. |
| `continueGame()` / `hasContinue()` | Resume from the autosave (the title page's Continue) / whether one exists — both async (`await engine.hasContinue()`; the store is asynchronous). |
| `auto` / `setAuto(on)`, `skip` / `setSkip(on)` | Auto mode (lines advance by themselves; a tap ends it) and skip mode (read lines — or everything per `skipMode` — pass at once; ends at the first unread line and at every choice). Holding Ctrl skips while held. |
| `autoDelay` / `setAutoDelay(sec)`, `skipMode` / `setSkipMode(mode)` | Auto's pause and skip's reach — player settings, persisted. |
| `getVolume(ch)` / `setVolume(ch, v)`, `dialogOpacity` / `setDialogOpacity(v)`, `uiScale` / `setUiScale(v)`, `isFullscreen()` / `setFullscreen(on)` | The other player settings the panel drives (the two sliders write the `dialog-opacity` / `ui-scale` theme tokens). |
| `saveSlot(n)` / `loadSlot(n)`, `quickSave()` / `quickLoad()`, `writeSave(key)` / `readSave(key)` / `loadSave(key)` / `deleteSave(key)` | The slot API the menu's screen sits on (`slot:<n>`, `quick`, `auto`). |
| `openMenu(panel)` | Open one of the menu's panels — `saves` / `load` / `backlog` / `replays` / `settings`. |
| `refreshMenu()` | Rebuild the system menu from the current `menuConfig` / `settingsConfig` / `messages` / `keysConfig` (what `applyConfig` does after a `loadConfig`); creates or removes it when `[menu] enabled` changed. Plugin menu entries survive. |
| `t(id, params?)` | A chrome string in the work's language (overrides, then the engine catalog). |
| `setPluginConfig(id, patch, { player? })` / `pluginConfigValue(id, key)` / `pluginConfigAll(id)` / `onPluginConfigChange(id, fn)` | A plugin's settings: the author's layer, or the player's with `player: true` (persisted); what `ctx.config` reads. |
| `actorField(actorId, pluginId, key)` | A plugin-declared actor field (`contributes.actorFields`), e.g. voicefx's `voice`. |
| `finish(endingId?)` | End the run now into an ending (`default` when unnamed): the session enters `ending`, `onEnd` fires. |
| `session` / `ending` / `onSessionChange(fn)` | Where the session is, which ending was reached, and the subscription (see [Session](#session)). |
| `destroy()` | Stop everything, release listeners, timers, audio, plugins and the stage DOM. The instance is dead afterwards. |
| `wait(sec)` / `sleep(ms)` | Delays that resolve early if the session is reset. |
| `vars` | Session variables (`[set]` writes them; `[if]`, choice conditions and `{$var}` read them). Part of a save. |
| `globals` / `setGlobal(name, value)` / `declarePersist(name, default)` / `isPersistent(name)` | Persistent variables: declared by `[persist]` / the `[persist]` section / `[input persist=true]` (or `declarePersist`), plus the reserved `sys.*` names. Kept in the save store's `globals` key, never in a `SaveState`; `setVar` routes a persistent name here. |
| `getVar(name)` / `scope()` | One variable (persistent first), and the merged table expressions evaluate against. |
| `fill(text)` | `{$var}` / `{@key}` placeholders filled with current values — what dialogue, choices, actor names and config strings go through. |
| `promptInput(name, { prompt, default, maxlength, pattern, persist, type, min, max, step, lines })` | The `[input]` command: an in-engine text box; resolves to the value written (a number for `type: 'number'`). |
| `choicesConfig` / `inputConfig` | The `[choices]` / `[input]` sections as applied (chosen style, timer; position, labels). |
| `loadScripts(urls)` / `scripts` | Play several `.nvn` files as chunks (`[game] scripts`): global labels, list-order fall-through, saves addressing the file. `[include]` lines are spliced in (also by `loadScript`). |
| `call(label)` / `returnFromCall()` | `[call]` / `[return]`: the return stack rides in `SaveState.calls`. |
| `ui` | The declarative panels (`[ui.<id>]`): `show(id)` / `hide(id)` / `toggle(id)` / `isShown(id)` / `has(id)` / `refresh()`. |
| `runInline(commands, source?)` / `chromeString(s)` | Run script commands from a click (a panel button, a hotspot, a sprite) in the current session; a config string with `@key` / `{$var}` resolved. |
| `armTransition(kind, opts)` / `commitTransition()` | `[trans …]`: freeze the picture, reveal it later with the effect (the next line commits by itself). |
| `preload(refs, { screen })` / `preloadConfig` | Warm assets (images decoded, the rest fetched) on the loading page; `prepare()` does it once per loaded content from the `[preload]` section. `onPreload` fires per asset. |
| `actors` | The actor table. |
| `textSpeed` | Typewriter speed; changing it applies mid-line. |
| `resolve(path)` | Resolve a resource path: aliases, then the asset table, then `baseUrl`. |
| `config` | The parsed config file, if one was loaded. |
| `theme` / `setTheme(patch)` / `onThemeChange(fn)` | The effective theme overrides, the base-layer writer and its change signal (see [Theming](#theming)). |

**A hidden page has no clock.** Browsers freeze `requestAnimationFrame` and Web
Animations while a tab is in the background, so a transition, a `[wait]` or a
`[preload wait=true]` does not settle until the tab is shown again — the playhead
stops where it was and resumes on its own. Nothing is lost, but an automated run
has to keep the page visible (or finish the finite animations itself).

The player advances a line with click, Space or Enter; a click during typing
reveals the rest of the line.

## Session

```
                    ┌──────────── showTitle() / [title] ─────────────┐
                    ▼                                                 │
 idle ──prepare()──▶ (ready) ──showTitle()──▶ title ──start()──▶ playing ──[end] / [ending id] / end of script──▶ ending
   ▲                    └──────────── start() ────────────────────▲       restart() / restoreState() ──┘            │
   └──────────────────────────────────── destroy() ◀──────────────────────────────────────────────────────────────┘
```

- **`idle`** — nothing running. `prepare()` brings content and plugins in
  without leaving it; `ready` resolves.
- **`title`** — `showTitle()` (or `[title]` in a script) stops whatever ran,
  clears variables / stage / audio / backlog, and draws the built-in title page
  (`[title]` in the config: heading, logo, background, music, buttons). New game
  is `start()`, Continue is `continueGame()` (the autosave), Load and Settings
  open the menu's panels. A host that draws its own page passes `screens: false`
  (or `[title] enabled = false`) and keeps the state machine.
- **`playing`** — every session entry: `start()`, `restart()`, `restoreState()`,
  a replay. While playing, `waitingForPlayer` *(since 0.19.0)* is true when
  a line is fully shown and waits for the player to go on — not while it types, a
  transition or a command runs, or a prompt is up.
- **`ending`** — `[end]`, `[ending id]` or running off the end. `engine.ending`
  is the id (`default` unless named); `onEnd` still fires; the ending page for
  that id (`[ending.<id>]`: heading, background, music, rolling credits, what
  happens after) is drawn. `[ending true_end]` is how a script names its endings
  — for the page and for plugins (galleries, achievements) listening to
  `onSessionChange`.

`engine.session` reads the state; `onSessionChange(fn)` (and the
`onSessionChange` option / plugin hook) receives `(state, prev)`. Every session
entry is announced, even from `playing` to `playing` (`restart()`, loading while
playing), so a plugin that draws its own things resets them there. On a load the
order is `onSessionChange` → each plugin's `restoreState` → `onRestored`.

While `playing`, the built-in **system menu** (☰ / Esc, `[menu]` in the config)
offers save / load / quick save / quick load / backlog / auto / skip / settings /
replays / title / restart over the same API listed under [Playing](#playing);
wheel-up over the stage opens the backlog. It needs no plugin — `[use menu]`
from before 0.15 is ignored with a diagnostic.

A title page in a host, today:

```ts
const engine = createEngine({ container, onSessionChange: (s) => titleEl.hidden = s !== 'title' })
await engine.load('./game/')       // or loadConfig
await engine.prepare()
await engine.showTitle()
newGameBtn.onclick = () => void engine.start()
continueBtn.onclick = () => void engine.restoreState(JSON.parse(localStorage.getItem('save')!))
engine.onSessionChange((s) => { if (s === 'ending') setTimeout(() => void engine.showTitle(), 3000) })
```

### Screens

The pages are drawn by the renderer from a model the engine builds
(`titleModel` / `endingModel`, exported for hosts that want the same model
elsewhere): strings from the chrome catalog (`engine.t(id)`, overridable per work
through `messages` / `[strings]`), `@key` texts through the content catalogs, the
buttons wired to `start()` / `continueGame()` / `showTitle()` / `restart()`. A page
swallows its own clicks (nothing reaches click-to-advance), focuses its primary
button, follows a language switch, and draws with the theme's `panel-*` /
`button-*` / `accent` tokens. `Renderer.chrome` (`showScreen(id, model)` /
`hideScreen` / `currentScreen`) is the seam a non-DOM backend implements.

### Saves and persistence

`engine.saveStore` is where the engine's own persistence goes: the slots
(`slot:<n>`), the quick save (`quick`), the autosave (`auto`), the player
settings (`settings`), the read-line set behind skip mode (`read`), the
replay unlocks (`unlocks`) and the persistent variables (`globals`, a
`GlobalsPayload` `{ v: 1, vars }` holding every persistent value the work ever
wrote) — key constants are exported. The default is
`localStorage` under `nilvn:<saveKey>:<key>` (`LocalStorageSaveStore`;
`MemorySaveStore` for hosts without storage); a shell passes its own `SaveStore`
(`get` / `set` / `remove` / `keys`, all async, JSON values). A save is a
`SlotPayload` (`{ v: 1, savedAt, preview, state }`); the autosave is written at
every label (or line, or never — `[saves] autosave`); `onSaved` fires for every
snapshot taken. Saves and settings the pre-0.15 menu plugin kept in
`localStorage` are migrated into the store on the work's first `prepare()`.

## Saving and restoring

```ts
const save = engine.saveState()          // SaveState, JSON-serializable
const ok = await engine.restoreState(save)
```

A layered character saves its layer values (`stage.chars[].layers`) and is
rebuilt from the actor's templates on load.

`SaveState` (`v: 2`) holds the playhead as a `{ label, offset }` address (stable
across re-exports that keep the labels), the variables, a stage snapshot, the text
speed, the language, the playing music and ambience tracks, the pending
`[call]` returns (`calls`), the panels' show decisions (`ui`), and `ext` — one slice per plugin that declared
`save.slice`. `restoreState` returns `false` without
touching anything when the save is incompatible (wrong version, a label that no
longer exists, an out-of-range offset). A slice whose plugin is not active is
carried through to the next save untouched. `extVersion` records the shape version
of each slice that is not version 1 (`EnginePlugin.stateVersion`); on load an older
slice goes through the plugin's `migrateState`, and one it cannot read is dropped
with a diagnostic without failing the load.

`saveKey` and `buildInfo` are the per-work id and tool version the engine's
persistence uses to namespace and label saves.

The stage snapshot carries the speaker's name-tag colours (`nameColor` = background,
`nameTextColor` = text) and the script's theme layer (`theme`, the tokens
`[theme …]` set) — not the host / config base layer, which belongs to the work.

## Theming

Everything the built-in chrome draws with — the dialogue box, name tag,
click-to-continue indicator, choice buttons, and the menus and screens — is a
CSS custom property `--nilvn-<token>` on the stage root. The engine's stylesheet
declares the defaults; you only ever override. Token names are a public contract
(renames go through a deprecation period). Three ways in, one output:

| Entry | Layer | Lifetime |
|---|---|---|
| `createEngine({ theme })`, `engine.setTheme(patch)` | base | The work — survives `restart()` and loads; not in a save. |
| `[theme]` / `[window]` in the config file | base | Same (applied by `loadConfig`). |
| `[theme name-bg=#0b1c2e]` in the script | script | The scene — saved with the stage, cleared by `restart()` / `[theme reset]`. It reaches the ending page too, so an ending can be coloured from the line before `[ending]`, and goes when the session resets. |

`engine.theme` is the effective override map (base then script), `THEME_TOKENS`
the defaults. A `''` value removes a token from its layer. An unknown token is a
diagnostic (`load` from the host / config, `exec` from the script) and is painted
anyway, so typos surface without breaking the page.

| Token | Draws |
|---|---|
| `font` | The stage font. |
| `ui-scale` | Multiplies every chrome font size (`text-size`, `name-size`, `choice-size`) — the one knob for small screens. |
| `accent` | The accent colour. Reach: the default of `name-bg` and `button-on-bg`, the sliders' thumbs, the backlog's ▶ buttons, the title / ending pages' primary button through `button-on-bg`. |
| `text` | Base text colour of the stage; `text-color` defaults to it. |
| `muted` | Secondary text: hints, captions, a locked or unavailable entry in a plugin screen. Derived from `text`. |
| `disabled` | A disabled control's text. Derived from `text`. |
| `dialog-bg` | Dialogue box background (any CSS background). |
| `dialog-skin` | An image stretched over the box (`url(…)`), above `dialog-bg`. |
| `dialog-skin-slice` | A nine-sliced skin instead: a full CSS `border-image` value (`[window] slice` builds it — `url(…) 40 fill / 40px stretch`). |
| `dialog-border` | Box border (`none` to drop it). |
| `dialog-radius` | Corner radius. |
| `dialog-opacity` | Opacity of the default chrome (background + skin), not of the text. |
| `dialog-inset` | Left / right inset. |
| `dialog-bottom` / `dialog-top` | Which edge the box hangs from, and how far. |
| `dialog-height` | Minimum height. |
| `dialog-padding` | Inner padding. |
| `text-size` / `text-line-height` | Dialogue text. |
| `text-color` / `text-shadow` | Dialogue text. |
| `name-bg` / `name-color` | Name-tag background (defaults to `accent`) and text. An actor's `color` / `textColor` override these for that speaker. |
| `name-size` / `name-offset` | Name-tag font size and left offset. |
| `name-shadow` | The name tag's drop shadow (a CSS `box-shadow`). *(since 0.19.0)* |
| `indicator-color` / `indicator-size` | The click-to-continue triangle. |
| `choices-backdrop` | The veil behind a choices prompt. |
| `choices-gap` / `choice-width` | Space between the buttons; each button's minimum width. |
| `choice-skin` / `choice-skin-slice` | An image on every button, stretched or nine-sliced (`[choices] skin` / `slice` build them). |
| `choice-chosen-bg` / `choice-chosen-color` | An option taken in an earlier run (`[choices] chosenStyle = "dim"`). |
| `choice-chosen-mark` | The badge after such an option under `chosenStyle = "mark"` — a CSS `content` value (`"\2713"`); `[choices] chosenMark` takes plain text. *(since 0.19.0)* |
| `choice-disabled-bg` / `choice-disabled-color` | A `disabled=` option (the text defaults to `disabled`). |
| `choice-timer-bg` / `choice-timer-color` | The time-left bar of a timed prompt. |
| `progress-bg` / `progress-color` | The loading page's progress bar. |
| `hud-bg` / `hud-border` / `hud-color` / `hud-radius` / `hud-padding` / `hud-size` | A `[ui.<id>]` HUD. |
| `window-bg` / `window-border` / `window-color` / `window-radius` / `window-padding` / `window-width` | A `[ui.<id>]` window (colours default to the `panel-*` values). |
| `bar-bg` / `bar-color` / `bar-height` | The `bar` widget. |
| `choice-bg` / `choice-color` / `choice-border` / `choice-hover` / `choice-radius` / `choice-size` | Choice buttons. |
| `choice-glow` | The glow under a hovered option (a CSS `box-shadow`); derived from `choice-hover`. *(since 0.19.0)* |
| `screen-bg` / `screen-color` / `screen-heading-shadow` | The title / ending / loading pages: the veil behind a page without a `background`, the page's text, and the heading's shadow (`[title]` / `[ending.<id>]` `color` and `shadow` override the last two per page). *(since 0.19.0)* |
| `panel-bg` / `panel-border` / `panel-color` | Menus, screens and plugin panels. |
| `button-bg` / `button-color` / `button-border` / `button-hover` | Buttons on those panels. |
| `divider` / `backdrop` / `panel-shadow` / `danger` | A rule between groups of a panel, the dim layer under a dialog, a floating panel's shadow, a warning (an invalid entry). *(since 0.19.0)* |
| `button-on-bg` / `button-on-color` | The selected / primary state: an active auto / skip item, the chosen option in a settings row, the current slot page, the title and ending pages' primary button. Set both when your `accent` is light, so the selected text keeps its contrast. |
| `input-box-bg` / `input-box-border` / `input-box-radius` | The `[input]` box (defaults to the panel look). |
| `input-box-skin` / `input-box-skin-slice` | An image behind the `[input]` box, stretched or nine-sliced (`[input] skin` / `slice` build them). |
| `input-bg` / `input-color` / `input-border` / `input-radius` / `input-size` | The `[input]` text field. |
| `input-prompt-color` / `input-button-bg` / `input-button-color` | The `[input]` box's prompt text and its Cancel button (OK keeps `button-on-*`). *(since 0.19.0)* |

Every token's default, as the base stylesheet declares it (generated from
`THEME_TOKENS`; values may reference other tokens):

<!-- theme-defaults:start — generated from THEME_TOKENS by packages/engine/test/theme-docs.test.ts -->
| Token | Default |
|---|---|
| `font` | `"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif` |
| `ui-scale` | `1` |
| `accent` | `#7c5cff` |
| `text` | `#f4f5fa` |
| `muted` | `color-mix(in srgb, var(--nilvn-text) 60%, transparent)` |
| `disabled` | `color-mix(in srgb, var(--nilvn-text) 35%, transparent)` |
| `dialog-bg` | `linear-gradient(180deg,rgba(22,26,42,.82),rgba(10,12,22,.92))` |
| `dialog-skin` | `none` |
| `dialog-skin-slice` | `none` |
| `dialog-border` | `1px solid rgba(255,255,255,.14)` |
| `dialog-radius` | `1.8cqh` |
| `dialog-opacity` | `1` |
| `dialog-inset` | `3.5%` |
| `dialog-bottom` | `3.5cqh` |
| `dialog-top` | `auto` |
| `dialog-height` | `24cqh` |
| `dialog-padding` | `3.6cqh 3cqw 2cqh` |
| `text-size` | `3.4cqh` |
| `text-line-height` | `1.75` |
| `text-color` | `var(--nilvn-text)` |
| `text-shadow` | `0 1px 2px rgba(0,0,0,.5)` |
| `name-bg` | `var(--nilvn-accent)` |
| `name-color` | `#ffffff` |
| `name-size` | `2.7cqh` |
| `name-offset` | `2.4cqw` |
| `name-shadow` | `0 2px 10px rgba(0,0,0,.35)` |
| `indicator-color` | `rgba(255,255,255,.85)` |
| `indicator-size` | `1.4cqh` |
| `choices-backdrop` | `rgba(5,6,12,.35)` |
| `choice-bg` | `linear-gradient(180deg,rgba(40,46,74,.92),rgba(24,28,48,.92))` |
| `choice-color` | `#ffffff` |
| `choice-border` | `1px solid rgba(255,255,255,.2)` |
| `choice-hover` | `rgba(140,160,255,.9)` |
| `choice-glow` | `0 6px 24px color-mix(in srgb, var(--nilvn-choice-hover) 28%, transparent)` |
| `choice-radius` | `99px` |
| `choice-size` | `3cqh` |
| `choice-width` | `38cqw` |
| `choices-gap` | `2.6cqh` |
| `choice-skin` | `none` |
| `choice-skin-slice` | `none` |
| `choice-chosen-bg` | `linear-gradient(180deg,rgba(40,46,74,.6),rgba(24,28,48,.6))` |
| `choice-chosen-color` | `rgba(255,255,255,.6)` |
| `choice-chosen-mark` | `"\2713"` |
| `choice-disabled-bg` | `rgba(30,33,46,.7)` |
| `choice-disabled-color` | `var(--nilvn-disabled)` |
| `choice-timer-bg` | `rgba(255,255,255,.15)` |
| `choice-timer-color` | `var(--nilvn-accent)` |
| `progress-bg` | `rgba(255,255,255,.15)` |
| `progress-color` | `var(--nilvn-accent)` |
| `hud-bg` | `rgba(10,12,22,.62)` |
| `hud-border` | `1px solid rgba(255,255,255,.14)` |
| `hud-color` | `var(--nilvn-panel-color)` |
| `hud-radius` | `1.2cqh` |
| `hud-padding` | `1.2cqh 1.6cqw` |
| `hud-size` | `2.2cqh` |
| `window-bg` | `var(--nilvn-panel-bg)` |
| `window-border` | `var(--nilvn-panel-border)` |
| `window-color` | `var(--nilvn-panel-color)` |
| `window-radius` | `1.4cqh` |
| `window-padding` | `2.4cqh 2.4cqw` |
| `window-width` | `40cqw` |
| `bar-bg` | `rgba(255,255,255,.15)` |
| `bar-color` | `var(--nilvn-accent)` |
| `bar-height` | `1.4cqh` |
| `screen-bg` | `rgba(8,10,18,.92)` |
| `screen-color` | `var(--nilvn-panel-color)` |
| `screen-heading-shadow` | `0 2px 12px rgba(0,0,0,.5)` |
| `panel-bg` | `rgba(16,18,28,.96)` |
| `panel-border` | `1px solid rgba(255,255,255,.16)` |
| `panel-color` | `#f4f5fa` |
| `button-bg` | `rgba(255,255,255,.08)` |
| `button-color` | `#ffffff` |
| `button-border` | `1px solid rgba(255,255,255,.18)` |
| `button-hover` | `rgba(255,255,255,.16)` |
| `divider` | `rgba(255,255,255,.1)` |
| `backdrop` | `rgba(0,0,0,.45)` |
| `panel-shadow` | `0 1.2cqh 4cqh rgba(0,0,0,.5)` |
| `danger` | `#e05555` |
| `button-on-bg` | `var(--nilvn-accent)` |
| `button-on-color` | `var(--nilvn-button-color)` |
| `input-box-bg` | `var(--nilvn-panel-bg)` |
| `input-box-border` | `var(--nilvn-panel-border)` |
| `input-box-radius` | `1.4cqh` |
| `input-box-skin` | `none` |
| `input-box-skin-slice` | `none` |
| `input-bg` | `rgba(255,255,255,.08)` |
| `input-color` | `var(--nilvn-panel-color)` |
| `input-border` | `1px solid rgba(255,255,255,.25)` |
| `input-radius` | `0.8cqh` |
| `input-size` | `3cqh` |
| `input-prompt-color` | `var(--nilvn-panel-color)` |
| `input-button-bg` | `var(--nilvn-button-bg)` |
| `input-button-color` | `var(--nilvn-button-color)` |
<!-- theme-defaults:end -->

Sizes use container units (`cqh` / `cqw` = 1 % of the stage height / width) so
they scale with the stage, not the viewport. The stage itself is a fixed 16:9 box
that scales to its container's width; on a portrait phone the whole stage is
small, and `ui-scale` is the intended remedy:

```toml
[theme]
"ui-scale" = "1.25"          # bigger dialogue and choices everywhere
font = "'Noto Serif SC', serif"
```

A minimal reskin — no CSS, no host code:

```toml
[window]
skin = "@ui/box.png"         # your box art, stretched
position = "bottom"
opacity = 0.95

[theme]
"name-bg" = "#0b1c2e"
"name-color" = "#ffe2a8"
"text-shadow" = "none"

[actors.yuki]
color = "#ff7eb6"            # this speaker's name tag stays pink
```

From a host page, the same thing:

```ts
engine.setTheme({ 'name-bg': '#0b1c2e', 'name-color': '#ffe2a8', 'ui-scale': 1.25 })
if (prefersLight) engine.setTheme({ 'dialog-bg': '#fff', 'text-color': '#222' })
```

Plugins read the theme through `ctx.theme` (`get` / `all` / `onChange`) and write
their own CSS with `var(--nilvn-…)` rather than colour literals, so a plugin's
panel follows the work's theme. `editStage` is the studio's hit-testing seam, not a
theming API — the class names it exposes are not a contract.

Deprecated: `--name-color` on the name tag (pre-0.15) is still *set* for a host
stylesheet that read it, but the engine no longer reads it; use `name-bg`.

## Languages

| Member | Description |
|---|---|
| `lang`, `defaultLang`, `languages` | Current content language, fallback, and the switchable set. |
| `catalogs` | Content text by language and key. |
| `resolveText(key)` | A key in the current language, then the default language, then `''`. |
| `setLanguage(lang)` | Switch content and chrome language and repaint the line or choices on screen in place (a line parked at a `{p}` page repaints that page); playback state is untouched. Ignored for a language with no catalog. Async, because chunked play may need to fetch that language's text slice first. |
| `onLanguageChange(fn)` | Subscribe to switches; returns an unsubscribe function. |

Chrome strings: the engine's own pages carry theirs (`en` base, `zh`, `ja`;
ids in `CHROME_STRING_IDS`), a work overrides any id through `messages` /
`[strings.<lang>]`, and `engine.t(id, params?)` resolves in the work's language.
A plugin's `ctx.t` looks in the plugin's manifest `messages` first, then here.
The lookup mechanism — `tUI(id, params?, lang?)`, `setUILang(lang)`,
`getUILang()` — and `uiLangName(code)` (`ja` → 日本語, also
`settings.languageName` on the plugin context) are exported for hosts.

## Diagnostics

The engine never throws on content. Instead it reports an `EngineDiagnostic` and
degrades: a bad line is skipped, a missing plugin's commands become no-ops, an
unknown jump target stays in place, a chunk that fails to load ends the script
cleanly.

```ts
interface EngineDiagnostic {
  phase: 'parse' | 'load' | 'exec' | 'jump' | 'plugin'
  message: string
  line?: number        // 1-based script line, when known
  node?: ScriptNode    // the node that was executing
  plugin?: string      // the owning plugin
  chunk?: string       // the chunk (load phase)
  error?: unknown      // the underlying exception, if any
}
```

| Member | Description |
|---|---|
| `diagnostics` | Everything reported so far, oldest first (capped at 500). |
| `missingPlugins` | `[use]` names that resolved to nothing. |
| `isolatedPlugins` | Plugins quarantined after repeated command failures or a failing `activate`. |
| `EngineOptions.onError` | Called for every diagnostic. Plugins get the same through their `onError` hook. |
| `report(info, once?)` | Report a diagnostic yourself (`once` collapses repeats of the same phase / line / message). |
| `warnOnce(msg)` | Shorthand for a deduplicated `exec` diagnostic. |

## Audio

| Member | Description |
|---|---|
| `playTrack(track, url, { loop, volume, fade, restart })` | Start or replace a named looping track. `Engine.MUSIC_TRACK` (`'music'`) is the BGM slot; other names are ambience beds layered under it. A track already playing `url` (same `loop`) carries on and only moves to the new `volume` over `fade`, unless `restart: true` *(since 0.19.0)*. |
| `playBgm(url, opts)` / `stopBgm(fadeSec)` | The BGM slot. |
| `stopTrack(track, fadeSec)` / `stopAllTracks(fadeSec)` | Stop one track or every loop. |
| `playSe(url, volume)` | One-shot sound effect. |
| `bgmVolume`, `ambienceVolume`, `seVolume`, `voiceVolume` | Master volumes, `0..1`; call `applyVolumes()` after changing one so playing clips follow. |
| `setPendingVoice(ref, offset)` | Queue a voice clip for the next dialogue line (what `[voice]` does). |
| `voicePlaying` | True while a per-line voice clip plays. |
| `getBacklog()` | The session's dialogue history (`speaker`, `text`, `lang`, optional `voiceRef` / `offset`). |
| `replayVoice(ref, offset)` | Replay a backlogged voice clip by its reference. |

## Plugins and capabilities

A plugin is an `EnginePlugin` object — an id, the permissions it needs, and its
contributions (commands, text effects, effects, object kinds, hooks, styles,
`activate` / `deactivate`, a save slice). It never receives the engine or the
DOM: for each granted permission a capability object exists on its context
(`ctx.stage`, `ctx.audio`, `ctx.vars`, `ctx.saves`, `ctx.settings`,
`ctx.backlog`, `ctx.replay`, `ctx.ui`, `ctx.timer`), and a permission that was not
granted is simply absent. Everything registered through the context is released
when the plugin is deactivated, which is what makes hot reload safe.

The authoring guide, the permission catalog and the capability surfaces are in
[`@nilvn/plugin-sdk`](../../plugin-sdk/README.md). The engine side of the contract:

| Member | Description |
|---|---|
| `install(plugin)` | Register and activate a host plugin now (all declared permissions granted, never removed by `setPlugins`). |
| `registerPlugin(plugin, manifest?)` | Register for `[use id]` / `enablePlugin` without activating. |
| `enablePlugin(idOrUse)` | Hot-plug on: activate a registered plugin, or load one by its `[use]` spelling. Resolves to whether it is active. |
| `disablePlugin(id)` | Hot-plug off: deactivate and release everything it registered. |
| `reloadPlugin(id)` | Deactivate, re-import (cache-busted for path plugins), activate, carrying the save slice across; rolls back on failure. |
| `setPlugins(ids)` | Make exactly these (plus host plugins) the active set. |
| `activePlugins` | Active ids in activation order. |
| `pluginState(id)` | `'registered' \| 'active' \| 'isolated' \| 'blocked'`, or undefined. |
| `ENGINE_CAPABILITIES` | The permission ids this engine implements. |
| `PLUGIN_API_VERSION`, `PLUGIN_MANIFEST_FILE`, `PERMISSION_IDS`, `matchPermission`, `isPluginId`, `manifestProblems(manifest)` | The runtime's mirror of the manifest contract (the full validator lives in `@nilvn/core`). |
| `satisfiesRange`, `isValidRange`, `parseSemVer`, `compareSemVer` | The semver subset manifests use (`*`, `1.2.3`, `^1.2`, `~1.2.3`, `>=0.14 <1`, `a \|\| b`). |
| `ENGINE_VERSION` | This engine's version, checked against a manifest's `engine` range. |

The engine exports no plugins. `FIRST_PARTY_ID_PREFIX` (`app.nilvn.`) and
`firstPartyShortName(id)` describe the one convention it honors: a registered
plugin whose id is in that namespace also answers to its last segment, so
`[use textfx]` reaches `app.nilvn.textfx` once the host has registered it. The
first-party set is [`@nilvn/plugins`](https://github.com/nilzx/nilvn-plugins)
(`withFirstParty()` → `{ registry, manifests }`).

## Stage and objects

| Member | Description |
|---|---|
| `stage` | The renderer (`DomRenderer`), implementing the `Renderer` interface: background, characters, sprites, the generic transform surface, bands, faces, the dialogue box, transitions, `snapshot()` / `restore()`. |
| `showActor(id, face?, { at, fade, src, y, scale, rotation })` | Show a character through the actor sprite table (what `[char]` does). |
| `applyEffect(name, objId, params)` | Apply a registered effect to an object, checked against the effect's `appliesToKinds`. |
| `getEffect(name)` / `getKind(id)` | Look up a registered effect or object kind. |
| `applyChannel(objId, chId, value)` / `readChannel(objId, chId)` | Write or read one recordable channel of an object (the keyframe editor's seam). |
| `playFrames(durationSec, tracks)` / `stopFrames()` | Play or abort a decoded keyframe event-frame. |
| `startLoop(objId, …)` / `stopLoop(objId, exit)` / `runningLoops()` | Single-object background loops. |
| `editStage` | The `EditStage` seam an authoring tool decorates and hit-tests against (stage root, dialogue box, name tag, object elements and ids). |

Object ids and the transform schema are described in
[commands.md](commands.md#object-ids). `DomRenderer`, `animate`, `preloadImage`,
`ObjectHandle`, `kindOf`, `BUILTIN_KINDS` and the renderer types (`Renderer`,
`StageState`, `Transform`, `AnimFrame`, `AnimOpts`, …) are exported for hosts that
build on the stage directly.

## Replay segments

| Member | Description |
|---|---|
| `replays` | Segments declared by `[replaydef]` (`id`, `title`, start `label`). |
| `playReplay(segId)` | Play one segment as a replay. An unlocked segment starts from its **scene** *(since 0.19.0)*: the session as normal play reached the segment's start label on the run that unlocked it — background, characters, music, variables, `[ui]` panels and plugin state, as the player saw them — so a segment that relies on what came before looks the same in the gallery. A segment without a kept scene (unlocked before 0.19) starts clean: fresh session variables, a blank stage, silence, panels at their `show` policy. Either way `sys.replaying` reads true, and the **persistent variables** (`[persist]`, `sys.*`) a replay writes are rolled back when it ends *(since 0.19.0)* — a replay is a memory, not progress. Plugin storage (`ctx.storage`) is the plugin's own and is not rolled back; a plugin that should not count a replay checks `ctx.replay.isReplaying()`. |
| `replayThumbnail(segId)` | The picture of an unlocked segment — the background on screen when it was unlocked — resolved, or undefined. The menu's gallery shows it. *(since 0.19.0)* |
| `isReplaying()` | The segment id being replayed, or null. A script reads the same as `sys.replaying`. |
| `onSegmentSeen(fn)` | Subscribe to "normal play passed a segment's end" — the unlock signal. |
| `onReplayEnd` | Orchestrator callback when a replay reaches its end (the menu restores the interrupted session here). |

A `[replaydef]` is registered when **its chunk is parsed**, and a load may start
in any chunk, so declare every segment in the **entry** chunk — a preamble at the
top of the first script, which is the shape NilVN Studio emits. A declaration
left in a later file is missing from the gallery until play reaches that file,
which a loaded save can skip past.

A segment's scene and picture are kept with the unlock in the player's storage
(`SaveStore` key `replays`), beside `unlocks`.

## Parsing and evaluation

| Export | Description |
|---|---|
| `LocalStorageSaveStore`, `MemorySaveStore`, `AUTOSAVE_KEY`, `isSlotPayload` | The persistence seam's bundled stores and the autosave's key / payload guard (see [Saves and persistence](#saves-and-persistence)). |
| `titleModel(cfg, host)`, `endingModel(id, cfg, host)`, `screenBackground`, `TITLE_BUTTONS_DEFAULT`, `CHROME_STRING_IDS` | The built-in pages' model builders and the chrome string ids. |
| `THEME_TOKENS`, `THEME_PREFIX`, `isThemeToken(key)`, `themeVar(key)`, `windowTheme(win, resolve)` | The theme contract: the token table with defaults, the `--nilvn-` prefix, and the `[window]` → tokens mapping (see [Theming](#theming)). |
| `KEYS_DEFAULT`, `matchKey(binding, event)`, `parseBinding(binding)`, `MENU_ITEMS_DEFAULT`, `SETTINGS_ROWS_DEFAULT`, `TEXT_SPEED_RANGE_DEFAULT` | The keyboard defaults and matcher (`[keys]`), the menu's default items, the settings panel's default rows and the text-speed slider's default range. |
| `parseScript(text)` | `{ nodes, labels, diagnostics }` — the node stream a script becomes. |
| `parseSegments(text)` | Inline markup → text / pause / break segments. |
| `parseTag(inner, line)` | One `[…]` tag → a node (macros expand through it). |
| `Renderer.showHotspot(spec)` / `hideHotspot(id)` / `clearHotspots()` / `objectClick` | Clickable regions (`HotspotSpec`, saved in `StageState.hotspots`) and the callback the engine installs to run an object's `onclick`; `SpriteSpec.onclick` makes a sprite clickable. |
| `Renderer.evalCondition` / `refreshConditions()` | An object's `if` (`HotspotSpec.if`, `SpriteSpec.if`): the engine installs the evaluator and calls `refreshConditions()` after every variable change; an object whose condition is false is not drawn and takes no click. *(since 0.19.0)* |
| `Renderer.beginTransition()` / `endTransition(kind, opts)` / `transitionPending()` / `charLayers(id)` | The scene-transition seam (a frozen snapshot of the camera, revealed with one of the kinds or a rule mask) and a layered character's current values; `transitionScreen` takes `mask` too. |
| `evalExpr(src, vars)` / `truthy(value)` / `EXPR_FUNCTIONS` | The `[set]` / `[if]` expression evaluator and its function whitelist (`has`, `rand`, `min`, `max`, `floor`, `len`). |
| `interpolateText(text, host)` / `interpolateSegments(segments, host)` / `displayValue(v)` | The `{$var}` / `{@key}` filling behind `engine.fill()`, for tooling that renders script text outside an engine. |
| `CONFIG_SCHEMA` / `checkConfig(cfg, { skip })` | The config file's schema (plain data, a JSON-Schema subset) and the checker `applyConfig` runs: unknown sections / keys, wrong types, values off their lists become `load` diagnostics (`config: <path>: …`). |
| `inputTheme(input, resolve)` / `choicesTheme(cfg, resolve)` | The `[input]` → `input-*` and `[choices]` → `choice-*` tokens mappings. |
| `buildFileManifest(files, lang)` / `FileScriptLoader` / `expandIncludes(text, url, host)` / `scanLabels` / `scriptId` | The multi-file machinery: script files as a chunk manifest, the in-memory loader, `[include]` splicing. |
| `scanAssetRefs(nodes, actors)` / `isImageUrl(url)` | What a script references (built-in commands, face sprites) — behind `[preload] auto`. |
| `decodeTracks`, `sampleContinuous`, `sampleContinuousCarry`, `discreteAt`, `easeFn` | The keyframe wire codec and the interpolation the engine plays with (shared with tooling that scrubs the same animations). |

## Packages

| Export | Description |
|---|---|
| `openPackage(source)` | Any package form → `ScriptPackage` (`{ manifest, loader }`). |
| `inlinePackage(data)` | Wrap a single-file export's inline payload. |
| `checkPackageManifest(json)` / `isPackageManifest(x)` | Validate a parsed `nilvn.json`; throws / returns false for foreign or unsupported files. |
| `WebContentLoader`, `ZipContentLoader`, `InlineContentLoader` | The three bundled loaders. |
| `PackageFormatError` | Thrown for a file this engine cannot play. |
| `PACKAGE_FORMAT`, `PACKAGE_MANIFEST_FILE` | The format number and file name (`nilvn.json`). |

`@nilvn/engine/playtest` *(since 0.19.0)* types a playtest file for `nilvn playtest` (`definePlaytest`, `PlaytestDriver`, `PlaytestStep`) — see [playtest.md](playtest.md).

`@nilvn/engine/pack` *(since 0.19.0)* plans a package from a config-driven
work — `packWork(input)`, `inlinePayload(result, base64)`, `mimeOf(path)`,
`slugify(title)` — and is what the `nilvn pack` command runs; see
[script-package.md → Packing a config-driven work](script-package.md#packing-a-config-driven-work-nilvn-pack).

## The IIFE build

`@nilvn/engine/iife` is the same engine as one self-contained script that defines
a global `ADV` with the package's exports. It carries no dependencies (the TOML
parser is stubbed out, so `loadConfig` needs the ESM build) and, like the ESM
build, no plugins: `[use textfx]` against this file is a diagnostic, not an
effect. The batteries-included counterpart that exported games inline is
`@nilvn/plugins/iife`, whose `createEngine` already carries the first-party set.

```html
<div id="app"></div>
<script src="nilvn-engine.iife.js"></script>
<script>
  const engine = ADV.createEngine({ container: document.getElementById('app') })
  engine.loadSource('[label start]\nyuki: Hello!\n')
  engine.start()
</script>
```
