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
color = "#ff7eb6"           # name-tag background
textColor = "#1a1030"       # name-tag text (default: the theme's name-color)
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
mood = "bgm @bgm/daily.wav volume=0.45"
quake = """
se @se/impact.wav volume=0.7
shake strength=14 duration=0.5
"""

[theme]                     # theme tokens (--nilvn-<token>), see api.md#theming
accent = "#ff7eb6"
"name-bg" = "#0b1c2e"
"name-color" = "#ffe2a8"
"text-size" = "3.8cqh"

[window]                    # dialogue-box shorthand over the same tokens
skin = "@ui/box.png"        # image under the text; clears the default gradient + border
position = "bottom"         # or "top"
offset = "3.5cqh"
opacity = 0.9

[title]                     # the built-in title page (see below)
background = "@bg/title.png"
logo = "@ui/logo.png"
subtitle = "a one-night story"
bgm = "@bgm/title.ogg"
buttons = ["new", "continue"]

[ending.default]            # the page [end] / running off the end shows
heading = "The End"
credits = """
Story — you
Art — a friend
"""
after = "title"             # back to the title when the roll ends

[ending.true_end]           # [ending true_end] shows this one instead
heading = "True End"
background = "#0b1c2e"

[saves]
autosave = "label"          # Continue on the title page resumes from the last scene
pages = 10                  # slot pages × slots per page
slotsPerPage = 10

[menu]                      # the in-game system menu (☰ / Esc)
entry = "top-right"
items = ["save", "load", "quicksave", "quickload", "backlog", "auto", "skip", "settings", "replays", "title", "restart"]

[settings]                  # the settings panel + player defaults
autoDelay = 1.5
skipMode = "read"
show = ["textSpeed", "autoDelay", "skipMode", "volumes", "language", "fullscreen", "dialogOpacity", "uiScale"]

[strings.zh]                # chrome string overrides, per language
"ui.title.new" = "开始"
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

A sub-table per plugin holds its settings — the keys its manifest declares under
`contributes.config`:

```toml
[plugins]
use = ["textfx", "voicefx", "com.example.weather"]

[plugins.voicefx]                  # a first-party plugin by short name
level = 0.6
wobble = 0.1

[plugins."com.example.weather"]    # a third-party plugin by its full id
intensity = 0.8
```

Values are coerced to the declared type (numbers clamped to `min` / `max`, an
enum outside its options falls back to the default); a key the plugin does not
declare is one diagnostic. Fields the plugin marks `scope = "player"` also appear
in the game's settings panel, where the player's value overrides the author's and
persists per work. The runtime equivalent is `createEngine({ pluginConfig })` /
`engine.setPluginConfig(id, patch)`.

### `[path]`

A table of prefix → path. `"@bg" = "assets/bg"` lets a script write
`@bg/street.svg`. Equivalent to `[alias @bg assets/bg]` in the script.

### `[actors.<id>]`

| Key | Type | Effect |
|---|---|---|
| `name` | string | Display name (defaults to the id). |
| `nameKey` | string | Catalog key for a localizable display name; wins over `name` when catalogs are loaded. |
| `color` | string | Name-tag **background** colour. Absent = the theme's `name-bg`. |
| `textColor` | string | Name-tag **text** colour. Absent = the theme's `name-color`. |
| `sprites` | string | Sprite URL template; `{face}` is replaced by the current face. |
| `face` | string | Default face (`defaultFace` in the runtime type). |
| `voice` | number | The `voicefx` plugin's actor field: base pitch (Hz) of the synthesized typing blip. Any key a plugin declares under `contributes.actorFields` may sit here; the engine files it under the actor's `ext[pluginId]`. |

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

### `[theme]`

Token → value, token names without the `--nilvn-` prefix (quote the dashed ones:
`"name-bg" = "#0b1c2e"`). The full token table, defaults and layering rules are in
[api.md → Theming](api.md#theming). Values are painted as given, so anything CSS
accepts works (`"dialog-bg" = "linear-gradient(…)"`). An unknown token is a
`load` diagnostic and is still painted (`--nilvn-<token>`), so a typo shows up in
the diagnostics rather than failing silently.

### `[window]`

Dialogue-box shorthand that maps onto theme tokens — the everyday knobs without
memorising token names.

| Key | Type | Token(s) |
|---|---|---|
| `skin` | path | `dialog-skin` (whole-image stretch under the text); also sets `dialog-bg = transparent` and `dialog-border = none` unless `background` / `border` are given. |
| `background` | CSS background | `dialog-bg` |
| `border` | CSS border, or `none` | `dialog-border` |
| `radius` | length | `dialog-radius` |
| `opacity` | 0..1 | `dialog-opacity` — the default chrome's opacity; a skin image keeps its own alpha. |
| `position` | `bottom` (default) \| `top` | `dialog-top` / `dialog-bottom` |
| `offset` | length | Distance from that edge. |
| `inset` | length / % | `dialog-inset` (left and right). |
| `height` | length | `dialog-height` (minimum). |
| `padding` | CSS padding | `dialog-padding` |
| `font` | font-family | `font` (the whole stage). |
| `textSize`, `textColor`, `lineHeight`, `textShadow` | | `text-size`, `text-color`, `text-line-height`, `text-shadow` |
| `nameBackground`, `nameColor`, `nameSize` | | `name-bg`, `name-color`, `name-size` |
| `indicatorColor` | colour | `indicator-color` |

Lengths use the stage's container units (`cqh` / `cqw` = 1 % of the stage
height / width) so a layout scales with the stage; plain `%`, `px`, `em` work too.
The script's `[window skin=…]` command still reskins the box mid-story on top of
this base. Unknown keys are reported and ignored.

### `[title]`

The built-in title page — what a player sees before the story, drawn over the
stage by `engine.showTitle()` (a script's `[title]` goes back to it; the
exporter's boot will start here). Every key optional; with none, the page shows
the `[game] title` and a New-game button.

| Key | Type | Effect |
|---|---|---|
| `enabled` | boolean | `false` = the engine draws no page; the `title` session state still exists for a host that draws its own. |
| `heading` | string | Heading text (`@key` resolves through the catalogs). Default: `[game] title`. |
| `subtitle` | string | Under the heading. |
| `logo` | path | An image above the heading. |
| `background` | path or CSS | An image path, or a colour / gradient (`"#0b1c2e"`, `"linear-gradient(…)"`). |
| `bgm`, `bgmVolume` | path, 0..1 | Music while the page is up (stopped when the story starts). |
| `buttons` | string[] | Ids in order: `new`, `continue` (shown only when an autosave exists); `load` / `settings` once those screens exist. Default `["new", "continue"]`. Unknown ids are reported. |
| `layout` | `center` \| `left` \| `right` \| `bottom` | Where the block sits. |
| `version` | boolean | Show the tool version (`buildInfo`) in a corner. Default on when known. |

### `[ending.<id>]`

One table per ending: `[ending.default]` is what `[end]` and running off the
end show; `[ending true_end]` in the script shows `[ending.true_end]`. An ending
with no table still gets a page (the chrome's "The End" and the two buttons).

| Key | Type | Effect |
|---|---|---|
| `enabled` | boolean | `false` = no page for this ending (the session still enters `ending`). |
| `heading`, `subtitle` | string | Text (`@key` ok). Default heading: the chrome string `ui.ending.title`. |
| `background` | path or CSS | As for `[title]`. |
| `bgm`, `bgmVolume` | | Music for the page. |
| `credits` | string | Rolling credits: a multi-line string (or an array of lines), one entry per line, `@key` per line ok. |
| `creditsDuration` | seconds | How long the roll takes (default from the line count). |
| `after` | `none` \| `title` \| `restart` | What happens when the roll ends. Default `none` (the buttons wait). |
| `buttons` | boolean | `false` hides Back-to-title / Play-again. |

### `[saves]`

| Key | Type | Effect |
|---|---|---|
| `autosave` | `"label"` \| `"line"` \| `false` | When the autosave behind the title page's Continue is written: at every `[label]` (default — the start of each scene), once every line is shown, or never. |
| `pages`, `slotsPerPage` | number | The slot screen's layout (default 10 × 10). |
| `thumbnail` | `"bg"` \| `"none"` | Show the scene background in an occupied slot (default) or text only. |

Saves persist in `localStorage`, namespaced by the work (`saveKey`); a host can
substitute a `SaveStore` (see [api.md](api.md#saves-and-persistence)). Saves the
pre-0.15 menu plugin wrote are migrated into the store the first time the work
opens.

### `[menu]`

The in-game system menu: a ☰ entry (and the Esc key) opening a panel of
actions, each backed by a full-stage screen. It exists without any plugin.

| Key | Type | Effect |
|---|---|---|
| `enabled` | boolean | `false` = no menu; a host draws its own over `engine.saveSlot()` / `quickSave()` / `setAuto()` … |
| `entry` | `top-right` (default) \| `top-left` \| `bottom-right` \| `bottom-left` \| `hidden` | Where the ☰ sits; `hidden` keeps Esc and the wheel gesture only. |
| `items` | string[] | Ids in order: `save`, `load`, `quicksave`, `quickload`, `backlog`, `auto`, `skip`, `settings`, `replays` (shown when the work declares segments), `title`, `restart`. Default: all. Unknown ids are reported. |
| `wheelBacklog` | boolean | Wheel-up over the stage opens the backlog (default true). |

Back-to-title and Restart ask through the engine's own confirm box (never the
browser's). The menu is hidden on the title and ending pages.

### `[settings]`

The settings panel and the players' defaults. Every value a player changes is
persisted per work and restored on the next visit.

| Key | Type | Effect |
|---|---|---|
| `autoDelay` | seconds | Auto mode's pause after each line (plus a little per character; never before a voice clip ends). Default 1.5. |
| `skipMode` | `read` (default) \| `all` | What skip passes: lines seen before (skip ends at the first unread one) or everything. Holding **Ctrl** skips while held. Both modes stop at a choice. |
| `show` | string[] | Rows in order: `textSpeed`, `autoDelay`, `skipMode`, `volumes` (music / ambience / SFX / voice), `language` (when the work ships more than one), `fullscreen`, `dialogOpacity`, `uiScale`. Default: all. |

### `[strings.<lang>]`

Chrome string overrides by language, keyed by the engine's ids
(`ui.title.new`, `ui.title.continue`, `ui.ending.title`, `ui.ending.toTitle`,
`ui.ending.restart`, … — `CHROME_STRING_IDS` lists them). The engine ships
`en` (base), `zh` and `ja`; an override for the current language wins, then
`en`, then the engine's catalog.

## Languages

The config file declares no languages: content catalogs are runtime data. Pass
them to `createEngine({ catalogs, lang, defaultLang, languages })`, or play a
[script package](script-package.md), which carries them. The repository's
`bundle.mjs` reads an optional `catalogs.json` next to the config and injects it
this way.

## Reading the config at runtime

`engine.config` holds the parsed file after `loadConfig`, for settings screens
that want the same values.
