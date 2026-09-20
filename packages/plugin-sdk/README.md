# @nilvn/plugin-sdk

Write plugins for the [NilVN](https://github.com/nilzx/nilvn-engine) visual-novel
engine. One import gives you the manifest types and validator, the extension-point
and permission catalogs, the runtime types for the plugin's code, two identity
helpers for editor completion, a starter package and the generated
machine-readable contract (`plugin-spec.json`).

```bash
pnpm add -D @nilvn/plugin-sdk
```

A plugin is **a manifest plus a module**. It never touches the engine or the DOM:
it declares the permissions it needs, the host grants capability objects for
exactly those, and everything the plugin registers is released when it is
deactivated — which is what lets a game enable, disable and hot-reload plugins
while it runs.

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
  "engine": ">=0.16 <1",                // engine compatibility range (optional)
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
| `permissions` | Capabilities requested from the catalog (below). |
| `activation` | `{ "engine": "eager" \| "onCommand" \| "manual" }` — activate on enable (default), at its first command, or only through the host's `enablePlugin` / `setPlugins`. |
| `reload` | `"hot"` (default) or `"restart"` when the plugin cannot be swapped live. |
| `entries` | Module paths relative to the manifest. No `engine` entry = a pure editor plugin (studio-side); no `editor` entry = runtime only. |
| `styles` | Stylesheets injected while active and removed on deactivate. |
| `messages` | `{ lang: { id: text } }` — the plugin's own UI strings, read through `ctx.t(id)`. |
| `authorUsage` | Lines telling an author (or an AI) how to use the plugin in a script. |
| `apiVersion` | Plugin contract version this manifest targets (current: 2). |

`contributes` also takes, since engine 0.15: `config` (plugin settings — `[plugins.<id>]`
in the work's config, `ctx.config` at runtime, `scope: "player"` rows in the game's
settings panel), `menuItems` / `titleItems` (entries in the in-game menu / on the
title page, wired with `ctx.screen`), `hud` (a corner widget) and `actorFields`
(fields an actor declaration carries for this plugin, read with `ctx.actorField`).
The generated `plugin-spec.json` documents each shape.

Validate before shipping:

```ts
import { validatePluginManifest } from '@nilvn/plugin-sdk'
import manifest from './plugin.json'

const { errors, warnings } = validatePluginManifest(manifest, { engineVersion: '0.14.0' })
```

### `engine.js`

```js
// Only when the plugin goes through a bundler: `definePlugin` is an identity
// helper for types and completion. A plugin the engine loads straight from
// `[use ./my-plugin/plugin.json]` is imported by the browser as-is, so it must
// contain no bare-specifier imports at all — export the plain object instead.
import { definePlugin } from '@nilvn/plugin-sdk'

export default definePlugin({
  id: 'com.example.neon',
  permissions: ['stage.write'],

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
| `permissions` | `Permission[]` | Authoritative only without a manifest (`[use ./x.js]`); must equal the manifest's when one exists. |
| `styles` | string | CSS injected while active. |
| `commands` | `{ [name]: (ctx: CommandContext) => void \| Promise<void> }` | Script commands. |
| `textEffects` | `{ [name]: (span: TextSpan, index, ctx: PluginContext) => void }` | Inline `{name:text}` effects. |
| `effects` | `{ [name]: { appliesToKinds: string[], apply(handle, params, ctx) } }` | Retargetable effects bound to object kinds; a command applies one with `ctx.plugin.stage.applyEffect(name, objId, params)`. Effects run with their owner's capabilities whichever plugin's command invokes them. |
| `objectKinds` | `ObjectKind[]` | New addressable stage-object kinds (`{ id, transformable, recordable? }`). |
| `hooks` | `EngineHooks` | `onReady(ctx)`, `onSessionChange(state, prev, ctx)`, `onLabel(label, ctx)`, `onDialogue`, `onDialogueDone`, `onReveal(char, index, speaker, ctx)`, `onChoices(items, handles, ctx)`, `onChoose(item, index, ctx)`, `onCommand(name, args, params, ctx)`, `onEnd(ctx)`, `onSaved(state, ctx)`, `onRestored(state, ctx)`, `onSettingsChange(key, value, ctx)`, `onVarChange(name, value, ctx)`, `onError(info, ctx)`. Every hook receives the plugin context last. |
| `activate(ctx)` | `void \| Promise<void>` | Once per activation (install, enable, reload). A throw or rejection isolates the plugin. |
| `deactivate(ctx)` | void | Before the host disposes everything registered through `ctx`. |
| `saveState(ctx)` / `restoreState(ctx, data)` | | The plugin's `SaveState.ext[id]` slice (needs `save.slice`). Keep it JSON-serializable. |
| `version`, `dependencies`, `activation`, `reload` | | Inline fallbacks for module-only plugins; a manifest wins. |

### `CommandContext`

What a command receives:

| Member | Description |
|---|---|
| `name`, `args`, `params`, `raw` | The parsed tag: positional arguments, named parameters, and the raw text inside the brackets (for free-form commands). |
| `str(keyOrIndex, default?)`, `num(keyOrIndex, default?)` | Argument accessors by position or by name. |
| `resolve(path)` | Resource path → URL (aliases, the asset table, the base URL). |
| `wait(sec)` | A delay that resolves early when the session resets. |
| `plugin` | The owning plugin's `PluginContext` — the only way to the stage, audio and variables. |

### `PluginContext`

Always present: `id`, `permissions` (the granted set), `lang`, `actors`,
`resolve(path)`, `t(id, params?)` (the plugin's own `messages`, then the engine's
chrome catalog), `report(message, error?)` (a diagnostic attributed to this
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
| `vars.read` / `vars.write` | `ctx.vars` | `get` `has` `all`; `set` needs `vars.write`. |
| `save.slice` | — | The module's `saveState` / `restoreState` are called. |
| `session.save` | `ctx.saves` | `saveState` `restoreState` `restart` `saveKey` `buildInfo`. |
| `session.settings` | `ctx.settings` | `textSpeed`, `getVolume` / `setVolume`, `lang` `languages` `setLanguage` `onLanguageChange`, `resolveText`. |
| `session.backlog` | `ctx.backlog` | `entries()` `replayVoice(ref, offset)`. |
| `session.replay` | `ctx.replay` | `list` `isReplaying` `play` `end` `fireSeen` `onSeen` `onEnd`. |
| `ui.layer` | `ctx.ui` | `layer(className)` — a host container inside the stage root; `onStage(type, fn)` for stage input. Both removed on dispose. |
| `ui.screen` | `ctx.screen` | `open(id, title, render)` / `close(id?)` — a full-stage screen in the engine's panel chrome (Esc closes); `menuItem(id, onSelect)` / `titleItem(id, onSelect)` wire `contributes.menuItems` / `titleItems`; `hud(id)` is the `contributes.hud` container. All released on dispose. |
| `ui.dialog` | `ctx.dialog` | `confirm(message)`, `alert(message)`, `toast(message)` — the engine's own boxes. |
| `storage.local` | `ctx.storage` | `get` `set` `remove` `keys` — a key-value store namespaced per work and plugin (async, JSON values). |
| `timer` | `ctx.timer` | `setTimeout` `setInterval` `requestAnimationFrame` and their clears, all cleared on dispose. |

Always on the context, no permission needed: `theme` (the work's theme tokens),
`config` (this plugin's settings) and `actorField(actorId, key)`.

Stage objects are addressed by id — `camera`, `screen`, `character:<actor>`,
`sprite:<id>`, `window:dialog` — and animated through the fixed transform schema
(`x`, `y`, `scale`, `rotation`, `opacity`, `visible`, `zIndex`). `animate(objId,
frames, { durationSec, easing, iterations, compose })` composes frames either
`absolute` (replace the resting value) or `offset` (a delta on top of it — a rumble
on a panned camera keeps the pan).

Permissions reserved for future hosts (`stage.layer:*`, `audio.bus:*`,
`audio.capture`, `fs.*`, `net:*`, `clipboard`, `ai.*`) validate but are not granted
by any host yet; the editor-side permissions (`project.*`, `assets.*`, `ui.panel`
/ `ui.window` / `ui.toast`) apply to a plugin's studio half.

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
and the object handle are proxyable objects). The one exception is `ui.layer`,
which hands a same-realm first-party plugin the element itself. This keeps a
future sandboxed (iframe or worker) host able to run the same plugins over an RPC
proxy.

## Exports

| Export | From | What for |
|---|---|---|
| `validatePluginManifest`, `manifestErrors`, `isPluginId`, `hasEngineHalf`, `hasEditorHalf`, `PLUGIN_API_VERSION`, `PLUGIN_MANIFEST_FILE`, `PLUGIN_ID_RE` | `@nilvn/core` | Check a manifest against the host's contract. |
| `EXTENSION_POINTS`, `PERMISSIONS`, `matchPermission` | `@nilvn/core` | The catalogs a manifest may contribute to and request from. |
| `FIRST_PARTY_ID_PREFIX`, `resolvePluginId`, `isFirstPartyId`, `pluginSlug`, `manifestCommandMap`, `commandRegistry` | `@nilvn/core` | The id conventions (`textfx` ↔ `app.nilvn.textfx`) and manifest-derived command registries. The first-party plugins themselves are [`@nilvn/plugins`](https://www.npmjs.com/package/@nilvn/plugins). |
| `parseSemVer`, `compareSemVer`, `isValidRange`, `satisfiesRange`, `FORMAT_VERSIONS`, `CURRENT_SCHEMA_VERSION` | `@nilvn/core` | Version helpers. |
| `EnginePlugin`, `EngineOptions`, `PluginContext`, `CommandContext`, `TextSpan`, `StageObjectHandle`, `EffectDef`, `ObjectKindDecl`, `StandardChannel`, `EngineHooks`, `EngineDiagnostic`, `SaveState`, `SavedLoop`, the keyframe and transform types, the capability interfaces… (types) | `@nilvn/engine` | Type the runtime half. Type-only, so this package loads without the engine. |
| `definePlugin`, `defineManifest` | this package | Identity helpers for inference and completion in JS and TS. |
| `buildPluginSpec`, `PLUGIN_SPEC_VERSION`, [`plugin-spec.json`](plugin-spec.json) | this package | The generated contract: manifest fields, catalogs, capability surfaces, lifecycle, proxy rules and a worked example. |
| [`template/`](template/) | this package | A copy-and-rename plugin package. |

`pnpm spec:gen` regenerates `plugin-spec.json` and the template from the source;
`pnpm spec:check` fails when they drift (CI and `prepack` run it).

MIT.
