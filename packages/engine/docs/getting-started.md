# Getting started — a game from an empty folder

This walks from nothing to a deployable visual novel with a title page, an
ending page, saves and settings — using only the published packages. The
commands are the ones an **npm user** runs; what a contributor runs inside the
repositories is listed at the end, separately.

## 1. A folder and two packages

```bash
mkdir my-novel && cd my-novel
npm init -y
npm i @nilvn/engine @nilvn/plugins
npm i -D vite
```

Vite is only the dev server + bundler; any bundler works, and [section 6](#6-no-bundler-the-single-script-build)
shows the no-bundler path.

```
my-novel/
├─ index.html
├─ main.ts               (or main.js)
└─ public/
   ├─ nilvn.config.toml
   ├─ story.nvn
   └─ assets/ (bg/ char/ bgm/ …)
```

## 2. The page

`index.html` — one box for the stage. The stage is a **16:9** area that scales
to its container's width, so give the box a width and let the height follow:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My Novel</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d16; }
    #app { width: min(96vw, 168vh); }   /* 16:9 that fits the window either way */
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/main.ts"></script>
</body>
</html>
```

## 3. The host script

`main.ts` — register the first-party plugins, load the config, open the title
page. **`start()` resolves when the story ends**, not when it begins; the title
page's *New game* calls it for you.

```ts
import { createEngine } from '@nilvn/engine'
import { withFirstParty } from '@nilvn/plugins'

const engine = createEngine({ ...withFirstParty(), container: document.getElementById('app')! })
await engine.loadConfig('./nilvn.config.toml')
await engine.showTitle()
```

That is the whole host. Everything else — plugins, actors, the title and ending
pages, the menu, the theme — is the config file.

## 4. The config file

`public/nilvn.config.toml`:

```toml
[game]
title = "My Novel"          # the window title and the title page's heading
entry = "story.nvn"

[plugins]
use = ["textfx", "screenfx", "charfx", "voicefx"]

[path]
"@bg" = "assets/bg"
"@char" = "assets/char"
"@bgm" = "assets/bgm"

[actors.yuki]
name = "Yuki"
color = "#ff7eb6"           # name-tag background
sprites = "@char/yuki-{face}.svg"
face = "happy"
voice = 360                 # voicefx's pitch for her typing blips

[title]                     # the built-in title page
subtitle = "a short story"
background = "@bg/night.png"
bgm = "@bgm/title.ogg"

[ending.default]            # what [end] shows
heading = "The End"
credits = """
Story — you
Engine — NilVN
"""
after = "title"

[saves]
autosave = "label"          # Continue on the title page resumes from the last scene

[theme]
accent = "#ff7eb6"
```

Every section is documented in [config.md](config.md); the title / ending / menu
/ settings pages in [config.md → `[title]`](config.md#title) and the theme
tokens in [api.md → Theming](api.md#theming). Nothing here needs CSS.

## 5. The story

`public/story.nvn`:

```
[label start]
[bg @bg/street.png fade=1]
[bgm @bgm/daily.ogg]
An evening street.
[char yuki happy]
yuki: You came! {wave:I've been waiting~}
[choice Say hi -> hi]
[choice Say nothing -> quiet]

[label hi]
me: Hi.
[jump fin]

[label quiet]
yuki(sad): …
[jump fin]

[label fin]
[end]
```

`[end]` shows the `[ending.default]` page; `[ending true_end]` would show
`[ending.true_end]`. The [script syntax](script-syntax.md) and
[command reference](commands.md) cover the rest.

```bash
npx vite            # http://localhost:5173 — the title page, then your story
```

The player gets the ☰ menu (Esc) with save / load, quick save, backlog (wheel
up), auto, skip (Ctrl held), settings and back-to-title — nothing to write.

## 6. No bundler: the single-script build

`@nilvn/plugins/iife` is the engine plus the first-party plugins as one
`<script>` (global `ADV`). It has **no TOML parser** (`loadConfig` is ESM-only),
so hand it the config as an object:

```html
<script src="https://cdn.jsdelivr.net/npm/@nilvn/plugins/dist/nilvn.iife.js"></script>
<script>
  const engine = ADV.createEngine({ container: document.getElementById('app') })
  ADV.applyConfig(engine, {
    game: { title: 'My Novel', entry: 'story.nvn' },
    plugins: { use: ['textfx'] },
    actors: { yuki: { name: 'Yuki', color: '#ff7eb6' } },
    title: { subtitle: 'a short story' },
  })
  engine.showTitle()
</script>
```

Assets and `story.nvn` are then fetched relative to the page, so the page has
to be served over HTTP (any static host); a double-clicked `file://` page cannot
fetch siblings.

## 7. Deploy

```bash
npx vite build      # dist/: index.html + your bundle + public/ copied verbatim
```

Upload `dist/` to any static host. Saves and settings live in the player's
browser (`localStorage`, namespaced by the work); nothing needs a server.

## 8. Small screens

The stage is a fixed 16:9 box. On a portrait phone it fills the width and the
text gets small; the built-in remedy is one token:

```toml
[theme]
"ui-scale" = "1.3"          # scales every chrome font size
```

A landscape prompt or a portrait-specific layout is the host page's business.

## 9. Languages

A multi-language work ships one catalog per language and references text by
key (`yuki: @yuki_hi`); pass `catalogs`, `lang`, `defaultLang` and `languages`
to `createEngine` (see [api.md → Languages](api.md#languages)) and the settings
panel gains a language switcher. Chrome strings (New game, Continue, Save …)
ship in `en`, `zh` and `ja` and can be overridden per work with `[strings.<lang>]`.

## Contributor commands (the repositories, not npm)

These run inside the `nilvn-engine` / `nilvn-plugins` repositories and are
**not** part of the published packages:

| Command | Where | What |
|---|---|---|
| `pnpm dev` | nilvn-plugins | The demo game on http://localhost:5180 (`demo/`). |
| `pnpm bundle <game-dir> [--dir]` | nilvn-plugins | Pack a game folder into one double-clickable `.html`, or a deployable folder — the same thing NilVN Studio's export does; it builds the engine from source. |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | both | The packages' own build and checks. |

An npm user deploys with their bundler ([section 7](#7-deploy)) or the CDN
script ([section 6](#6-no-bundler-the-single-script-build)).
