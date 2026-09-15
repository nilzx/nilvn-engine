# NilVN plugin package template

Copy this directory, rename the id in `plugin.json` and `engine.js` (reverse-DNS,
e.g. `com.yourname.myfx`), and load it from a script with

```
[use ./my-plugin/plugin.json]
```

- `plugin.json` — the manifest: id, version, engine range, permissions, contributions
  (`textEffects`, `commands`, …), the module entries and the plugin's own messages.
- `engine.js` — the runtime half named by `entries.engine`. Plain ESM, no build step.
  A plugin never sees the engine or the DOM: everything comes through the capability
  objects on `ctx.plugin` / `activate(ctx)` for the permissions it declared.
- `main.css` — styles listed in `styles`, injected while active.

Validate the manifest before shipping:

```js
import { validatePluginManifest } from '@nilvn/plugin-sdk'
const { errors, warnings } = validatePluginManifest(manifest, { engineVersion: '0.14.0' })
```

Full contract: the [`@nilvn/plugin-sdk` README](../README.md) (prose) and
`plugin-spec.json` (machine) next to this template.
