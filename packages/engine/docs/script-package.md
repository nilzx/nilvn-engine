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
    { "id": "com.example.neon", "entry": "plugins/neon/plugin.json" }   // carried inside the package
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
| `actors` | The actor table (`PackageActor`), the same shape as the engine's `ActorDef`: display `name`, optional `nameKey`, name-tag `color` / `textColor`, the sprite template and default face — or a layered sprite (`canvas` + `layers`, each `{ src, default?, offset?, optional? }`) — and `ext`, the plugin actor fields by plugin id (`ext["app.nilvn.voicefx"].voice` is the typing-blip pitch; a top-level `voice` from older packages is still moved there). |
| `plugins` | Enabled plugins by id. `entry` points at a `plugin.json` inside the package for a plugin the work carries with it. |
| `textSpeed` | Typewriter speed. |
| `saveKey` | Per-work id the in-game menu namespaces `localStorage` by. |
| `config` | Optional (0.17+). The work's configuration — [nilvn.config.toml](config.md) as JSON, section by section (`title`, `ending`, `theme`, `window`, `menu`, `settings`, `keys`, `saves`, `choices`, `input`, `preload`, `ui`, `persist`, `strings`, `plugins.<id>` …). Applied once the package is open and its asset table is filled, so a skin, logo or background in it resolves by ref like any other asset; checked like a config file (a misspelled key is a `load` diagnostic). What `nilvn.json` carries itself — `game.entry` / `game.scripts`, `path`, `actors`, `plugins.use` — is dropped with a diagnostic; `game.title` is always the manifest's `title`. Engines before 0.17 ignore the field. |
| `chunks` | The chunk manifest, embedded verbatim. |

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
