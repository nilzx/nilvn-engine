# NilVN engine

[![CI](https://github.com/nilzx/nilvn-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/nilzx/nilvn-engine/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@nilvn/engine)](https://www.npmjs.com/package/@nilvn/engine)

A small visual-novel (ADV / galgame) engine for the browser. Scripts read like a
story — `yuki: Hi!` plus a few bracket commands — and everything expressive
(screen shake, text effects, sprite animation, choice styling, camera moves, the
in-game menu) is a plugin you can write in plain JavaScript. The engine is the
mechanism — parser, stage, audio, saves, languages, a capability-sandboxed plugin
host — and ships no plugins of its own; the first-party set is the sibling
repository [`nilvn-plugins`](https://github.com/nilzx/nilvn-plugins)
(`@nilvn/plugins`), written against the same public surface as any third-party
plugin. TypeScript, DOM + CSS rendering, no framework, one runtime dependency
that the single-file build drops.

This repository is the open, MIT-licensed part of NilVN. The visual "director"
editor that produces games for this engine (NilVN Studio, web and desktop) is a
separate closed-source product; what it exports runs on the packages here.

| Package | What it is |
|---|---|
| [`@nilvn/engine`](packages/engine) | The runtime: parses and plays scripts, renders the stage, hosts plugins, saves and restores. Ships an ESM build and a self-contained IIFE. |
| [`@nilvn/core`](packages/core) | The contract layer: the project document model, command and plugin-manifest schemas, the script-package format, serializers. No DOM, no dependencies. |
| [`@nilvn/plugin-sdk`](packages/plugin-sdk) | Plugin authoring: manifest types and validator, the extension-point and permission catalogs, runtime types, a starter package and the generated `plugin-spec.json` contract. |

The three are versioned and released together (`engine-v*` tags → npm).

## Quick start

```bash
pnpm add @nilvn/engine @nilvn/plugins
```

```ts
import { createEngine } from '@nilvn/engine'
import { withFirstParty } from '@nilvn/plugins'

const engine = createEngine({ ...withFirstParty(), container: document.getElementById('app')! })
await engine.loadConfig('./nilvn.config.toml')   // plugins, actors, aliases, macros, defaults
await engine.start()
```

```
[use textfx screenfx]
[bg assets/bg/classroom.jpg]
[char yuki smile]
yuki: {wave:Hi!} Want to make a game together?
[shake strength=10]
[choice Sure -> yes]
[choice Maybe later -> later]
```

A game exported by the studio is a script package; `engine.load('./my-game/')`
plays it, streaming scenes on demand. The content language defaults to `en`; a
multi-language game passes `lang`, `defaultLang`, `languages` and per-language
`catalogs`.

**Try it:** the demo game built from the first-party plugins runs at
[nilzx.github.io/nilvn-plugins](https://nilzx.github.io/nilvn-plugins/).

## Documentation

- [Script syntax](packages/engine/docs/script-syntax.md)
- [Config file](packages/engine/docs/config.md)
- [Command reference](packages/engine/docs/commands.md) — built-ins and object ids; the first-party plugins' commands are documented in [`nilvn-plugins`](https://github.com/nilzx/nilvn-plugins#the-plugins)
- [Engine API](packages/engine/docs/api.md)
- [Script packages](packages/engine/docs/script-package.md) — the `nilvn.json` format and custom loaders
- [Writing plugins](packages/plugin-sdk/README.md) — manifest, permissions, capability objects, lifecycle
- [`@nilvn/core` API](packages/core/README.md)

## Writing a plugin

```js
// engine.js — the runtime half named by plugin.json "entries.engine"
export default {
  id: 'com.example.neon',
  permissions: ['stage.write'],
  textEffects: { neon: (span) => span.addClass('fx-neon') },
  commands: {
    async boom({ num, plugin }) {
      await plugin.stage?.animate('camera', [{ x: -8 }, { x: 8 }, { x: 0 }], { durationSec: 0.3, compose: 'offset' })
    },
  },
}
```

A plugin declares permissions and receives capability objects for exactly those;
it never sees the engine or the DOM, and everything it registers is released when
it is deactivated, so plugins can be enabled, disabled and reloaded while a game
runs. Start from [`packages/plugin-sdk/template`](packages/plugin-sdk/template);
the first-party plugins in `nilvn-plugins` are worked examples of every extension
point, held to the same rule by a boundary check.

## Repository

```
packages/
  core/         @nilvn/core
  engine/       @nilvn/engine   src/ · docs/ · scripts/ (the bare IIFE builder)
  plugin-sdk/   @nilvn/plugin-sdk
scripts/        pack-smoke.mjs
```

```bash
pnpm install
pnpm test              # vitest across the three packages, including a boot of the built IIFE
pnpm typecheck         # every package
pnpm typecheck:test    # the test suites themselves
pnpm build             # dist/ for the three packages (ESM + .d.ts + the engine IIFE)
pnpm spec:check        # the generated plugin contract matches its source
pnpm pack:smoke        # pack the tarballs and consume them from a throwaway project
```

This repository is a mirror of the packages' home in NilVN's private monorepo:
every change arrives as a sync commit, and an `engine-v*` tag mirrored onto one
releases the three packages to npm ([CONTRIBUTING.md](CONTRIBUTING.md)).

The demo game and the single-file game bundler live in `nilvn-plugins`, next to
the plugins they show off.

Requires Node 22+ and pnpm. Contributions welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md); open an issue first for anything beyond a
fix, so the change can be discussed against the studio that consumes these
packages. Release history: [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
