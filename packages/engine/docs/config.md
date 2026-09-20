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
slice = 40                  # nine-slice the skin (edge inset in image px) instead of stretching it
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
textSpeedRange = [10, 100]  # the text-speed slider, chars per second; its top notch is "instant"
show = ["textSpeed", "autoDelay", "skipMode", "volumes", "language", "fullscreen", "dialogOpacity", "uiScale"]

[keys]                      # keyboard bindings (KeyboardEvent.key names; false unbinds)
auto = "a"
skip = "Tab"
quicksave = "F5"
quickload = "F9"
backlog = "l"

[strings.zh]                # chrome string overrides, per language
"ui.title.new" = "开始"
```

## Sections

A section or key the engine does not know is reported (`engine.diagnostics`,
phase `load`, `config: <path>: unknown key`), as is a value of the wrong type
or off its list — `CONFIG_SCHEMA` in `@nilvn/engine` is the schema
(`checkConfig(cfg)` runs it).


### `[game]`

| Key | Type | Effect |
|---|---|---|
| `title` | string | Sets `document.title`. |
| `entry` | string | Script `start()` auto-loads when no script or package was loaded explicitly. Relative to the config file. |
| `textSpeed` | number | Typewriter speed in characters per second (default 40). |

`defaultLang` sets the fallback content language (as `createEngine({ defaultLang })`).
`scripts = ["intro.nvn", "day1.nvn"]` plays several files in order as chunks —
labels global, list-order fall-through, saves addressing the file (see
[script-syntax.md](script-syntax.md#several-files)); it takes precedence over `entry`.

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
| `canvas` | `[w, h]` | Layered sprite: the shared canvas the layers align on, in image pixels. |
| `layers` | table | Layered sprite: `[actors.<id>.layers]`, see below. Wins over `sprites`. |
| `face` | string | Default face (`defaultFace` in the runtime type). |
| `voice` | number | The `voicefx` plugin's actor field: base pitch (Hz) of the synthesized typing blip. Any key a plugin declares under `contributes.actorFields` may sit here; the engine files it under the actor's `ext[pluginId]`. |

#### `[actors.<id>.layers]`

A character drawn from several images composed on one canvas — a body, a face,
an optional extra — each swappable on its own:

```toml
[actors.yuki]
canvas = [600, 1100]                 # the shared canvas (px); layers align on it
[actors.yuki.layers]
body  = { src = "@char/yuki/body-{body}.png",   default = "uniform" }
face  = { src = "@char/yuki/face-{face}.png",   default = "happy", offset = [150, 280] }
extra = { src = "@char/yuki/extra-{extra}.png", optional = true }
```

Layers compose bottom to top in declaration order. `src` is a template where
`{<layer name>}` is replaced by the layer's value; `default` is the value used
until a command sets one; `offset` places a cropped layer image on the canvas
(a full-size image needs none); an `optional` layer is left out while it has no
value. The `face` layer is what `[char id face]` and `speaker(face):` drive; the
others change through `[char id body=casual extra=blush]`, and `extra=none`
clears an optional one. The bare value after the id is **always the face**
(`[char vera calm body=gown]`, never `[char vera gown]` — that would look for
`face-gown`). A layer or sprite image that fails to load is reported as a
diagnostic (`… image failed to load — <url>`). A save stores the layer values
and rebuilds the images on load. `[preload] auto` warms every layer image a
command implies.

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
| `skin` | path | `dialog-skin` (whole-image stretch under the text, or nine-slice with `slice`); also sets `dialog-bg = transparent` and `dialog-border = none` unless `background` / `border` are given. |
| `slice` | number, or up to four as in CSS `border-image-slice` | Nine-slice the skin: the inset of the slice lines in image pixels. Corners stay crisp, edges repeat by stretching, the centre fills the box. Sets `dialog-skin-slice` (a `border-image` value) and clears `dialog-skin`. |
| `sliceWidth` | CSS length(s) | How wide the sliced edges draw on the stage (default: the slice inset in `px`; `4cqh` scales with the stage). |
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

`overflow` is behaviour rather than a token: `grow` (default) lets the box
stretch with a long line; `page` fixes the box at `height` and breaks the line
into pages where the text would run past the bottom (a tap turns the page; auto
and skip turn it by themselves); `shrink` fixes the box and scales the text down
(to half at most) until the line fits. `{p}` in a line pages in every mode.

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
| `logoWidth` | CSS length | The logo's width (`"40cqw"`; a number = px). Without it the image keeps its size, capped at 70% of the stage's width and 34% of its height. |
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
browser's). The menu is hidden on the title and ending pages. The menu is built
from whatever `[menu]` / `[settings]` / `[strings]` say at the time — a
`loadConfig()` after `createEngine()` (the documented order) rebuilds it, so
items, labels and the entry position always match the config.

### `[settings]`

The settings panel and the players' defaults. Every value a player changes is
persisted per work and restored on the next visit.

| Key | Type | Effect |
|---|---|---|
| `autoDelay` | seconds | Auto mode's pause after each line (plus a little per character; never before a voice clip ends). Default 1.5. |
| `skipMode` | `read` (default) \| `all` | What skip passes: lines seen before (skip ends at the first unread one) or everything. Holding **Ctrl** skips while held. Both modes stop at a choice. |
| `show` | string[] | Rows in order: `textSpeed`, `autoDelay`, `skipMode`, `volumes` (music / ambience / SFX / voice), `language` (when the work ships more than one), `fullscreen`, `dialogOpacity`, `uiScale`. Default: all. |
| `textSpeedRange` | `[min, max]` cps | The text-speed slider: linear in characters per second from `min` to `max` (default `[10, 100]`); the notch past `max` is **instant** (`textSpeed = 0`). |

### `[keys]`

The keyboard. Every value is a `KeyboardEvent.key` name — `a`, `F5`, `Escape`,
`Space`, `Enter`, `Tab`, `Control` — optionally with `Ctrl+` / `Shift+` / `Alt+` /
`Meta+` in front (`Ctrl+S`), an array to bind several keys, or `false` to unbind.
Names compare case-insensitively.

| Action | Default | Does |
|---|---|---|
| `advance` | `["Space", "Enter"]` | Advance the story (ends auto / skip). |
| `menu` | `"Escape"` | Open / close the system menu (closes the topmost panel first). |
| `skipHold` | `"Control"` | Skip while held. |
| `skip` | `"Tab"` | Toggle skip mode. |
| `auto` | `"a"` | Toggle auto mode. |
| `quicksave` / `quickload` | `"F5"` / `"F9"` | The quick slot (a toast confirms). |
| `backlog`, `save`, `load`, `settings` | unbound | Open that panel. |
| `fullscreen` | unbound | Toggle fullscreen. |

`advance`, `menu` and `skipHold` always work. The others are the system menu's
own actions: they apply while the menu exists and the story is playing (a host
that draws its own chrome — `[menu] enabled = false`, `screens.menu = false` —
binds its own keys over the engine API). A bound key is consumed (`F5` does not
reload the page, `Tab` does not move focus), and every binding is ignored while
a text field has focus.

### `[ui.<id>]`

A panel the engine draws from data-bound widgets — no code. A `hud` is pinned
to an anchor; a `window` is a titled box in the middle.

```toml
[ui.affection]
kind = "hud"                          # hud | window
anchor = "top-right"                  # top-left | top | top-right | left | center | right | bottom-left | bottom | bottom-right
show = "playing"                      # playing (default) | always | manual
widgets = [
  { type = "bar",   var = "affection", max = 10, label = "@ui.affection" },
  { type = "text",  text = "@ui.day" },                       # the catalog text may carry {$day}
  { type = "text",  var = "mood" },                           # a variable's value
  { type = "image", src = "@ui/heart.png", if = "affection >= 5" },
]

[ui.status]
kind = "window"
title = "@ui.status"                  # also the label of a `ui:status` menu item / title button
show = "manual"                       # only after [ui show status]
width = "40cqw"
widgets = [
  { type = "list",   var = "items", empty = "@ui.noItems" },
  { type = "button", label = "@ui.close", onclick = "ui hide status" },
]
```

| Widget | Keys | Shows |
|---|---|---|
| `text` | `text` (`@key` / literal with `{$var}`), or `var` | A line of text. |
| `bar` | `var`, `max` (100), `min` (0), `label` | A progress bar; `max` / `min` may be numbers or expressions. |
| `image` | `src`, `width` | An image (`src` resolves like an asset path). |
| `list` | `var`, `empty` | One line per item of a list variable, or of a comma-separated string (so a string item cannot itself hold a comma — collect into a list variable for that); each string item is a config string (`@key` resolves through the catalogs, `{$var}` fills); `empty` (a config string) when there are none. |
| `button` | `label`, `onclick` | A button; `onclick` is script commands, one per line (a TOML multi-line string for several). |

Every widget takes `if` (an expression; false hides it). Panels re-render on
every variable change, language switch and session change. A `playing` panel
draws the moment play starts — before the script's first line — so a variable
it reads may not exist yet: it shows as empty (no diagnostic) until a `[set]`
gives it a value. Declare it in `[persist]` only when it really must survive
runs. `[ui show id]` /
`[ui hide id]` / `[ui toggle id]` override the `show` policy; the decisions ride
in a save. `[menu] items` and `[title] buttons` accept `ui:<id>` entries that
toggle a panel. Look: `hud-*`, `window-*` and `bar-*` theme tokens.

### `[preload]`

What `prepare()` warms before the title page (images decoded, everything else
fetched into the cache), with the built-in loading page up meanwhile. Failures
are diagnostics, never a stop.

```toml
[preload]
auto = true                      # what the loaded script references (in chunked play: the opening chunk and its successors)
assets = ["@ui/box.svg", "@bgm/daily.wav"]   # explicit refs (plugin commands' assets go here)
concurrency = 3                  # parallel fetches (default 4)
screen = true                    # the loading page (default true; a host can also pass screens.loading = false)
heading = "@ui.loading"          # its heading (default: the chrome's "Loading…", ui.loading.title)
background = "#000"              # a colour, gradient or image path
```

The page draws a bar over `progress-bg` / `progress-color`; plugins hear
`onPreload(done, total, ref)`. `[preload …]` in a script warms mid-story.

### `[choices]`

The choices prompt. Layout and behaviour keys are read directly; the look keys
map onto `choice-*` theme tokens (config.ts `choicesTheme`).

```toml
[choices]
position = "bottom"        # center | top | bottom (clear of the dialogue box) | left | right
layout = "grid"            # column | grid
columns = 2                # per row, for grid
width = "30cqw"            # choice-width (each button's minimum width)
gap = "2cqh"               # choices-gap
skin = "@ui/btn.png"       # choice-skin; with slice = 12 a nine-slice (choice-skin-slice)
slice = 12
chosenStyle = "dim"        # none | dim — options taken in an earlier run (sys.chosen)
timer = 8                  # seconds before the prompt picks timerDefault by itself
timerDefault = 1           # counted from 1 among the shown options (default: the first enabled one)
```

`[choices timer=15 default=2]` in the script overrides `timer` / `timerDefault`
for the **next prompt only** (`timer=0` = no countdown for that prompt); the
config values are the default for every other prompt.

| Key | Token |
|---|---|
| `skin` (+ `slice`, `sliceWidth`) | `choice-skin` / `choice-skin-slice`; a skin also clears `choice-bg` and `choice-border` unless they are given. |
| `background` / `border` / `radius` / `color` / `size` / `hover` | `choice-bg` / `choice-border` / `choice-radius` / `choice-color` / `choice-size` / `choice-hover` |
| `width` / `gap` | `choice-width` / `choices-gap` |
| `chosenBackground` / `chosenColor` | `choice-chosen-bg` / `choice-chosen-color` |
| `disabledBackground` / `disabledColor` | `choice-disabled-bg` / `choice-disabled-color` |
| `timerBackground` / `timerColor` | `choice-timer-bg` / `choice-timer-color` |

### `[persist]`

Persistent variables and their first-run defaults — the same declaration as the
`[persist]` command (see [script-syntax.md](script-syntax.md#persistent-variables)).
The store's value wins whenever there is one; the default seeds a first visit.

```toml
[persist]
player = ""
runs = 0
seen_intro = false
```

### `[input]`

The box the `[input]` command shows. The look keys map onto `input-*` theme
tokens (the box defaults to the panel look); `position` and the labels are read
directly.

```toml
[input]
skin = "@ui/box.png"       # image behind the box; with slice = 24, a nine-slice
slice = 24
sliceWidth = "3.2cqh"
position = "center"        # center | top | bottom
ok = "@ui.input.ok"        # button labels (@key or literal); default: the chrome's OK / Cancel
cancel = "@ui.input.cancel"
fieldSize = "3.4cqh"       # the text field: fieldBackground / fieldColor / fieldBorder / fieldRadius / fieldSize
```

| Key | Token |
|---|---|
| `skin` (+ `slice`, `sliceWidth`) | `input-box-skin` / `input-box-skin-slice`; a skin also clears `input-box-bg` and `input-box-border` unless they are given. |
| `background` / `border` / `radius` | `input-box-bg` / `input-box-border` / `input-box-radius` |
| `fieldBackground` / `fieldColor` / `fieldBorder` / `fieldRadius` / `fieldSize` | `input-bg` / `input-color` / `input-border` / `input-radius` / `input-size` |

### `[strings.<lang>]`

Chrome string overrides by language — every piece of text the engine's own
screens show, keyed by id. The engine ships `en` (base), `zh` and `ja`; an
override for the current language wins, then `en`, then the engine's catalog.
`{$var}` fills work in an override; `{ver}` / `{n}` are the engine's own slots.

```toml
[strings.en]
"ui.menu.toTitle" = "Leave the case"
"ui.msg.toTitleConfirm" = "Drop the case? Whatever you found stays found."
```

| Id | Engine's English |
|---|---|
| `ui.title.new` | New game |
| `ui.title.continue` | Continue |
| `ui.title.load` | Load |
| `ui.title.settings` | Settings |
| `ui.title.quit` | Quit |
| `ui.ending.title` | The End |
| `ui.ending.toTitle` | Back to title |
| `ui.ending.restart` | Play again |
| `ui.menu.title` | Menu (Esc) |
| `ui.menu.save` | Save |
| `ui.menu.load` | Load |
| `ui.menu.quicksave` | Quick save |
| `ui.menu.quickload` | Quick load |
| `ui.menu.backlog` | Backlog |
| `ui.menu.auto` | Auto |
| `ui.menu.skip` | Skip |
| `ui.menu.settings` | Settings |
| `ui.menu.replays` | Replays |
| `ui.menu.replayExit` | Back to story |
| `ui.menu.toTitle` | Title |
| `ui.menu.restart` | Restart |
| `ui.menu.close` | Close |
| `ui.menu.version` | NilVN Studio v{ver} |
| `ui.settings.textSpeed` | Text speed |
| `ui.settings.speed.cps` | {n} cps |
| `ui.settings.speed.instant` | Instant |
| `ui.settings.autoDelay` | Auto wait |
| `ui.settings.skipMode` | Skip |
| `ui.settings.skip.read` | Read text |
| `ui.settings.skip.all` | Everything |
| `ui.settings.vol.music` | Music |
| `ui.settings.vol.ambience` | Ambience |
| `ui.settings.vol.sfx` | SFX |
| `ui.settings.vol.voice` | Voice |
| `ui.settings.language` | Language |
| `ui.settings.fullscreen` | Fullscreen |
| `ui.settings.dialogOpacity` | Dialogue box |
| `ui.settings.uiScale` | Text size |
| `ui.settings.on` | On |
| `ui.settings.off` | Off |
| `ui.saves.autoSlot` | Auto |
| `ui.saves.quickSlot` | Quick |
| `ui.saves.empty` | Empty |
| `ui.saves.delete` | Delete |
| `ui.saves.msg.saved` | Saved |
| `ui.saves.msg.overwrite` | Overwrite this save? |
| `ui.saves.msg.delete` | Delete this save? |
| `ui.saves.msg.failed` | Save failed (storage full) |
| `ui.saves.msg.mismatch` | Save doesn't match this version |
| `ui.saves.msg.noQuick` | No quick save yet |
| `ui.backlog.empty` | No dialogue yet |
| `ui.backlog.playVoice` | Play voice |
| `ui.replays.locked` | Locked — reach this part of the story first |
| `ui.msg.restartConfirm` | Restart? Unsaved progress will be lost. |
| `ui.msg.toTitleConfirm` | Back to the title? Unsaved progress will be lost. |
| `ui.dialog.ok` | OK |
| `ui.dialog.cancel` | Cancel |
| `ui.loading.title` | Loading… |

(`CHROME_STRING_IDS`, exported by `@nilvn/engine`, is the same list at runtime.)

## Languages

The config file declares no languages: content catalogs are runtime data. Pass
them to `createEngine({ catalogs, lang, defaultLang, languages })`, or play a
[script package](script-package.md), which carries them. The repository's
`bundle.mjs` reads an optional `catalogs.json` next to the config and injects it
this way.

## Reading the config at runtime

`engine.config` holds the parsed file after `loadConfig`, for settings screens
that want the same values.
