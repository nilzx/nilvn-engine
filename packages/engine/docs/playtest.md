# Playtesting: `nilvn playtest`

*(since 0.19.0)* `nilvn playtest` plays a work in a real, headless Chrome with
real mouse and key events, and reports what a player would run into: a route
that cannot go on, an option or an object that is not there — or is there but
covered, so a click at its centre lands on something else — and every engine
diagnostic along the way. It ships with `@nilvn/engine` and drives the Chrome,
Chromium or Edge already on the machine (no download); it needs Node 22+.

```bash
npx nilvn playtest public            # a work: packed into a temporary folder, then played
npx nilvn playtest dist-pack/game.html
npx nilvn playtest http://localhost:5173/
```

The target is a work (its `nilvn.config.toml` or folder — packed first, as
[`nilvn pack`](script-package.md#packing-a-config-driven-work-nilvn-pack) does),
a package folder, a single-file `.html`, or a page URL. The page must expose
its engine as `window.engine`; the pages `nilvn pack` writes do. A host page of
your own sets it in one line: `window.engine = createEngine({ … })`.

## Explore

With no playtest file, `nilvn playtest` explores: each run starts a new game
from the title page and plays to an ending. At a choices prompt it takes the
option taken least often so far at that prompt, so a few runs spread over the
branches; when the story parks on a line that waits for a click (a map hub of
`[hotspot]`s, a clickable `[sprite]`, a `[ui]` button) it clicks the object
clicked least so far; an `[input]` box gets what it will take — the author's
default or placeholder, a number in range for a number field, `test` otherwise —
or is cancelled. A plugin's full-stage screen is closed with Escape. A run fails
when it stalls — Space changes nothing and there is nothing to click — when it
keeps coming back to the same stop, or when the engine reports anything.

```
playtest: public · explore ×3
✓ explore 1 → true (46 s)
✓ explore 2 → normal (61 s)
✓ explore 3 → true (46 s)

✓ 3 / 3 passed · endings: true, normal
```

`--explore 10` sets the number of runs (default 3); with routes, `--explore`
adds explore runs after them.

## Routes

A playtest file — `playtest.mjs` (or `playtest.json`) in the current folder, or
`--routes <file>` — scripts playthroughs. Routes run in order in one browser
profile, so saves, settings, persistent variables and unlocked replays carry
from one to the next, as for a player.

```js
// playtest.mjs
import { definePlaytest } from '@nilvn/engine/playtest'

export default definePlaytest({
  routes: {
    'the true ending': async (p) => {
      await p.newGame()
      await p.advance()                  // to the first prompt / input / parked line
      await p.type('Rin')                // the name box
      await p.advance()
      await p.choose('Show her the letter')
      await p.advance()
      await p.click('h_pier')            // a [hotspot] or clickable [sprite], by id
      await p.advance({ until: 'glints' })
      await p.click('glint')
      await p.expect('has_key', true)
      await p.playToEnd()                // first option at every prompt from here
      await p.expectEnding('dawn')
      await p.toTitle()
    },
    // The same calls as data:
    'smoke': [{ newGame: true }, { playToEnd: true }, { toTitle: true }],
  },
})
```

| Call | |
|---|---|
| `newGame()` | Wait for the title page and click its first button. |
| `advance({ until?, max? })` | Press Space until something needs the player and return why (`stop`: `choices`, `input`, `screen` — a plugin screen, `parked` — the same line keeps coming back, each time waiting for the player, and something is clickable, `text` — a line containing `until`, `ending`, `title`, `max` — `max` presses in a row changed nothing, default 40), with the lines shown on the way and the `state`. |
| `choose(labelOrIndex)` | Click an option: the one whose label equals the text, else the first that contains it; or its 0-based index. |
| `click(idOrSelector)` | Click a stage object by id (`h_pier`, `sprite:glint`) or any element by CSS selector, at its centre. Fails when something else is on top there — what a player would hit. |
| `button(label)` | Click a visible button by its label: a `[ui]` panel's, a plugin screen's, a dialog's. |
| `press(key, { ctrl?, meta?, shift?, alt? })` | `Space`, `Enter`, `Escape`, `ArrowUp`, `F5`, `j` … |
| `type(text, { submit? })` | Type into the open `[input]` box and press its OK button (unless `submit: false`); fails when the box does not take the text (a number field, a `pattern`). |
| `playToEnd({ choose?, answer?, max? })` | Play on to an ending: `choose(labels)` picks at each prompt (default the first), `answer` fills inputs (default: what each box will take, as in explore), a parked line gets its least-clicked object. Throws at a plugin screen — play those in the route. |
| `toTitle()` | Wait for the title page (after the credits, or the ending page's button). |
| `state()` | What is on screen: `session`, `speaker`, `text`, `choices`, `input`, `screen`, `clickables`, `panelButtons`, `ending`, `replaying`. |
| `get(name)` / `expect(name, value)` | A variable (`engine.getVar`, `sys.*` included); `expect` fails unless it deep-equals `value`. |
| `expectEnding(id)` | Fail unless the last ending the route reached is `id` (an ending page left at once — a key press on its focused button — still counts). |
| `page(fn, ...args)` | Run `fn` in the page (it is serialized: use its arguments, not closures) and return its JSON result — for a mini-game, or `window.engine` calls such as `saveSlot(5)`. |
| `waitFor(fn, ms?)` / `wait(ms)` | Wait for `fn` (in the page) to return truthy; wait. |
| `screenshot(name)` | A PNG in the report folder. |
| `log(...)` | A line in the report. |

A route passes when it returns without throwing and the engine reported nothing
while it ran (`--allow-diagnostics` relaxes the second). A failed route leaves a
screenshot, and the next route starts from a fresh load of the page.

## Options and the report

| Option | |
|---|---|
| `-r, --routes <file>` | The playtest file (default `playtest.mjs` / `playtest.json` in the current folder). |
| `--only <names>` | Run only these routes (comma-separated). |
| `--explore [runs]` | Explore runs (default 3; the mode when there are no routes). |
| `-o, --out <dir>` | Screenshots and `report.json` (default `playtest-report`). |
| `--chrome <path>` | The browser; default a local Chrome, Chromium or Edge (or `NILVN_CHROME`). |
| `--headful` | Show the browser window. |
| `--gap <ms>` | Pause after each key or click (default 250). |
| `--allow-diagnostics` | Engine diagnostics do not fail a route. |
| `--engine <file>` | When packing a work: the engine script to ship. |

The exit code is 1 when any route or run failed, so a CI job can run
`nilvn playtest` after `nilvn pack`. `report.json` lists every route and run
with its result, error, diagnostics, ending, time, log lines and screenshot.
