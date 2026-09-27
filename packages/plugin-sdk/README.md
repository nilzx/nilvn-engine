# @nilvn/plugin-sdk

Write plugins for the [NilVN](https://github.com/nilzx/nilvn-engine) visual-novel
engine. One import gives you the manifest types and validator, the extension-point
and permission catalogs, the runtime types for the plugin's code, two identity
helpers for editor completion, a starter package and the generated
machine-readable contract (`plugin-spec.json`).

```bash
pnpm add -D @nilvn/plugin-sdk
```

A plugin is **a manifest plus a module**. It never reaches into the engine: it
declares the permissions it needs, the host grants capability objects for exactly
those, and the only DOM it touches is what the host hands it (a stage layer, a
screen body, a HUD corner). Everything the plugin registers is released when it
is deactivated — which is what lets a game enable, disable and hot-reload plugins
while it runs.

The shapes inside `contributes` (command params, config fields, key bindings, menu
entries …) are listed field by field in `plugin-spec.json` → `schemas`, with the
closed sets of param types and command categories. [`examples/`](examples/) holds
two complete third-party plugins (weather, achievements) and a script that packs
them into a playable work.

Features marked *(since x.y.z)* need at least that engine version; declare a
matching `engine` range. A feature marked `since: unreleased` is on `main` but
not yet in a published engine.

## A plugin package

```
my-plugin/
  plugin.json     the manifest
  engine.js       the runtime half (plain ESM, no build step needed)
  main.css        styles injected while the plugin is active (optional)
```

Load it from a script with `[use ./my-plugin/plugin.json]`, or from the host with
`createEngine({ registry: [module], manifests: [manifest] })` and `[use com.example.neon]`.
Copy [`template/`](template/) from this package to start; the first-party
plugins in [`@nilvn/plugins`](https://github.com/nilzx/nilvn-plugins) are worked
examples of every extension point, written against exactly this surface.

### `plugin.json`

```jsonc
{
  "id": "com.example.neon",             // reverse-DNS, stable; the key everywhere
  "name": "plugin.neon.name",           // an id resolved through "messages"
  "description": "plugin.neon.desc",
  "version": "1.0.0",
  "engine": ">=0.19 <1",                // engine compatibility range (optional)
  "entries": { "engine": "./engine.js" },
  "permissions": ["stage.write"],
  "contributes": {
    "textEffects": [{ "name": "neon", "label": "plugin.neon.te.neon.label" }],
    "commands": [{
      "name": "boom", "label": "plugin.neon.cmd.boom.label", "category": "fx",
      "params": [{ "key": "strength", "label": "plugin.neon.cmd.boom.strength", "type": "number", "default": 12 }]
    }]
  },
  "styles": ["./main.css"],
  "messages": {
    "en": { "plugin.neon.name": "Neon", "plugin.neon.desc": "A glowing text effect and a camera boom.",
            "plugin.neon.te.neon.label": "Neon", "plugin.neon.cmd.boom.label": "Boom", "plugin.neon.cmd.boom.strength": "Strength" },
    "zh": { "plugin.neon.name": "霓虹", "plugin.neon.desc": "发光文字特效与镜头震动。",
            "plugin.neon.te.neon.label": "霓虹", "plugin.neon.cmd.boom.label": "震动", "plugin.neon.cmd.boom.strength": "强度" }
  },
  "authorUsage": ["inline {neon:text} — glowing text", "[boom strength=12] — a short camera rumble"]
}
```

| Field | Meaning |
|---|---|
| `id` | Reverse-DNS id: `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`. Used by `[use]`, the enabled set, save slices and the i18n namespace. |
| `name`, `description` | Ids resolved through `messages` (so they localize). |
| `version` | The plugin's own SemVer. |
| `engine`, `editor` | Compatibility ranges: `*`, `1.2.3`, `^1.2`, `~1.2.3`, `>=0.14 <1`, `a \|\| b`. Absent = any. |
| `dependencies` | `{ id: range }` — other plugins activated first. Missing, incompatible or cyclic dependencies block the plugin with a diagnostic. |
| `contributes` | What the plugin adds, per extension point (below). The command schemas drive the studio's insert forms and the authoring linter; the module is still the executable truth. Unknown keys are ignored with a warning. |
| `permissions` | Capabilities requested from the catalog (below). The one place a plugin with a manifest declares them. |
| `activation` | `{ "engine": "eager" \| "onCommand" \| "manual" }` — activate on enable (default), at its first command, or only through the host's `enablePlugin` / `setPlugins`. |
| `reload` | `"hot"` (default) or `"restart"` when the plugin cannot be swapped live. |
| `entries` | Module paths relative to the manifest. No `engine` entry = a pure editor plugin (studio-side); no `editor` entry = runtime only. |
| `styles` | Stylesheets injected while active and removed on deactivate. |
| `assets` | *(since 0.19.0)* The plugin's own resource files, relative to the manifest (`sfx/click.ogg`; no `..`). The complete list an exporter copies with the plugin, and the only paths `ctx.asset(path)` resolves. |
| `messages` | `{ lang: { id: text } }` — the plugin's own UI strings, read through `ctx.t(id)`. |
| `authorUsage` | Lines telling an author (or an AI) how to use the plugin in a script. |
| `apiVersion` | Plugin contract version this manifest targets (current: 2). |

`contributes` also takes, since engine 0.15: `config` (plugin settings — `[plugins.<id>]`
in the work's config, `ctx.config` at runtime, `scope: "player"` rows in the game's
settings panel), `menuItems` / `titleItems` (entries in the in-game menu while
playing / on the title page, wired with `ctx.screen`), `hud` (a corner widget) and
`actorFields` (fields an actor declaration carries for this plugin, read with
`ctx.actorField`). A config field of type `list` *(since 0.19.0)* is a TOML array
(`items: "string" | "number"`), for the author only — it never shows in the
settings panel. A `menuItems` entry's old `when` field is ignored (a validator
warning): the system menu only opens while playing, and the title page has
`titleItems`. Where they sit is the work's call: `[menu] items` / `[title] buttons`
name an entry as `<plugin>:<item>` (your full id or its last segment) or mark a
`plugins` slot for the rest *(since 0.19.0)*.

It also takes `keybindings` *(since 0.19.0)* — `[{ id, default, label?, when? }]`, keys in the
engine's key table, handled with `ctx.input.on(id, fn)` (needs `input.keys`). The
default uses the `[keys]` format (`"w"`, `"Ctrl+S"`, a list, `false`); `when` is
`playing` (default) or `always` — a title-page-only key uses `always` and checks
`ctx.session === 'title'` in its handler. A default another binding already holds
stays unbound with a diagnostic; the author moves it with `[keys.<short name or id>]`
and the player can rebind every key in the game's settings screen.

`services` *(since 0.19.0)* — `[{ id, version }]` — declares services the plugin offers
other plugins (see *Services between plugins* below), and `themeTokens` *(since 0.19.0)* —
`[{ name, default, label? }]` — its own theme tokens: each name starts with the
plugin's short name and a dash (`weather-drop` for `com.example.weather`), the
default is one CSS value and may use other tokens (`var(--nilvn-accent)`).
While the plugin is active the default sits on the stage root as
`--nilvn-weather-drop`; a work sets it in `[theme]` or with `[theme weather-drop=…]`
exactly like an engine token, and your CSS reads `var(--nilvn-weather-drop)`.
The generated `plugin-spec.json` documents each shape.

Validate before shipping:

```ts
import { validatePluginManifest } from '@nilvn/plugin-sdk'
import manifest from './plugin.json'

const { errors, warnings } = validatePluginManifest(manifest, { engineVersion: '0.19.0' })
```

### `engine.js`

```js
// Only when the plugin goes through a bundler: `definePlugin` is an identity
// helper for types and completion. A plugin the engine loads straight from
// `[use ./my-plugin/plugin.json]` is imported by the browser as-is, so it must
// contain no bare-specifier imports at all — export the plain object instead.
import { definePlugin } from '@nilvn/plugin-sdk'

export default definePlugin({
  id: 'com.example.neon', // permissions are declared in plugin.json only

  // Inline text effect: {neon:text}. `span` is a sealed handle — addClass is the only verb;
  // the animation itself lives in main.css, keyed off the class.
  textEffects: {
    neon: (span, index, ctx) => span.addClass('fx-neon'),
  },

  // Script command: [boom strength=12]. No engine, no DOM — the stage comes through
  // ctx.plugin.stage, which exists because stage.write was declared and granted.
  commands: {
    async boom({ num, plugin }) {
      const frames = []
      for (let i = 0; i < 8; i++) frames.push({ x: (Math.random() - 0.5) * num('strength', 12), y: 0 })
      frames.push({ x: 0, y: 0 })
      await plugin.stage?.animate('camera', frames, { durationSec: 0.4, easing: 'linear', compose: 'offset' })
    },
  },

  activate(ctx) {
    // Anything acquired here goes through ctx so the host releases it on deactivate.
    ctx.listen(window, 'keydown', (e) => {})
    ctx.onDispose(() => {})
  },
})
```

Everything a module can contribute:

| Field | Signature | Notes |
|---|---|---|
| `id` | string | Must equal the manifest id. |
| `permissions` | `Permission[]` | Only for a module with no `plugin.json` (a bare `[use ./x.js]`, a host-registered module). With a manifest, leave it out: if both are given and differ, the manifest wins with a diagnostic. |
| `styles` | string | CSS injected while active. |
| `commands` | `{ [name]: (ctx: CommandContext) => void \| Promise<void> }` | Script commands. |
| `textEffects` | `{ [name]: (span: TextSpan, index, ctx: PluginContext) => void }` | Inline `{name:text}` effects. |
| `effects` | `{ [name]: { appliesToKinds: string[], apply(handle, params, ctx) } }` | Retargetable effects bound to object kinds; a command applies one with `ctx.plugin.stage.applyEffect(name, objId, params)`. Effects run with their owner's capabilities whichever plugin's command invokes them. |
| `objectKinds` | `ObjectKind[]` | New addressable stage-object kinds (`{ id, transformable, recordable? }`). |
| `hooks` | `EngineHooks` | `onReady(ctx)`, `onSessionChange(state, prev, ctx)`, `onLabel(label, ctx)`, `onDialogue`, `onDialogueDone`, `onReveal(char, index, speaker, ctx)`, `onChoices(items, handles, ctx)`, `onChoose(item, index, ctx)`, `onCommand(name, args, params, ctx)`, `onEnd(ctx)`, `onSaved(state, ctx)`, `onRestored(state, ctx)`, `onSettingsChange(key, value, ctx)`, `onVarChange(name, value, ctx)`, `onPreload(done, total, ref, ctx)`, `onError(info, ctx)`. Every hook receives the plugin context last. |
| `activate(ctx)` | `void \| Promise<void>` | Once per activation (install, enable, reload). A throw or rejection isolates the plugin. |
| `deactivate(ctx)` | void | Before the host disposes everything registered through `ctx`. |
| `saveState(ctx)` / `restoreState(ctx, data)` | | The plugin's `SaveState.ext[id]` slice (needs `save.slice`). Keep it JSON-serializable. `restoreState` always receives the current `stateVersion`'s shape. |
| `stateVersion` / `migrateState(data, from)` *(since 0.19.0)* | `number` / `unknown` | The slice's shape version (default 1; equal to the manifest's `contributes.saveSlice.version` when both are given). A slice saved at an older version goes through `migrateState` before `restoreState`; without it — or from a newer version — the slice is dropped with a diagnostic and the load continues. |
| `version`, `dependencies`, `activation`, `reload` | | Inline fallbacks for module-only plugins; a manifest wins. |

### `CommandContext`

What a command receives:

| Member | Description |
|---|---|
| `name`, `args`, `params`, `raw` | The parsed tag: positional arguments, named parameters, and the raw text inside the brackets (for free-form commands). A param the manifest declares `positional: 0` arrives in `args[0]` only — read it by index. |
| `str(keyOrIndex, default?)`, `num(keyOrIndex, default?)`, `numOpt(keyOrIndex)` | Argument accessors by position (a number) or by name (a string); `numOpt` gives `undefined` instead of a default when the value is absent or not a number. |
| `cond` | The tag's trailing `if=`: `true` when absent or holding. The command only sees `false` when its schema declares `ifFalse: 'handle'`. |
| `condExpr` *(since 0.19.0)* | For an `ifFalse: 'handle'` command, the `if=` expression as written (`undefined` otherwise). Pass it as `showSprite`'s `spec.if` and the engine keeps re-evaluating it: the sprite is drawn and clickable only while it holds — how `[sprite … onclick= if=!seen]` turns off after its own click. |
| `resolve(path)` | Resource path → URL (aliases, the asset table, the base URL). |
| `wait(sec)` | A delay that resolves early when the session resets. |
| `plugin` | The owning plugin's `PluginContext` — the only way to the stage, audio and variables. |

### `PluginContext`

Always present: `id`, `permissions` (the granted set), `lang`, `session` *(since 0.19.0)*
(where the session is: `idle` / `title` / `playing` / `ending`), `actors`,
`resolve(path)`, `asset(path)` *(since 0.19.0)* (one of the plugin's own files listed in the
manifest's `assets` → a URL, or `undefined` with a diagnostic), `t(id, params?)`
(the author's `[strings.<lang>]` first — so a work can rename your text — then the
plugin's own `messages` in the work language, then `en`, then the engine's chrome
catalog; an id found nowhere comes back unchanged; `{name}` placeholders are
filled from `params`), `report(message, error?)` (a diagnostic attributed to this
plugin — never throw over content), `listen(target, type, fn)`, `onDispose(fn)`,
and dynamic registration that is disposed with the plugin: `registerCommand`,
`registerTextEffect`, `registerEffect`, `registerKind`, `on(hook, fn)`,
`addStyle(css)`.

One capability object per **granted** permission; a permission that was not
granted leaves the property `undefined` (never an exception):

| Permission | Object | Surface |
|---|---|---|
| `stage.read` | `ctx.stage` | `hasObject` `getProp` `getBand` `getFace` `hasChar` `charFace` `snapshot`. With only `stage.read`, the write verbs below are stubs that report a diagnostic. |
| `stage.write` | `ctx.stage` | Reads plus every renderer write verb: `setBackground` `showChar` `moveChar` `hideChar` `clearChars` `focusChar` `showSprite` `hideSprite` `clearSprites` `setProp` `animate` `setBand` `setFace` `setName` `showDialog` `showIndicator` `setWindowSkin` `fadeScreen` `transitionScreen` `flash`, and `applyEffect` `showActor` `playFrames` `stopFrames` `startLoop` `stopLoop` `runningLoops`. |
| `audio.play` | `ctx.audio` | `playTrack` `stopTrack` `stopAllTracks` `playSe` `volume(channel)` `voicePlaying`. |
| `vars.read` / `vars.write` | `ctx.vars` | The plugin's own variables: `get` `has` `all` `set` take the bare key. They are stored under your full id (`namespace` *(since 0.19.0)*: `com.example.weather`, `-` → `_`); scripts may also use the short prefix (`weather.intensity`, see *Variables* below). `global(name)` *(since 0.19.0)* reads an author variable. `set` needs `vars.write`. |
| `save.slice` | — | The module's `saveState` / `restoreState` are called. |
| `session.save` | `ctx.saves` | `saveState` `restoreState` `restart` `saveKey` `buildInfo`. |
| `session.settings` | `ctx.settings` | `textSpeed`, `getVolume` / `setVolume`, `lang` `languages` `setLanguage` `onLanguageChange`, `resolveText`. |
| `session.backlog` | `ctx.backlog` | `entries()` `replayVoice(ref, offset)`. |
| `session.replay` | `ctx.replay` | `list` `isReplaying` `play` `end` `fireSeen` `onSeen` `onEnd`. |
| `ui.layer` | `ctx.ui` | `layer(className, { over })` (`over` *(since 0.19.0)*) — a new, unstyled container in the stage root (give it `position:absolute; inset:0; pointer-events:none` yourself). `over: 'scene'` puts it above the picture and below the dialogue box (weather, lighting); `'overlay'` (default) above the dialogue and choices, below the fade cover and the menu screens. Not moved by the camera. `onStage(type, fn)` listens on the stage surface. Both removed on dispose. |
| `ui.screen` | `ctx.screen` | `open(id, title, render)` — a full-stage screen in the engine's panel chrome: `title` is display text, `render(body, close)` runs once per open on an empty body; one plugin screen at a time (opening closes the system menu and any other screen); Esc or ✕ returns to the story; works from the title page. It returns a promise *(since 0.19.0)* that resolves when that screen closes, whichever way — a command can `await ctx.screen.open(…)` to hold the story until the player is done with a mini-game. `close(id?)` / `isOpen(id?)` *(since 0.19.0)* act on this plugin's screen. `menuItem(id, onSelect)` / `titleItem(id, onSelect)` wire `contributes.menuItems` / `titleItems` (the menu closes before `onSelect()`); `hud(id)` is the `contributes.hud` container (shown only while playing). All released on dispose. |
| `ui.dialog` | `ctx.dialog` | `confirm(message)`, `alert(message)`, `prompt(message, { default, maxlength, pattern, type, min, max, step, lines })` → the text or `null` (`type: 'number'` with `min` / `max` / `step`, and `lines` above 1 for a multi-line area, *(since 0.19.0)*), `toast(message)` — the engine's own boxes. Messages are display text (pass `ctx.t(…)`); toasts show briefly, the newest replacing the last, on any screen. |
| `storage.local` | `ctx.storage` | `get` (`undefined` for a missing key) `set` `remove` `keys` — a key-value store namespaced per work and plugin (async, JSON values). Independent of save slots: it survives new games and deleted saves — the place for unlocks and statistics. |
| `timer` | `ctx.timer` | `setTimeout` `setInterval` `requestAnimationFrame` and their clears, all cleared on dispose. |
| `input.keys` *(since 0.19.0)* | `ctx.input` | `on(id, fn)` — runs `fn` when a `contributes.keybindings` binding is pressed (auto-repeat excluded); released on dispose. `label(id)` — the key the binding has now, as the settings screen shows it (`F`, `Ctrl+S`; `''` when unbound), for hints that stay right after the player rebinds (`onSettingsChange('keys', …)` says when). |

Always on the context, no permission needed: `theme` (the work's theme tokens:
`get('accent')` — the name without the `--nilvn-` prefix — returns the work's
override or `undefined` at the default; `all()`; `onChange(fn)`), `config` (this
plugin's settings: `get(key)` is the player's value, else the author's, else the
schema default — `undefined` for an undeclared key; `onChange((key, value) => …)`
returns an unsubscribe and is released on dispose anyway; a `list` field comes
back as an array), `actorField(actorId, key)` and `services` *(since 0.19.0)*.

Plugin CSS draws with the theme's custom properties, never colour literals:
`var(--nilvn-text)`, `var(--nilvn-accent)`, `var(--nilvn-panel-bg)` …, and for
secondary or unavailable things `var(--nilvn-muted)` / `var(--nilvn-disabled)`
*(since 0.19.0)* (both derived from `text`). The engine's public API docs list every token
with its default.

### Services between plugins *(since 0.19.0)*

A plugin can offer a service — a named set of functions — to other plugins.
Declare it in `contributes.services` with its own version, then provide it in
`activate`:

```js
// com.example.gallery — "services": [{ "id": "cg", "version": "1.0.0" }]
activate(ctx) {
  ctx.services.provide('cg', {
    unlock: (id) => unlocked.add(id),
    list: () => [...unlocked],
  })
}
```

A consumer lists the provider in `dependencies` (so it activates first) and asks
for the service, optionally with a range for the service version:

```js
// "dependencies": { "com.example.gallery": "^1.0.0" }
const cg = ctx.services.get('com.example.gallery', 'cg', '^1')
if (cg) await cg.unlock('sunset')
```

Every method returns a promise, and arguments and results are structured-cloned
both ways — pass data, never functions, DOM nodes or class instances with
behaviour. That makes a service sandbox-ready as it is. `get` returns
`undefined` when the provider is inactive, has not provided the service or does
not match the range (the last with a diagnostic, as is a provider missing from
`dependencies`). The stub stays bound to the provider: after a reload it reaches
the new implementation, and after the provider is disabled its calls reject.
`provide` returns a function that withdraws the service early; it is withdrawn
with the plugin anyway.

Stage objects are addressed by id — `camera`, `screen`, `character:<actor>`,
`sprite:<id>`, `window:dialog` — and animated through the fixed transform schema
(`x`, `y`, `scale`, `rotation`, `opacity`, `visible`, `zIndex`). `animate(objId,
frames, { durationSec, easing, iterations, compose })` composes frames either
`absolute` (replace the resting value) or `offset` (a delta on top of it — a rumble
on a panned camera keeps the pan).

A new kind from `objectKinds` declares a contract — the channels the studio
records and the kinds an effect may target. The stage creates objects only for
the built-in kinds and for `sprite` (through `showSprite`), so a plugin kind has
no instances of its own yet; a plugin that draws its own things uses `ui.layer`
or a `sprite`.

### Signatures *(since 0.19.0)*

<!-- signatures:start — generated from src/spec.ts by scripts/gen-spec.ts (pnpm spec:gen) -->
The capability objects' calls, as the engine's type declarations define them
(`@nilvn/engine` ships the `.d.ts`). Every write verb that returns a promise resolves when its fade or animation ends; a verb called with arguments it cannot use reports a diagnostic against your plugin and does nothing — it never throws back into your code.

| Call | Notes |
|---|---|
| `setBackground({ url?, color?, ref? }, fadeSec = 0)` | `url` resolved (`ctx.resolve` / `ctx.asset`); `ref` = the unresolved path a save should keep. |
| `showChar(id, url, { at?, fade?, face?, ref?, y?, scale?, rotation? })` / `showActor(id, face?, { at?, fade?, src?, y?, scale?, rotation? })` | `showChar` shows a raw image as character `id`; prefer `showActor`, which goes through the actor table like `[char]`. |
| `moveChar(id, at, timeSec = 0.45)` / `hideChar(id, fadeSec = 0.3)` / `clearChars(fadeSec = 0.3)` / `focusChar(speaker \| null)` | `at` is `left` / `center` / `right` or a percentage. |
| `showSprite(id, spec, fadeSec = 0.3)` | `spec`: `{ url, ref?, frames, fps, loop, at?, height?, y?, scale?, rotation?, onclick?, if? }` — `url` is the resolved single-row sheet, `frames` / `fps` its frame count and rate, `loop` must be given (`[sprite]` defaults it to true, the call does not), `height` a percentage of the stage height (default 30), `onclick` script commands, `if` a live condition (see `condExpr`). The object is `sprite:<id>`. |
| `hideSprite(id, fadeSec = 0.3)` / `clearSprites(fadeSec = 0)` |  |
| `getProp(objId, prop)` / `setProp(objId, prop, value)` | `prop` is one of `x` `y` (pixels, or `"12%"` of the object's own box) `scale` `rotation` (degrees) `opacity` `visible` `zIndex`, and on the camera `hue` `invert` `saturate` `brightness` `contrast` `grayscale`. |
| `animate(objId, frames, { durationSec, easing?, iterations?, compose?, key?, commit? })` | `frames`: an array of partial transforms, each with an optional `offset` (0..1) and `easing`; `compose: 'offset'` adds to the resting value instead of replacing it. Resolves at the end, or when stopped. The resting value is untouched — `get` reads the value before, and the object returns to it — unless `commit: true` (an `absolute`, finite animation), which makes the last frame the resting pose that `get` reads and a save keeps. `key` names the animation on its object: a second one with the same key replaces the first, so re-applying an effect never stacks. `key` and `commit` *(since 0.19.0)*. |
| `stopAnimations(objId, key?)` | Stops what `animate` started on the object — all, or the one with `key` — and the object returns to its resting pose; an `iterations: Infinity` animation runs until then. Show / hide fades and keyframe loops are not touched. An animation is not part of a save: a loop that must survive one is `startLoop`. *(since 0.19.0)* |
| `getBand(objId)` / `setBand(objId, 'world' \| 'front' \| 'back')` / `getFace(objId)` / `setFace(objId, face)` |  |
| `setName(name?, color?, textColor?)` / `showDialog(show)` / `showIndicator(on)` / `setWindowSkin(objId, url?, ref?)` | The dialogue box. |
| `fadeScreen(to, sec, color = '#000')` / `transitionScreen(to, sec, { shape?, dir?, color?, mask?, softness? })` / `flash(color, durationSec)` | Full-screen covers: `to` 1 = covered, 0 = clear. |
| `applyEffect(name, objId, params)` | Runs a registered effect on an object; `params` is a `Record<string, string>`. |
| `playFrames(durationSec, tracks)` / `stopFrames()` / `startLoop(objId, durationSec, entry, body, intoEase?, bridge?)` / `stopLoop(objId, exit, outEase?)` / `runningLoops()` | Keyframe playback; `tracks` / `entry` / `body` / `exit` take the keyframe wire strings or decoded objects. |
| `hasObject(objId)` / `hasChar(id)` / `charFace(id)` / `snapshot()` | Reads (`stage.read`). |

An effect's `apply(handle, params, ctx)` receives a handle bound to one object: `id`, `kind`, `get(prop)`, `set(prop, value)`, `animate(frames, opts)`, `stopAnimations(key?)`, `getBand()`, `setBand(band)`, `getFace()`, `setFace(face)`. `id` is the full object id (`character:yuki`), `kind` its kind (`character`); the rest are the stage verbs above without the `objId`, and nothing else.

Hooks receive their arguments and then your context last:

| Hook | Arguments |
|---|---|
| `onReady` / `onEnd` | — |
| `onSessionChange` | `state`, `prev` (`idle` / `title` / `playing` / `ending`) |
| `onLabel` | `label` |
| `onDialogue` / `onDialogueDone` | `node`: `{ speaker?, face?, segments, textKey?, line }` |
| `onReveal` | `char`, `index` (within the line), `speaker` |
| `onChoices` | `items` (`{ text, textKey?, target, cond?, disabled? }[]`, the shown ones), `handles` (`ChoiceHandle[]`: `index`, `addClass(name)`, `setVar(name, value)`) |
| `onChoose` | `item`, `index` |
| `onCommand` | `name`, `args`, `params` |
| `onSaved` / `onRestored` | `state` (the `SaveState`) |
| `onSettingsChange` | `key`, `value` |
| `onVarChange` | `name` (the full name), `value` |
| `onPreload` | `done`, `total`, `ref` |
| `onError` | `info` (an `EngineDiagnostic`: `phase`, `message`, `line?`, `plugin?`) |
<!-- signatures:end -->

Permissions reserved for future hosts (`stage.layer:*`, `audio.bus:*`,
`audio.capture`, `fs.*`, `net:*`, `clipboard`, `ai.*`) validate but are not granted
by any host yet; the editor-side permissions (`project.*`, `assets.*`, `ui.panel`
/ `ui.window` / `ui.toast`) apply to a plugin's studio half.

## Writing the runtime half

- **Per-activation state.** The object `activate(ctx)` receives is the same one
  every other entry point gets for that activation: `CommandContext.plugin`, the
  last argument of every hook, text effect and effect, and `saveState` /
  `restoreState`. `perActivation(init)` *(since 0.19.0)* keys state by it — created on first
  use, dropped when the plugin is released:

  ```js
  const state = perActivation(() => ({ kind: 'clear', layer: null }))
  // activate(ctx)           → state(ctx).layer = ctx.ui?.layer('rain') ?? null
  // weather({ str, plugin }) → state(plugin).kind = str(0, 'clear')
  ```

  A module the engine imports without a bundler cannot import it; copy its eight
  lines (a `WeakMap` plus `ctx.onDispose`) as the [examples](examples/) do. Or
  register inside `activate` with closures — `ctx.registerCommand(name, fn)`,
  `ctx.on(hook, fn)` (returns an unsubscribe), `ctx.addStyle(css)`,
  `ctx.registerTextEffect(name, fn)`, `ctx.registerEffect(name, def)`,
  `ctx.registerKind(decl)` — all released on deactivate. A new activation (enable,
  reload) gets a new object.
- **`activate` may be async**; the engine waits for it before the title page and
  the first line, so a title item registered there is on the page.
- **Session entries.** *(since 0.19.0)* `onSessionChange(state, prev)` fires on every move between
  `idle` / `title` / `playing` / `ending` *and* on every entry into play — new game,
  `restart()`, loading a save, a replay — even from `playing` to `playing`. Reset
  whatever you draw yourself there. On a load the order is `onSessionChange` →
  your `restoreState(ctx, data)` → `onRestored`.
- **Save slices.** `saveState` returning `undefined` stores nothing;
  `restoreState` runs only when the save holds your slice, and always receives the
  current `stateVersion`'s shape. `migrateState(data, from)` is called once with
  the stored version and must return the current shape (step through several
  versions yourself); it has no context. `contributes.saveSlice.version` and the
  module's `stateVersion` must agree.
- **Variables.** *(since 0.19.0)* Your variables are session variables stored under your full
  id: `com.example.weather.kind` (`-` → `_`; `ctx.vars.namespace` is the prefix).
  They are saved with the game and cleared by a new game or a restart. Scripts
  may use that full name, which always works, or the short one — your id's last
  segment, `weather.kind` — while no other active plugin's id ends the same way
  and the segment is not the engine's `sys`. When two active plugins share a last
  segment, **both** lose the short name and each reports a diagnostic naming its
  full prefix, whatever order they were enabled in. Scripts read and may write
  them (`[set weather.kind = 'rain']`); an author makes one persistent with
  `[persist weather.best = 0]`. `vars.write` includes the read verbs.
- **Your files.** `assets` lists resource files only (not `plugin.json`, the
  module or the stylesheets); `./` and a bare path are the same path. A
  stylesheet's `url(…)` resolves against the page, not the plugin, so pass
  `ctx.asset(path)` URLs in through CSS custom properties
  (`el.style.setProperty('--my-shape', 'url("' + url + '")')`).
- **Sizes.** The stage root is a size container: `cqw` / `cqh` are stage-relative
  in anything under it (layers, screens, HUD corners).
- **Text effects.** Each revealed character is a `.nilvn-ch` span that gains
  `.on` when it appears and carries `--i` (its index) — key your CSS off
  `.nilvn-ch.<your-class>.on` and stagger with `var(--i)`.
- **Permissions.** Declare them in `plugin.json` only. A module's own
  `permissions` field is for modules loaded without a manifest; given both, the
  engine-side sets must match (order does not matter) or the manifest wins with a
  diagnostic. `contributes.hooks` is introspection for tools — the module's
  `hooks` are what run.
- **Names in the work's config.** `[plugins."<id>"]` (settings) and
  `[keys."<id>"]` (key defaults, `[keys."com.example.weather"] toggle = "r"`) take
  your full id; only first-party `app.nilvn.*` plugins also answer to a short
  name. A plugin the work carries *(since 0.19.0)* is listed in `nilvn.json` `plugins` and needs
  no `use` entry; a `use` entry names a host-registered id, a `plugin.json` path
  or a module path.

## Lifecycle

```
register → validate (id · apiVersion · engine range · dependencies · permissions)
        → activate(ctx) → running → deactivate(ctx) → dispose
```

- Every contribution and every resource registered through `ctx` is released on
  deactivate. A plugin must not hold globals.
- `activate` may be async; a throw or rejection isolates the plugin (its commands
  become no-ops, one diagnostic). Three consecutive command failures (the host's
  `pluginFailureLimit`) isolate it too; one success resets the count.
- Hot reload: the save slice is taken, the plugin deactivated, a path plugin
  re-imported cache-busted, then activated and its slice restored. Any failure
  rolls back to the previous module.
- A finished game never swaps its command set mid-run; the studio toggles plugins
  in edit mode and rebuilds its preview.

## Proxy-safe by design

Capability methods are async or pure, with structured-cloneable parameters and
return values, and no DOM handles cross the boundary (`TextSpan`, `ChoiceHandle`
and the object handle are proxyable objects). This keeps a future sandboxed
(iframe or worker) host able to run the same plugins over an RPC proxy.

Every context member has been audited against that goal. Most cross unchanged:
async and fire-and-forget calls are forwarded, callbacks (hooks, commands,
subscriptions, timers) stay inside the sandbox and are invoked by message, and
synchronous reads of slow-changing data (`vars`, `theme`, `config`, `lang`,
`session`, `actors`, `resolve`, `asset`, `t`, volumes) are served from a
host-pushed mirror, and `services` calls are already async and cloned.
Two groups differ:

- **Synchronous reads of live state become async in a sandbox**: the `stage`
  reads (`hasObject` `getProp` `getBand` `getFace` `hasChar` `charFace`
  `snapshot` `runningLoops`), `saves.saveState()`, `settings.resolveText()` and
  `backlog.entries()` will return promises there.
- **Same-realm only**: `ctx.listen`, `ui.layer` / `ui.onStage`, the `HTMLElement`
  that `screen.open`'s `render` receives and `screen.hud` returns, custom
  `RecordableProp` descriptors on an object kind (standard channel names are
  fine), and `showChar`'s `faceUrl` function (use `showActor`). They keep working
  wherever a plugin runs in the page; a sandboxed host will offer declarative
  equivalents instead.

A plugin that wants to stay sandbox-ready avoids the second group or keeps it
behind a small adapter.

## Exports

| Export | From | What for |
|---|---|---|
| `validatePluginManifest`, `manifestErrors`, `isPluginId`, `hasEngineHalf`, `hasEditorHalf`, `PLUGIN_API_VERSION`, `PLUGIN_MANIFEST_FILE`, `PLUGIN_ID_RE` | `@nilvn/core` | Check a manifest against the host's contract. |
| `EXTENSION_POINTS`, `PERMISSIONS`, `matchPermission` | `@nilvn/core` | The catalogs a manifest may contribute to and request from. |
| `FIRST_PARTY_ID_PREFIX`, `resolvePluginId`, `isFirstPartyId`, `pluginSlug`, `manifestCommandMap`, `commandRegistry` | `@nilvn/core` | The id conventions (`textfx` ↔ `app.nilvn.textfx`) and manifest-derived command registries. The first-party plugins themselves are [`@nilvn/plugins`](https://www.npmjs.com/package/@nilvn/plugins). |
| `parseSemVer`, `compareSemVer`, `isValidRange`, `satisfiesRange`, `FORMAT_VERSIONS`, `CURRENT_SCHEMA_VERSION` | `@nilvn/core` | Version helpers. |
| `EnginePlugin`, `EngineOptions`, `PluginContext`, `CommandContext`, `TextSpan`, `StageObjectHandle`, `EffectDef`, `ObjectKindDecl`, `StandardChannel`, `EngineHooks`, `EngineDiagnostic`, `SaveState`, `SavedLoop`, the keyframe and transform types, the capability interfaces… (types) | `@nilvn/engine` | Type the runtime half. Type-only, so this package loads without the engine. |
| `definePlugin`, `defineManifest` | this package | Identity helpers for inference and completion in JS and TS. |
| `perActivation` *(since 0.19.0)* | this package | Per-activation state keyed by the plugin context (see *Writing the runtime half*). |
| `buildPluginSpec`, `PLUGIN_SPEC_VERSION`, [`plugin-spec.json`](plugin-spec.json) | this package | The generated contract: manifest fields, catalogs, capability surfaces, lifecycle, proxy rules and a worked example. |
| [`template/`](template/) | this package | A copy-and-rename plugin package. |

`pnpm spec:gen` regenerates `plugin-spec.json` and the template from the source;
`pnpm spec:check` fails when they drift (CI and `prepack` run it).

MIT.
