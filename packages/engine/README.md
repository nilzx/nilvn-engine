# @nilvn/engine

A small visual-novel (ADV / galgame) engine for the browser. Scripts read like a
story — `yuki: Hi!` plus a few bracket commands — and everything expressive
(screen shake, text effects, sprite animation, choice styling, camera moves) is a
plugin you can write in plain JavaScript. The engine is the mechanism: parser,
stage, audio, saves, languages, the finished game's shell (title and ending
pages, the in-game menu with saves / backlog / auto / skip / settings, themeable
without CSS) and a capability-sandboxed plugin host. The first-party plugins live in [`@nilvn/plugins`](https://www.npmjs.com/package/@nilvn/plugins)
and are written against the same public surface as yours. TypeScript, DOM + CSS
rendering, no framework; the only runtime dependency is a TOML parser that the
single-file build drops.

```bash
pnpm add @nilvn/engine @nilvn/plugins
```

```ts
import { createEngine } from '@nilvn/engine'
import { withFirstParty } from '@nilvn/plugins'

const engine = createEngine({ ...withFirstParty(), container: document.getElementById('app')! })
await engine.loadConfig('./nilvn.config.toml')   // plugins, actors, title / ending pages, menu, theme
await engine.showTitle()                         // the title page; New game plays the config's entry script
```

`start()` plays at once and resolves when the story ends; a host without a title
page calls it instead. From an empty folder to a deployed game:
[Getting started](docs/getting-started.md).

The content language defaults to `en`; a multi-language game passes `lang`,
`defaultLang`, `languages` and per-language `catalogs` (see the [engine API](docs/api.md#languages)).

A script:

```
[use textfx screenfx charfx]
[actor yuki name=Yuki color=#ff7eb6 sprites=assets/char/yuki-{face}.svg]

[bg assets/bg/street.svg fade=1.5]
An evening street. Shadows stretch long.
[char yuki happy]
yuki: You came! {wave:I've been waiting~}
yuki(angry): You're late again!
[shake strength=14 duration=0.5]

[choice Apologize -> apologize]
[choice Make an excuse -> excuse if=courage>=2]

[label apologize]
me: I'm sorry...
[end]
```

The player clicks, or presses Space / Enter, to advance.

## Three ways to load a game

| | Call | Good for |
|---|---|---|
| Config + script | `loadConfig('./nilvn.config.toml')` then `start()` | Hand-written games: one TOML file declares plugins, actors, path aliases, macros and defaults; the script stays pure story. |
| Script only | `load('./story.nvn')` or `loadSource(text)` | Quick embeds; the script declares what it needs with `[use]` / `[actor]` / `[alias]`. |
| Script package | `load('./my-game/')`, `load(zipBytes)`, `load(inlinePackage(payload))` | Works exported by NilVN Studio: `nilvn.json` plus chunked scripts, per-language text and assets — streamed on demand, switchable language, saves. |

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | An empty folder to a deployed game with a title page, endings, saves and settings; npm-user vs contributor commands. |
| [Script syntax](docs/script-syntax.md) | Lines, inline markup, `@key` text references, variables and conditions, macros, actors, plugins, paths. |
| [Config file](docs/config.md) | Every section of `nilvn.config.toml`. |
| [Command reference](docs/commands.md) | Built-in commands and object ids (the first-party plugins' commands are in [`@nilvn/plugins`](https://github.com/nilzx/nilvn-plugins#the-plugins)). |
| [Engine API](docs/api.md) | `createEngine` options, loading, playing, saves, languages, diagnostics, audio, plugins, stage, packages, the IIFE build. |
| [In-game chrome](docs/config.md#title) | The built-in title / ending pages, the system menu (saves, backlog, auto / skip, settings), what `[title]` / `[ending.<id>]` / `[menu]` / `[settings]` / `[saves]` configure. |
| [Theming](docs/api.md#theming) | The `--nilvn-*` token contract: dialogue box, name tag, choices, panels; `[theme]` / `[window]` in the config, `setTheme()`, the `[theme]` command. |
| [Script packages](docs/script-package.md) | The `nilvn.json` format, the chunk manifest, custom loaders. |
| [Writing plugins](../plugin-sdk/README.md) | The plugin package format, permissions and capability objects, lifecycle — in `@nilvn/plugin-sdk`. |

## What the engine guarantees

- **Content never crashes the host.** A bad line, an unknown command, a missing
  plugin, a broken jump target or a chunk that fails to load is reported as a
  diagnostic (`engine.diagnostics`, `onError`) and play degrades around it.
- **Plugins are sandboxed by capability.** A plugin declares permissions and
  receives capability objects for exactly those; it never sees the engine or the
  DOM, and everything it registers is released when it is deactivated. Plugins can
  be enabled, disabled and reloaded while a game runs.
- **Saves are stable.** A save addresses the script by label and offset and
  carries the stage, variables, audio and language; incompatible saves are refused
  rather than misapplied.
- **Text is localizable at runtime.** Scripts reference text by key, catalogs
  ship per language, and the language can switch mid-line without losing state.

## Plugins

The engine registers nothing by itself. A host hands it plugins three ways:

- `createEngine({ registry, manifests })` — modules made available to
  `[use id]` (or the short name of an `app.nilvn.*` id), each with its manifest;
  `@nilvn/plugins`' `withFirstParty()` is exactly this pair for the first-party set.
- `createEngine({ plugins })` — the host's own modules, activated at once.
- `[use ./x/plugin.json]` / `[use ./x.js]` in the script — fetched at play time.

The first-party set (`textfx`, `screenfx`, `charfx`, `objectfx`, `spriteanim`,
`choicefx`, `voicefx`, `animstudio`, `abreplay`) is documented in
[`@nilvn/plugins`](https://github.com/nilzx/nilvn-plugins); writing your own
starts at [`@nilvn/plugin-sdk`](../plugin-sdk/README.md).

## Two builds

- **ESM** (`import … from '@nilvn/engine'`, `dist/index.js` + `.d.ts`) for
  bundled apps.
- **IIFE** (`@nilvn/engine/iife`, `dist/nilvn-engine.iife.js`): one
  self-contained script that defines a global `ADV` with the same exports, for a
  `<script>` tag. It has no dependencies, so `loadConfig` (the TOML parser) is
  ESM-only. It carries no plugins; the batteries-included bundle that exported
  games run is `@nilvn/plugins/iife`.

## Working in the repository

```bash
pnpm build         # dist/: ESM + .d.ts + the bare IIFE
pnpm typecheck
```

Tests live in `test/` and run with `pnpm test` from the repository root;
`test/iife-smoke.test.ts` boots the minified bundle. The demo game and the
single-file game bundler live with the first-party plugins in `@nilvn/plugins`.

## License

MIT.
