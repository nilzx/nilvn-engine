# Engine API

```ts
import { createEngine } from '@nilvn/engine'

const engine = createEngine({ container: document.getElementById('app')! })
await engine.loadConfig('./nilvn.config.toml')
await engine.start()
```

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
| `assets` | `Record<string, string>` | Virtual asset table: resolved path → inline URL (data URIs). Single-file builds use it so nothing is fetched. |
| `onEnd` | `() => void` | The script finished (`[end]`, or it ran off the end). |
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
| `start(label?)` | Run from the top or from `label`. Activates queued plugins first. Resolves when the script finishes. |
| `jump(label)` | Move the playhead to a label (loads its chunk first in chunked play). |
| `restart()` | Fresh variables, blank stage, silence, then play from the beginning. |
| `finish()` | End the run now (`onEnd` fires). |
| `destroy()` | Stop everything, release listeners, timers, audio, plugins and the stage DOM. The instance is dead afterwards. |
| `wait(sec)` / `sleep(ms)` | Delays that resolve early if the session is reset. |
| `vars` | Script variables (`[set]` writes them; `[if]` and choice conditions read them). |
| `actors` | The actor table. |
| `textSpeed` | Typewriter speed; changing it applies mid-line. |
| `resolve(path)` | Resolve a resource path: aliases, then the asset table, then `baseUrl`. |
| `config` | The parsed config file, if one was loaded. |

The player advances a line with click, Space or Enter; a click during typing
reveals the rest of the line.

## Saving and restoring

```ts
const save = engine.saveState()          // SaveState, JSON-serializable
const ok = await engine.restoreState(save)
```

`SaveState` (`v: 2`) holds the playhead as a `{ label, offset }` address (stable
across re-exports that keep the labels), the variables, a stage snapshot, the text
speed, the language, the playing music and ambience tracks, and `ext` — one slice
per plugin that declared `save.slice`. `restoreState` returns `false` without
touching anything when the save is incompatible (wrong version, a label that no
longer exists, an out-of-range offset). A slice whose plugin is not active is
carried through to the next save untouched.

`saveKey` and `buildInfo` are the per-work id and tool version a persistence layer
(the `menu` plugin) uses to namespace and label saves.

## Languages

| Member | Description |
|---|---|
| `lang`, `defaultLang`, `languages` | Current content language, fallback, and the switchable set. |
| `catalogs` | Content text by language and key. |
| `resolveText(key)` | A key in the current language, then the default language, then `''`. |
| `setLanguage(lang)` | Switch content and chrome language and repaint the line or choices on screen in place; playback state is untouched. Ignored for a language with no catalog. Async, because chunked play may need to fetch that language's text slice first. |
| `onLanguageChange(fn)` | Subscribe to switches; returns an unsubscribe function. |

Chrome strings belong to the plugin that renders the chrome (a manifest's
`messages`, resolved by `ctx.t`); the engine ships none of its own. The lookup
mechanism — `tUI(id, params?, lang?)`, `setUILang(lang)`, `getUILang()` — and
`uiLangName(code)` (`ja` → 日本語, also `settings.languageName` on the plugin
context) are exported for hosts.

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
| `playTrack(track, url, { loop, volume, fade })` | Start or replace a named looping track. `Engine.MUSIC_TRACK` (`'music'`) is the BGM slot; other names are ambience beds layered under it. |
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
| `playReplay(segId)` | Play one segment as an isolated, clean-slate session. |
| `isReplaying()` | The segment id being replayed, or null. |
| `onSegmentSeen(fn)` | Subscribe to "normal play passed a segment's end" — the unlock signal. |
| `onReplayEnd` | Orchestrator callback when a replay reaches its end (the menu restores the interrupted session here). |

## Parsing and evaluation

| Export | Description |
|---|---|
| `parseScript(text)` | `{ nodes, labels, diagnostics }` — the node stream a script becomes. |
| `parseSegments(text)` | Inline markup → text / pause / break segments. |
| `parseTag(inner, line)` | One `[…]` tag → a node (macros expand through it). |
| `evalExpr(src, vars)` / `truthy(value)` | The `[set]` / `[if]` expression evaluator. |
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
