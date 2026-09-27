// `@nilvn/engine/playtest` — the contract of a playtest file for `nilvn playtest`.
// A route is a scripted playthrough, run in a real (headless) Chrome with real
// mouse and key events: a click lands where the player's would, so an object a
// panel covers fails the route the way it would fail a player. Types only (and
// `definePlaytest`, an identity helper for editor hints); the driver itself is
// the command line's.
//
//   // playtest.mjs
//   import { definePlaytest } from '@nilvn/engine/playtest'
//   export default definePlaytest({
//     routes: {
//       'the true ending': async (p) => {
//         await p.newGame()
//         await p.advance()
//         await p.choose('Show her the letter')
//         await p.click('h_pier')          // a [hotspot] / clickable [sprite] id
//         await p.expect('has_key', true)
//         await p.playToEnd()
//         await p.expectEnding('dawn')
//       },
//       'smoke': [{ newGame: true }, { playToEnd: true }],   // the same as steps
//     },
//   })

/** What the page shows right now. */
export interface PlayState {
  /** `engine.session`: `title` / `playing` / `ending` … */
  session: string
  /** The speaker on the name tag ('' for narration). */
  speaker: string
  /** The dialogue text on screen. */
  text: string
  /** The labels of the options on screen (a choices prompt is up when non-empty). */
  choices: string[]
  /** An `[input]` box is open. */
  input: boolean
  /** A plugin's full-stage screen is open. */
  screen: boolean
  /** What the player can click on the stage (`hotspot:<id>`, `sprite:<id>`). */
  clickables: string[]
  /** Labels of the buttons on the `[ui]` panels shown. */
  panelButtons: string[]
  /** The ending reached (`[ending id]`), while the session is `ending`. */
  ending?: string
  /** The replay playing, or null. */
  replaying: string | null
  /** A shown line waits for the player (`engine.waitingForPlayer`). */
  waiting: boolean
}

/** Why `advance` stopped. */
export type AdvanceStop =
  | 'choices' // a choices prompt is up
  | 'input' // an [input] box is open
  | 'screen' // a plugin screen is open
  | 'parked' // the same line keeps coming back, waiting, and something is clickable: the story waits for a click
  | 'text' // a line containing `until` is on screen
  | 'ending' // the session reached an ending
  | 'title' // back on the title page
  | 'max' // `max` presses in a row changed nothing and nothing is clickable

export interface AdvanceResult {
  stop: AdvanceStop
  /** The lines shown on the way, in order. */
  lines: string[]
  state: PlayState
}

/** The driver a route plays through. Every action is a real input event. */
export interface PlaytestDriver {
  /** Wait for the title page and click its first (primary) button. */
  newGame(): Promise<void>
  /** Press Space until something needs the player (see `AdvanceStop`), a line
   *  containing `until` shows, or `max` presses in a row change nothing (default 40). */
  advance(opts?: { until?: string; max?: number }): Promise<AdvanceResult>
  /** Click an option: by its label (exact, else the first that contains it) or its 0-based index. */
  choose(option: string | number): Promise<void>
  /** Click a stage object by id (`h_pier` — a `[hotspot]` or clickable `[sprite]`) or
   *  any element by CSS selector — at its centre, failing when something else covers it. */
  click(target: string): Promise<void>
  /** Click a visible button by its label (a `[ui]` panel, a plugin screen, a dialog). */
  button(label: string): Promise<void>
  /** Press a key: `Space`, `Enter`, `Escape`, `ArrowUp`, `F5`, `j` … */
  press(key: string, mods?: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean }): Promise<void>
  /** Type into the open `[input]` box; `submit` (default true) confirms it. */
  type(text: string, opts?: { submit?: boolean }): Promise<void>
  /** Play on to an ending: advance, pick options with `choose` (default: the
   *  first), answer inputs with `answer`, click a clickable when the story parks.
   *  Resolves with the ending id; throws at a plugin screen (play those in the route). */
  playToEnd(opts?: { choose?: (choices: string[]) => number; answer?: string; max?: number }): Promise<string>
  /** Wait for the title page again (the ending's credits, or its button). */
  toTitle(): Promise<void>
  state(): Promise<PlayState>
  /** A variable (session or persistent), as `engine.getVar`. */
  get(name: string): Promise<unknown>
  /** Fail unless the variable deep-equals `value`. */
  expect(name: string, value: unknown): Promise<void>
  /** Fail unless the last ending this route reached is `id` (waits a moment for one). */
  expectEnding(id: string): Promise<void>
  /** Run a function in the page (it is serialized — no closures) and return its JSON result. */
  page<T, A extends unknown[]>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<T>
  /** Wait until `fn` (run in the page) returns truthy. */
  waitFor(fn: () => unknown, timeoutMs?: number): Promise<void>
  wait(ms: number): Promise<void>
  /** Save a PNG of the page to the report folder; returns its path. */
  screenshot(name: string): Promise<string>
  /** The engine's diagnostics since the route began. */
  diagnostics(): Promise<string[]>
  /** A line in the report. */
  log(...parts: unknown[]): void
}

/** One step of a route written as data (the same calls as the driver). */
export type PlaytestStep =
  | { newGame: true }
  | { advance: true | { until?: string; max?: number } }
  | { choose: string | number }
  | { click: string }
  | { button: string }
  | { press: string }
  | { type: string; submit?: boolean }
  | { expect: string; equals: unknown }
  | { playToEnd: true | { answer?: string; max?: number } }
  | { ending: string }
  | { toTitle: true }
  | { wait: number }
  | { screenshot: string }

export type PlaytestRoute = ((p: PlaytestDriver) => Promise<void>) | PlaytestStep[]

export interface Playtest {
  /** Routes by name, run in order in one browser profile: saves, settings and
   *  persistent variables carry from one route to the next, as for a player. */
  routes: Record<string, PlaytestRoute>
}

/** Identity: types a playtest file's default export. */
export function definePlaytest(playtest: Playtest): Playtest {
  return playtest
}
