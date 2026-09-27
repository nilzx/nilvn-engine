# Script packages (`nilvn.json`)

A **script package** is a self-contained, playable work: one `nilvn.json`
manifest next to the script chunks, per-language text slices and asset files it
indexes. It is what NilVN Studio exports and what `Engine.load()` plays. The same
package exists in three physical forms, all behind one loader interface:

| Form | How it is served | Loader |
|---|---|---|
| Directory | Static hosting, or a ZIP the author unpacked | `WebContentLoader` (fetches files relative to the manifest) |
| ZIP bytes | One file handed to the page (`Uint8Array` / `ArrayBuffer` / `Blob`) | `ZipContentLoader` (reads the archive in memory; assets become `blob:` URLs) |
| Inline | The single-file HTML export: a JS object with every file's text and data-URI assets | `InlineContentLoader` |

```ts
await engine.load('./my-game/')                 // directory (or './my-game/nilvn.json')
await engine.load(await file.arrayBuffer())     // zip bytes
await engine.load(inlinePackage(payload))       // the single-file export's payload
```

`load()` rejects only for what the host must handle itself: an unreachable URL, or
a file that is not a package this engine plays (`PackageFormatError`, with a
message that names the mismatch). Problems inside a package — a missing chunk, a
bad line, an unknown plugin — surface as diagnostics during play, never as
exceptions.

## Packing a config-driven work: `nilvn pack`

A hand-written work — `nilvn.config.toml`, its `.nvn` files, assets and the
plugins it carries — becomes a package with the `nilvn` command that ships in
`@nilvn/engine` *(since 0.19.0)*:

```bash
npx nilvn pack public            # the folder holding nilvn.config.toml (or the file itself)
```

```
✓ The Lighthouse: 3 script files, 42 assets, 5 plugins (1 carried)
  engine: node_modules/@nilvn/plugins/dist/nilvn.iife.js
  → dist-pack/the-lighthouse/  (47 files — serve over http)
  → dist-pack/the-lighthouse.nvs  (2.1 MB)
  → dist-pack/the-lighthouse.html  (3.4 MB — double-click to play)
```

| Form | What it is |
|---|---|
| `<name>/` | The directory package with an `index.html` and the engine script (`nilvn.js`) beside `nilvn.json` — upload it to any static host. |
| `<name>.nvs` | The same package as one zip, for `engine.load(bytes)` or a player. |
| `<name>.html` | One self-contained file: engine, package and assets (as data URIs). Opens from disk. |

The two pages start on the title page and take `?lang=xx` to open in another of
the work's languages. The engine script defines the global `ADV` (the engine's
exports; `ADV.createEngine` carries the first-party plugins when the script is
`@nilvn/plugins/iife`), and each page keeps its engine in `window.engine` — handy
for a test that drives the page.

| Option | |
|---|---|
| `-o, --out <dir>` | Where to write (default `dist-pack`). |
| `-f, --form <list>` | `dir`, `zip`, `html`, comma-separated (default all three). |
| `-n, --name <name>` | The file / folder name. Default: the title's Latin letters and digits, lowercased and dashed (`The Lighthouse` → `the-lighthouse`), or `game` for a title without any. |
| `--engine <file>` | The engine script the pages ship. Default: `@nilvn/plugins/iife` when it is installed (it carries the first-party plugins), else `@nilvn/engine`'s own — which is refused for a work that uses a first-party plugin. |
| `--catalogs <file>` | Content catalogs, `{ "<lang>": { "<key>": "<text>" } }`. Default: `catalogs.json` beside the config, when there is one. |
| `--save-key <key>` | Namespaces the player's saves and settings (default: the title, lowercased and dashed — non-Latin letters kept). |
| `--exclude <path>` | Leave the files under a folder-relative path out (repeatable). |
| `--check` | Report problems only; write nothing. Names the engine script packing would ship, with its build time. |
| `--strict` | Treat warnings as errors (exit code 1). |

What goes where:

| In the work | In the package |
|---|---|
| `[game] scripts` / `entry` | One chunk per file (`chunks/scene/<file stem>.json`) with the rules of [several files](script-syntax.md#several-files): labels global, a file's stem names its first line, files fall through in list order, the last one ends the story. `[include]` lines are spliced in. |
| `[game] title`, `lang`, `defaultLang`, `textSpeed` | `title`, `lang` (default `en`), `languages` (with every language `--catalogs` fills), `textSpeed` (default 40). |
| `[actors.<id>]` | `actors`, with `face` written as `defaultFace`. |
| `[plugins] use` | `plugins`. A first-party short name becomes its id (`textfx` → `app.nilvn.textfx`); a `…/plugin.json` and the files it lists are carried under `plugins/<id>/`; a bare module (`plugins/glitch.js`) is carried with a `plugin.json` generated from its default export's `id`, `permissions` and `version`. |
| `[path]` and every other section | `config`, unchanged — `@bg/sea.svg` in a script keeps resolving through `[path]` onto the asset table. |
| Every other file of the folder | The asset table (`chunks.assets`), by its path in the folder. Dot-files, `node_modules`, the output folder, `.ts` / `.html` / `.md` files and project files (`package.json`, lockfiles, `tsconfig*.json`, `vite.config.*`) are skipped. |
| `catalogs.json` | One always-warm text slice per language (`chunks/locale/<lang>/base.json`). |

Packing reports what would otherwise surface only in play. **Errors** (nothing
is written, exit code 1): a script, a carried plugin or one of its listed files
missing, an invalid plugin manifest, a bare module whose default export has no
`id`. **Warnings**: a script line the parser rejects, a config key the schema
does not know, an asset a command or the config names that is not in the folder,
an unknown `@alias`, a `[use …]` line that names a plugin by path (the package
cannot carry it — list it in `[plugins] use`), a carried engine module with
relative imports (it must be one self-contained ES module).

The planning is a function, for build tools of your own:

```ts
import { packWork, inlinePayload } from '@nilvn/engine/pack'

const { manifest, files, textFiles, problems } = await packWork({
  config,                                   // the parsed nilvn.config.toml
  files: ['story.nvn', 'assets/bg/sea.svg'], // the folder's files, relative to the config
  read: async (path) => bytesOf(path),      // Uint8Array | undefined
  catalogs,                                 // optional
  describeModule: async (path) => ({ id, permissions }), // optional: bare plugin modules
})
// files: every package file by path (nilvn.json included) — write them out, or zip them
// inlinePayload({ manifest, files, textFiles, problems }, toBase64) → the single-file payload
```

It never throws over content and runs no code of the work (`describeModule` is
how a caller that can import a bare plugin module says what it is). `mimeOf(path)`
and `slugify(title)` are exported beside it.

## `nilvn.json`

```jsonc
{
  "format": 1,                         // package format version
  "title": "Secret Base",
  "engine": "0.14.0",                  // producer version, for traceability only
  "lang": "zh",                        // initial content language
  "languages": ["zh", "en", "ja"],     // languages the in-game switcher offers
  "actors": {
    "yuki": { "name": "Yuki", "nameKey": "actor.yuki", "color": "#ff7eb6",
              "sprites": "assets/char/yuki-{face}.svg", "defaultFace": "happy",
              "ext": { "app.nilvn.voicefx": { "voice": 360 } } },
    "mira": { "name": "Mira", "canvas": [600, 1100],
              "layers": { "body": { "src": "assets/char/mira/body-{body}.png", "default": "uniform" },
                          "face": { "src": "assets/char/mira/face-{face}.png", "default": "calm", "offset": [150, 280] } } }
  },
  "plugins": [                         // enabled plugins, auto-loaded at start
    { "id": "app.nilvn.textfx" },
    { "id": "com.example.neon", "entry": "plugins/com.example.neon/plugin.json" }   // carried inside the package
  ],
  "textSpeed": 40,
  "saveKey": "secret-base",            // namespaces saves / settings in the player's storage
  "config": { "title": { "heading": "Secret Base" } },   // optional: nilvn.config.toml as JSON (0.17+)
  "chunks": { /* the chunk manifest, below */ }
}
```

| Field | Meaning |
|---|---|
| `format` | Must equal the engine's `PACKAGE_FORMAT` (currently 1). |
| `title` | Window / document title. |
| `engine` | The tool version that produced the package. Compatibility is decided by the format numbers, not by this. |
| `lang`, `languages` | Initial language and the switchable set (the default first). |
| `actors` | The actor table (`PackageActor`), the same shape as the engine's `ActorDef`: display `name`, optional `nameKey`, name-tag `color` / `textColor`, the sprite template and default face — or a layered sprite (`canvas` + `layers`, each `{ src, default?, offset?, optional? }`) — and `ext`, the plugin actor fields by plugin id (`ext["app.nilvn.voicefx"].voice` is the typing-blip pitch; a top-level key that an active plugin declares is moved there). |
| `plugins` | Enabled plugins by id. `entry` points at a `plugin.json` inside the package for a plugin the work carries with it — see [Carried plugins](#carried-plugins). |
| `textSpeed` | Typewriter speed. |
| `saveKey` | Per-work id the in-game menu namespaces `localStorage` by. |
| `config` | Optional (0.17+). The work's configuration — [nilvn.config.toml](config.md) as JSON, section by section (`title`, `ending`, `theme`, `window`, `menu`, `settings`, `keys`, `saves`, `choices`, `input`, `preload`, `ui`, `persist`, `strings`, `plugins.<id>` …). Applied once the package is open and its asset table is filled, so a skin, logo or background in it resolves by ref like any other asset; checked like a config file (a misspelled key is a `load` diagnostic). What `nilvn.json` carries itself — `game.entry` / `game.scripts` / `game.lang`, `actors`, `plugins.use` — is dropped with a diagnostic; `game.title` is always the manifest's `title`. `path` is kept *(since 0.19.0)*: its aliases expand onto the asset table's refs, so a script's `@bg/sea.svg` resolves to `assets/bg/sea.svg`. Engines before 0.17 ignore the field. |
| `chunks` | The chunk manifest, embedded verbatim. |

## Carried plugins

A third-party plugin can travel inside the package, so the work plays anywhere
without the host knowing about it. Its files sit under `plugins/<id>/` — the
`plugin.json`, the engine module, its `styles` and `assets` — and **every one of
them is listed in the chunk manifest's `assets` table** (ref = the path inside the
package, `kind: "plugin"`). `nilvn.json` names the plugin.json through `entry`:

```jsonc
"plugins": [{ "id": "com.example.neon", "entry": "plugins/com.example.neon/plugin.json" }],
"chunks": { "assets": {
  "plugins/com.example.neon/plugin.json":   { "url": "plugins/com.example.neon/plugin.json",   "bytes": 412,  "kind": "plugin" },
  "plugins/com.example.neon/engine.js":     { "url": "plugins/com.example.neon/engine.js",     "bytes": 3120, "kind": "plugin" },
  "plugins/com.example.neon/sfx/click.ogg": { "url": "plugins/com.example.neon/sfx/click.ogg", "bytes": 5400, "kind": "plugin" }
} }
```

`packagePluginAssets(id, files)` in `@nilvn/core` builds both: `files` is
`{ path, bytes }[]` — every file of the plugin (its `plugin.json`, the engine
module, each `styles` and `assets` path), spelled relative to the `plugin.json` —
and it returns `{ plugin, assets }`: the `nilvn.json` `plugins` entry and the
rows to merge into `chunks.assets`. Write each file's bytes at its row's `url`.
The plugin's settings and key defaults go in the manifest's `config` like the
rest of the work's configuration:

```jsonc
"config": {
  "plugins": { "com.example.weather": { "intensity": 0.7 } },
  "keys": { "com.example.weather": { "toggle": "r" } }
}
```

[`packages/plugin-sdk/examples/pack.ts`](../../plugin-sdk/examples/pack.ts)
assembles a complete package this way, in both the zip and the single-file
form. Because the files go through the asset table, every package form
serves them the way it serves images: a directory by URL, a zip as blob URLs, the
single-file form as data URIs. The engine imports the module from that URL as it
is, so a carried plugin's engine entry must be **one self-contained ES module**
(no relative imports). The plugin gets the same permission grant as one loaded
with `[use ./x/plugin.json]`, and `ctx.asset(path)` resolves its listed assets
through the package. An entry without `entry` is resolved by id from the host's
registry, as before.

## The chunk manifest

Scripts are split into **chunks** (one scene per chunk by default; the studio may
merge a chapter into one) so a large work streams: only the chunk being played,
plus its neighbours, needs to be resident. Text is split the same way, one slice
per language per chunk, so switching language loads only the slices in use.

```jsonc
{
  "format": 1,
  "engine": "0.14.0",
  "schemaVersion": 11,                 // IR schema the chunks were compiled from
  "entry": { "label": "scene_intro" },
  "defaultLang": "zh",
  "sceneOrder": ["scene_intro", "scene_rooftop"],
  "chunks": [
    { "id": "scene_intro", "scenes": ["scene_intro"], "url": "chunks/scene/scene_intro.json",
      "bytes": 2210, "labels": ["scene_intro", "after_choice"],
      "assets": ["assets/bg/street.svg"], "next": ["scene_rooftop"], "branchTargets": [] }
  ],
  "labelIndex": { "scene_intro": "scene_intro", "after_choice": "scene_intro", "scene_rooftop": "scene_rooftop" },
  "locales": {
    "zh": [{ "id": "scene_intro", "scenes": ["scene_intro"], "url": "chunks/locale/zh/scene_intro.json", "bytes": 900 }],
    "en": [ /* … */ ]
  },
  "assets": {
    "assets/bg/street.svg": { "url": "assets/bg/street.svg", "bytes": 12034, "kind": "bg" }
  }
}
```

- A chunk file (`ScriptChunk`) is `{ id, body, labels }` where `body` is the
  `.nvn` script for its scenes, written with `@key` text references.
- A locale slice (`TextCatalogSlice`) is a flat `{ key: text }` object.
- `labelIndex` maps every jump target and save address to the chunk that defines
  it, so a jump, a `start(label)` or a restored save can load exactly the chunk
  it needs.
- `assets` maps a canonical asset reference to its file. Assets are always
  fetchable by reference, whether or not their chunk is resident, which is what
  lets the backlog replay a voice clip from a scene that has since been evicted.
- `next` / `branchTargets` are prefetch hints.

`createEngine({ maxResidentChunks })` sets an optional memory ceiling: chunks
outside the current one and its neighbourhood are evicted least-recently-used
and re-parsed if revisited. Without it every visited chunk stays resident.

## Writing your own loader

`ContentLoader` (from `@nilvn/core`) is the seam a host implements to serve a
package from somewhere else — an encrypted container, a native file system, an
in-memory cache:

```ts
interface ContentLoader {
  loadChunk(chunkId: string): Promise<ScriptChunk>
  loadLocale(lang: string, sliceId: string): Promise<TextCatalogSlice>
  assetUrl(ref: string): Promise<string>       // must work even for a released chunk
  releaseChunk(chunkId: string): void          // drop heavy bytes; keep refs resolvable
}
```

Hand the engine `{ manifest, loader }` (a `ScriptPackage`) through `load()`, or
pass `manifest: nilvnJson.chunks` and `loader` directly in `EngineOptions`. The
engine never sees ciphertext or keys: it asks for plaintext chunks and playable
URLs, and a closed host does the decrypting.

## Building a package

`@nilvn/core` exports `buildScriptPackage(project, options)`, which turns an IR
project into the manifest and the chunk / locale file contents (pure, no I/O;
the caller writes the files, resolves the assets and fills `chunks.assets` with
`fillPackageAssets`). See the [`@nilvn/core` README](../../core/README.md).
