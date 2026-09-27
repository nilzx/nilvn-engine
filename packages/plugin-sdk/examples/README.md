# Example plugins

Two complete third-party plugin packages, written only against the public
contract (`../README.md`, `../plugin-spec.json` and the engine docs). Each
folder is what a work carries: a manifest, one self-contained engine module, a
stylesheet and the asset files the manifest lists.

```
examples/
  weather/        com.example.weather
    plugin.json  engine.js  main.css  assets/raindrop.svg  assets/snowflake.svg
  achievements/   com.example.achievements
    plugin.json  engine.js  main.css  assets/badge.svg
```

`engine.js` has no `import` at all. A carried plugin is imported from the URL
the package loader serves (a `blob:` or `data:` URL in the zip and single-file
forms), where a relative import cannot resolve. So each module inlines the few
lines of `perActivation` (from `@nilvn/plugin-sdk`) instead of importing it; a
plugin built with a bundler imports it. Permissions are declared in `plugin.json`
only; the modules do not repeat them.

## `weather`: rain and snow over the stage

| Shows | How |
|---|---|
| A command with a positional argument | `[weather rain\|snow\|clear intensity=0..1]`: `str(0)` for the kind, `numOpt('intensity')` for the optional override. |
| Drawing over the stage | `ui.layer`: `ctx.ui.layer('exw-layer', { over: 'scene' })` is a container above the picture and below the dialogue box; the host removes it on dispose. |
| Plugin assets | `assets/*.svg` are listed in the manifest and resolved with `ctx.asset(path)`. The SVG is used as a CSS mask, so the particle's shape comes from the file and its colour comes from the theme (`var(--nilvn-text)`). |
| Author and player settings | `contributes.config`: `intensity` (author default, 0–1) and `enabled` (`scope: "player"`, so it shows in the game's settings screen). `ctx.config.onChange` picks up a change made while playing. |
| A key binding | `contributes.keybindings` `toggle` (default `w`, while playing) → `ctx.input.on('toggle', …)` shows or hides the layer. The player can rebind it in the settings screen. |
| Script-readable state | `vars.write`: the plugin writes `kind` and `intensity` as its own variables. They are stored as `com.example.weather.kind` / `…intensity`; scripts may write the short `weather.` prefix while no other active plugin's id also ends in `weather`. |
| A versioned save slice | `save.slice` + `contributes.saveSlice.version: 2` = the module's `stateVersion`. `migrateState` upgrades a v1 slice (kind only) from plugin 1.0.x. |
| Per-activation state | `perActivation(() => ({ … }))`: one state object per activation, reached from `activate`, the command (`plugin`), the hook and the save-slice methods. |
| Cleanup | The layer, stylesheet, key handler, `onDispose` callbacks and the per-activation state are released by the host, so the module has no `deactivate`. |

A script branches on the weather through the short prefix (or the full one,
`com.example.weather.kind`, which always works):

```
[if weather.kind == 'rain' -> umbrella]
The sky is {$weather.kind} today.
```

The weather clears whenever a session starts or ends (new game, restart,
title, ending). A loaded save restores it from the slice.

## `achievements`: unlocks that outlive a playthrough

| Shows | How |
|---|---|
| Persistence across playthroughs | `storage.local`: the unlocked ids live under one key in `ctx.storage`, which is namespaced per work and plugin. It is not in a save, and a new game does not reset it. |
| A first-time notification | `ui.dialog`: `ctx.dialog.toast(…)` runs on the first unlock only. The player can turn toasts off with the `toasts` setting (`scope: "player"`). |
| A screen, a menu entry and a title entry | `ui.screen`: `contributes.menuItems` / `titleItems` are wired with `ctx.screen.menuItem` / `titleItem`, and both open `ctx.screen.open('list', title, render)`. Unlocked entries show `assets/badge.svg`. Locked entries use the `muted` / `disabled` theme tokens, so they follow the work's theme. |
| A key binding that works on the title page | `contributes.keybindings` `open` (default `k`, `when: "always"`). A binding meant for the title page only would check `ctx.session === 'title'` in its handler. |
| Localized names | `plugin.achievements.a.<id>` in the plugin's `messages`, with the id as the fallback. |
| An author-editable list | The `list` setting has `type: "list"`: an array of ids in the config file, an array from `ctx.config.get('list')`. An `[achieve]` for an id outside the list still unlocks and reports a diagnostic. |

Names for ids the plugin does not ship come from `plugin.achievements.a.<id>`
too. `ctx.t` reads the work's `[strings]` before the plugin's own messages, so a
work can add them (or rename the shipped ones) in its config:

```toml
[strings.en]
"plugin.achievements.a.secret_room" = "Behind the Bookcase"
```

## Using them from a script or config file

A work served from a folder loads the packages directly:

```
[use ./plugins/weather/plugin.json ./plugins/achievements/plugin.json]
```

Settings and keys go in `nilvn.config.toml`:

```toml
[plugins]
use = ["plugins/weather/plugin.json", "plugins/achievements/plugin.json"]

[plugins."com.example.weather"]
intensity = 0.8

[plugins."com.example.achievements"]
list = ["prologue", "first_choice", "true_end", "secret_room"]

[keys."com.example.weather"]   # move a plugin binding: plugin id → binding id
toggle = "Shift+W"
```

## Carrying them inside a script package

A work that carries a plugin plays anywhere, even when the host has never heard
of the plugin (see `packages/engine/docs/script-package.md` → *Carried plugins*).
Put each plugin under `plugins/<id>/`, list **every one of its files** in the
chunk manifest's asset table with `kind: "plugin"`, and name the manifest
through `entry`:

```
my-game/
  nilvn.json
  chunks/…
  plugins/com.example.weather/plugin.json
  plugins/com.example.weather/engine.js
  plugins/com.example.weather/main.css
  plugins/com.example.weather/assets/raindrop.svg
  plugins/com.example.weather/assets/snowflake.svg
  plugins/com.example.achievements/…
```

```jsonc
{
  "format": 1,
  "title": "Rainy Day",
  "plugins": [
    { "id": "com.example.weather",      "entry": "plugins/com.example.weather/plugin.json" },
    { "id": "com.example.achievements", "entry": "plugins/com.example.achievements/plugin.json" }
  ],
  "config": {
    "plugins": {
      "com.example.weather": { "intensity": 0.8 },
      "com.example.achievements": { "list": ["prologue", "first_choice", "true_end"] }
    }
  },
  "chunks": {
    // … entry, chunks, labelIndex, locales …
    "assets": {
      "plugins/com.example.weather/plugin.json":          { "url": "plugins/com.example.weather/plugin.json",          "bytes": 2900, "kind": "plugin" },
      "plugins/com.example.weather/engine.js":            { "url": "plugins/com.example.weather/engine.js",            "bytes": 5700, "kind": "plugin" },
      "plugins/com.example.weather/main.css":             { "url": "plugins/com.example.weather/main.css",             "bytes": 1500, "kind": "plugin" },
      "plugins/com.example.weather/assets/raindrop.svg":  { "url": "plugins/com.example.weather/assets/raindrop.svg",  "bytes": 410,  "kind": "plugin" },
      "plugins/com.example.weather/assets/snowflake.svg": { "url": "plugins/com.example.weather/assets/snowflake.svg", "bytes": 570,  "kind": "plugin" }
      // … the same rows for com.example.achievements
    }
  }
}
```

`packagePluginAssets(id, files)` from `@nilvn/core` builds the `plugins` entry
and these rows for you. The plugin gets the same permissions as one loaded with
`[use ./x/plugin.json]`, and `ctx.asset('assets/raindrop.svg')` resolves
through the package.

## A script using both

```
[label prologue]
[bg @bg/station.png fade=1]
[weather rain intensity=0.4]
|The last train is late again.
[achieve prologue]

[choice Wait under the awning -> wait]
[choice Walk home in the rain -> walk]

[label walk]
[weather rain intensity=1]
me: Might as well get properly soaked.
[achieve first_choice]
[jump dawn]

[label wait]
[if weather.kind == 'rain' -> still_raining]
[jump dawn]

[label still_raining]
|The rain keeps on. Somewhere past midnight it turns to snow.
[weather snow]
[achieve first_choice]

[label dawn]
[weather clear]
|Morning, finally.
[achieve true_end]
[ending true_end]
```
