# Config file (`nilvn.config.toml`)

A game can put all of its declarations in one TOML file so the script stays pure
story. `engine.loadConfig(url)` fetches and applies it; assets, plugins and the
entry script then resolve relative to the config file's directory. Every section
is optional, and each one has an equivalent `createEngine` option (see
[api.md](api.md#engineoptions)).

```toml
[game]
title = "Secret Base"       # sets document.title
entry = "story.nvn"         # script that start() loads when nothing else was loaded
textSpeed = 40              # typewriter speed, characters per second

[plugins]
use = ["screenfx", "textfx", "charfx", "choicefx", "voicefx", "plugins/glitch.js"]

[path]                      # path prefix aliases, usable in every resource path
"@bg" = "assets/bg"
"@char" = "assets/char"
"@bgm" = "assets/bgm"
"@se" = "assets/se"

[actors.yuki]
name = "Yuki"               # or nameKey = "actor.yuki" for a localizable name
color = "#ff7eb6"
sprites = "@char/yuki-{face}.svg"
face = "happy"              # default face
voice = 360                 # typing-blip pitch in Hz (voicefx)

[actors.me]
name = "Me"                 # no sprites: a narrator-like actor with a name tag only
voice = 290

[defaults]                  # per-command default parameters (the script's own win)
bg = { fade = 1.2 }
char = { fade = 0.5 }
fadeout = { duration = 1.0 }
fadein = { duration = 1.0 }

[macros]                    # command macros
bg_street = "bg @bg/street.svg"
theme = "bgm @bgm/daily.wav volume=0.45"
quake = """
se @se/impact.wav volume=0.7
shake strength=14 duration=0.5
"""
```

## Sections

### `[game]`

| Key | Type | Effect |
|---|---|---|
| `title` | string | Sets `document.title`. |
| `entry` | string | Script `start()` auto-loads when no script or package was loaded explicitly. Relative to the config file. |
| `textSpeed` | number | Typewriter speed in characters per second (default 40). |

### `[plugins]`

| Key | Type | Effect |
|---|---|---|
| `use` | string[] | Plugins to activate at `start()`. Same entries as the script's `[use …]`: host-registered ids (or the short names of `app.nilvn.*` ones), `…/plugin.json` packages, bare `.js` modules. |

### `[path]`

A table of prefix → path. `"@bg" = "assets/bg"` lets a script write
`@bg/street.svg`. Equivalent to `[alias @bg assets/bg]` in the script.

### `[actors.<id>]`

| Key | Type | Effect |
|---|---|---|
| `name` | string | Display name (defaults to the id). |
| `nameKey` | string | Catalog key for a localizable display name; wins over `name` when catalogs are loaded. |
| `color` | string | Name tag color. |
| `sprites` | string | Sprite URL template; `{face}` is replaced by the current face. |
| `face` | string | Default face (`defaultFace` in the runtime type). |
| `voice` | number | Base pitch (Hz) of the synthesized typing blip (`voicefx`). Without it a stable pitch is derived from the id. |

### `[defaults]`

One inline table per command: `bg = { fade = 1.2 }`. Values are stringified and
merged under the parameters the script writes, so `[bg x.svg]` fades for 1.2 s
while `[bg x.svg fade=0]` cuts. Positional parameters have named equivalents for
this purpose (`[wait]` and the fades take `duration`).

### `[macros]`

Name → expansion. A one-line macro expands to one command and accepts extra
parameters that override its own; a multi-line (triple-quoted) macro is a
sequence of commands. Macro names can be any string, including non-ASCII.
Macros may reference other macros up to depth 8.

## Languages

The config file declares no languages: content catalogs are runtime data. Pass
them to `createEngine({ catalogs, lang, defaultLang, languages })`, or play a
[script package](script-package.md), which carries them. The repository's
`bundle.mjs` reads an optional `catalogs.json` next to the config and injects it
this way.

## Reading the config at runtime

`engine.config` holds the parsed file after `loadConfig`, for settings screens
that want the same values.
