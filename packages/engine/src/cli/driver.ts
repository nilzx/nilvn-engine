// The playtest driver: what a route's `p` is. It reads the page through the
// engine it exposes (`window.engine`) and the stage's DOM, and acts only through
// real input events sent over the DevTools protocol — a click is dispatched at
// screen coordinates after checking what is actually there, so an object a panel
// or the choices prompt covers fails the route as it would fail a player.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AdvanceResult, PlayState, PlaytestDriver, PlaytestStep } from '../playtest.js'
import type { CdpPage } from './chrome.js'

/** A route failure the report shows as a message, not a stack. */
export class RouteError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Page-side: the state snapshot, and the diagnostics a route collects. Every
// diagnostic object is marked once seen, so the engine's capped list rolling
// over never loses or repeats one.
const PAGE_STATE = `
  const e = window.engine
  if (!e) throw new Error('the page exposes no window.engine')
  const seen = (window.__nilvnSeen ??= new WeakSet())
  const route = (window.__nilvnRouteDiags ??= [])
  for (const d of e.diagnostics) if (!seen.has(d)) { seen.add(d); route.push(d.phase + ': ' + d.message + (d.line !== undefined ? ' (line ' + d.line + ')' : '')) }
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const label = (b) => { const m = b.querySelector('.nilvn-choice__mark'); return (b.textContent ?? '').replace(m ? m.textContent ?? '' : '', '').trim() }
  const named = (b) => (b.textContent ?? '').trim() || b.getAttribute('aria-label') || ''
  const name = document.querySelector('.nilvn-name')
  const dims = [...document.querySelectorAll('.nilvn-ui-dim')].filter(vis).map((d) => d.dataset.id)
  return {
    session: e.session,
    speaker: vis(name) ? (name.textContent ?? '').trim() : '',
    text: (e.stage.textEl.textContent ?? '').trim(),
    choices: [...document.querySelectorAll('.nilvn-choice')].filter(vis).map(label),
    input: [...document.querySelectorAll('.nilvn-modal input, .nilvn-modal textarea')].some(vis),
    // A plugin's full-stage screen, or a system menu page a [menu open …] button opened.
    screen: [...document.querySelectorAll('.nilvn-screen-plugin, .nilvn-backlog.on')].some(vis),
    clickables: e.stage.clickableIds ? e.stage.clickableIds() : [],
    // Under a dimmed [ui] window only that window's buttons can be pressed.
    panelButtons: [...document.querySelectorAll('.nilvn-ui button')].filter(vis).filter((b) => !dims.length || dims.includes(b.closest('.nilvn-ui')?.dataset.id)).map(named),
    ending: e.session === 'ending' ? e.ending : undefined,
    replaying: e.isReplaying(),
    waiting: !!e.waitingForPlayer,
  }`

/** A key name → the DevTools key event fields. */
export function keyInfo(name: string): { key: string; code: string; keyCode: number } {
  const named: Record<string, [string, string, number]> = {
    Space: [' ', 'Space', 32],
    ' ': [' ', 'Space', 32],
    Enter: ['Enter', 'Enter', 13],
    Escape: ['Escape', 'Escape', 27],
    Esc: ['Escape', 'Escape', 27],
    Tab: ['Tab', 'Tab', 9],
    Backspace: ['Backspace', 'Backspace', 8],
    ArrowUp: ['ArrowUp', 'ArrowUp', 38],
    ArrowDown: ['ArrowDown', 'ArrowDown', 40],
    ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
    ArrowRight: ['ArrowRight', 'ArrowRight', 39],
    PageUp: ['PageUp', 'PageUp', 33],
    PageDown: ['PageDown', 'PageDown', 34],
  }
  if (named[name]) {
    const [key, code, keyCode] = named[name]
    return { key, code, keyCode }
  }
  const f = /^F([1-9]|1[0-2])$/.exec(name)
  if (f) return { key: name, code: name, keyCode: 111 + Number(f[1]) }
  if (name.length === 1) {
    const up = name.toUpperCase()
    if (/[A-Z]/.test(up)) return { key: name, code: `Key${up}`, keyCode: up.charCodeAt(0) }
    if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0) }
    return { key: name, code: '', keyCode: name.charCodeAt(0) }
  }
  throw new RouteError(`unknown key "${name}"`)
}

/** Which of `options` has been taken least often so far (ties: the first). */
export function leastUsed(options: string[], counts: Map<string, number>, key = (o: string) => o): number {
  let best = 0
  let min = Infinity
  options.forEach((o, i) => {
    const n = counts.get(key(o)) ?? 0
    if (n < min) {
      min = n
      best = i
    }
  })
  return best
}

export interface DriverOptions {
  /** Where screenshots go. */
  outDir: string
  /** Pause after each key press / click, ms. */
  gap: number
}

export class Driver implements PlaytestDriver {
  readonly lines: string[] = []
  /** Every ending page the route reached, in order. */
  readonly endings: string[] = []
  /** How often each clickable was clicked when the story parked (playToEnd). */
  readonly clicked = new Map<string, number>()

  constructor(
    readonly cdp: CdpPage,
    private readonly opts: DriverOptions,
  ) {}

  private js<T>(body: string): Promise<T> {
    return this.cdp.evaluate<T>(`(async () => { ${body} })()`)
  }

  /** Start a route: what was reported before it (the boot, the route before)
   *  is marked seen and not counted against it. */
  async begin(): Promise<void> {
    await this.state().catch(() => undefined)
    await this.js('window.__nilvnRouteDiags = []; return true').catch(() => undefined)
    this.lines.length = 0
    this.endings.length = 0
  }

  async state(): Promise<PlayState> {
    const s = await this.js<PlayState>(PAGE_STATE)
    if (s.session === 'ending' && s.ending !== undefined && this.lastEnding !== s.ending) this.endings.push(s.ending)
    this.lastEnding = s.session === 'ending' ? s.ending : undefined
    return s
  }
  private lastEnding: string | undefined

  async diagnostics(): Promise<string[]> {
    await this.state().catch(() => undefined)
    return this.js<string[]>('return window.__nilvnRouteDiags ?? []')
  }

  log(...parts: unknown[]): void {
    this.lines.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))
  }

  wait(ms: number): Promise<void> {
    return sleep(ms)
  }

  async page<T, A extends unknown[]>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<T> {
    return this.cdp.evaluate<T>(`(${fn.toString()})(...${JSON.stringify(args)})`)
  }

  async waitFor(fn: () => unknown, timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (await this.cdp.evaluate<unknown>(`(${fn.toString()})()`)) return
      await sleep(100)
    }
    throw new RouteError(`waitFor timed out after ${timeoutMs} ms: ${fn.toString().slice(0, 80)}`)
  }

  private async waitState(pred: (s: PlayState) => boolean, timeoutMs: number): Promise<PlayState | undefined> {
    const until = Date.now() + timeoutMs
    for (;;) {
      const s = await this.state()
      if (pred(s)) return s
      if (Date.now() > until) return undefined
      await sleep(150)
    }
  }

  async press(name: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}): Promise<void> {
    const k = keyInfo(name)
    const modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.shift ? 8 : 0)
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers })
    await sleep(this.opts.gap)
  }

  private async mouse(x: number, y: number): Promise<void> {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }

  /** Click the element `selector` picks (the `nth` visible one) at its centre,
   *  after checking nothing else is on top there. */
  private async clickAt(selector: string, what: string, nth = 0, waitMs = 8000): Promise<void> {
    const until = Date.now() + waitMs
    for (;;) {
      const r = await this.js<{ x: number; y: number; ok: boolean; hit: string } | null>(`
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
        const e = els[${nth}]
        if (!e) return null
        e.scrollIntoView({ block: 'center', inline: 'center' })
        const b = e.getBoundingClientRect()
        const x = b.x + b.width / 2, y = b.y + b.height / 2
        const hit = document.elementFromPoint(x, y)
        return { x, y, ok: hit === e || e.contains(hit), hit: hit ? String(hit.className || hit.tagName) : 'nothing' }`)
      if (r) {
        if (!r.ok) throw new RouteError(`${what} is covered at its centre by "${r.hit}" — a player could not click it`)
        await this.mouse(r.x, r.y)
        await sleep(this.opts.gap * 2)
        return
      }
      if (Date.now() > until) throw new RouteError(`${what} is not on screen`)
      await sleep(150)
    }
  }

  async newGame(): Promise<void> {
    const s = await this.waitState((s) => s.session === 'title' && !s.screen, 60_000)
    if (!s) throw new RouteError(`no title page (session: ${(await this.state()).session})`)
    await sleep(700) // a page ignores the player's input for its first moment
    await this.clickAt('.nilvn-screen--title .nilvn-screen__button--primary', 'the title page\'s first button')
    if (!(await this.waitState((s) => s.session !== 'title', 15_000))) throw new RouteError('New game did not start the story')
  }

  async advance(opts: { until?: string; max?: number } = {}): Promise<AdvanceResult> {
    const lines: string[] = []
    let last = ''
    // Presses since the text last changed: a long stretch of story plays on;
    // only presses that change nothing count towards `max`.
    let same = 0
    const max = opts.max ?? 40
    const endingsBefore = this.endings.length
    for (let i = 0; ; i++) {
      const s = await this.state()
      if (s.text && s.text !== lines[lines.length - 1]) lines.push(s.text)
      const done = (stop: AdvanceResult['stop']): AdvanceResult => ({ stop, lines, state: s })
      if (opts.until && s.text.includes(opts.until)) return done('text')
      if (s.choices.length) return done('choices')
      if (s.input) return done('input')
      if (s.screen) return done('screen')
      if (s.session === 'ending') return done('ending')
      // A Space press can land on the ending page's focused Back-to-title button the
      // moment it appears — a player's too: an ending seen on the way still counts.
      if (s.session === 'title' && i > 0) return done(this.endings.length > endingsBefore ? 'ending' : 'title')
      same = s.text && s.text === last ? same + 1 : 0
      last = s.text
      // A line that comes back however often it is advanced, waiting for the player
      // now, with something to click: parked (a map hub). While a transition or a
      // slow command runs the engine is not waiting, so that is only taking its time.
      if (same >= 3 && s.waiting && (s.clickables.length || s.panelButtons.length)) return done('parked')
      if (same >= max) return done('max')
      await this.press('Space')
    }
  }

  async choose(option: string | number): Promise<void> {
    const s = (await this.waitState((s) => s.choices.length > 0, 8000)) ?? (await this.state())
    const i = typeof option === 'number' ? option : (() => {
      const exact = s.choices.indexOf(option)
      return exact >= 0 ? exact : s.choices.findIndex((c) => c.includes(option))
    })()
    if (i < 0 || i >= s.choices.length) throw new RouteError(`no option ${JSON.stringify(option)} (on screen: ${JSON.stringify(s.choices)})`)
    await this.clickAt('.nilvn-choice', `the option ${JSON.stringify(s.choices[i])}`, i)
  }

  async click(target: string): Promise<void> {
    const selector = /^[.#[]/.test(target) || target.includes(' ') ? target : `[data-id="${target.replace(/^(hotspot|sprite):/, '')}"]`
    await this.clickAt(selector, JSON.stringify(target))
  }

  async button(label: string): Promise<void> {
    const i = await this.js<number>(`
      const bs = [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
      const t = ${JSON.stringify(label)}
      // An icon-only button (a window's close) goes by its accessible name.
      const named = (b) => (b.textContent ?? '').trim() || b.getAttribute('aria-label') || ''
      const at = bs.findIndex((b) => named(b) === t)
      return at >= 0 ? at : bs.findIndex((b) => named(b).includes(t))`)
    if (i < 0) throw new RouteError(`no button ${JSON.stringify(label)}`)
    await this.clickAt('button', `the button ${JSON.stringify(label)}`, i)
  }

  async type(text: string, opts: { submit?: boolean } = {}): Promise<void> {
    if (!(await this.waitState((s) => s.input, 8000))) throw new RouteError('no [input] box is open')
    await this.js(`document.querySelector('.nilvn-modal input, .nilvn-modal textarea')?.focus(); return true`)
    await this.cdp.send('Input.insertText', { text })
    await sleep(this.opts.gap)
    if (opts.submit === false) return
    const ok = await this.js<{ disabled: boolean; hint: string }>(`
      const b = document.querySelector('.nilvn-modal .nilvn-screen__button--primary')
      const f = document.querySelector('.nilvn-modal input, .nilvn-modal textarea')
      return { disabled: !b || b.disabled, hint: f ? (f.type + (f.min ? ' min ' + f.min : '') + (f.max ? ' max ' + f.max : '') + (f.pattern ? ' pattern ' + f.pattern : '')) : '' }`)
    if (ok.disabled) throw new RouteError(`the input box does not take ${JSON.stringify(text)} (${ok.hint.trim()})`)
    await this.clickAt('.nilvn-modal .nilvn-screen__button--primary', 'the input box\'s OK button')
    if ((await this.waitState((s) => !s.input, 3000)) === undefined) throw new RouteError(`the input box stayed open after ${JSON.stringify(text)}`)
  }

  /** An answer the open input box takes, as a player who does not care would
   *  give one: the author's default / placeholder, a number in range, else text. */
  async plausibleAnswer(): Promise<{ text: string; cancel: boolean }> {
    return this.js<{ text: string; cancel: boolean }>(`
      const f = document.querySelector('.nilvn-modal input, .nilvn-modal textarea')
      if (!f) return { text: '', cancel: true }
      if (f.value) return { text: '', cancel: false }
      if (f.placeholder && (!f.pattern || new RegExp('^(?:' + f.pattern + ')$').test(f.placeholder))) return { text: f.placeholder, cancel: false }
      if (f.type === 'number') return { text: String(f.min !== '' ? f.min : f.max !== '' ? Math.min(0, Number(f.max)) : 0), cancel: false }
      if (f.pattern && !new RegExp('^(?:' + f.pattern + ')$').test('test')) return { text: '', cancel: true }
      return { text: 'test'.slice(0, f.maxLength > 0 ? f.maxLength : 4), cancel: false }`)
  }

  /** Answer the open input box with `plausibleAnswer`, or cancel it. */
  async answerAnyhow(): Promise<string> {
    const a = await this.plausibleAnswer()
    if (!a.cancel) {
      try {
        await this.type(a.text)
        return a.text || '(the default)'
      } catch {
        /* not taken: cancel below */
      }
    }
    await this.clickAt('.nilvn-modal .nilvn-screen__button:not(.nilvn-screen__button--primary)', "the input box's Cancel button")
    return '(cancelled)'
  }

  async playToEnd(opts: { choose?: (choices: string[]) => number; answer?: string; max?: number } = {}): Promise<string> {
    for (let round = 0; round < (opts.max ?? 400); round++) {
      const r = await this.advance()
      switch (r.stop) {
        case 'ending':
          return this.endings[this.endings.length - 1] ?? r.state.ending ?? ''
        case 'choices':
          await this.choose(opts.choose ? opts.choose(r.state.choices) : 0)
          break
        case 'input':
          if (opts.answer !== undefined) await this.type(opts.answer)
          else await this.answerAnyhow()
          break
        case 'parked':
          await this.clickLeastUsed(r.state)
          break
        case 'screen':
          throw new RouteError(`a plugin screen opened at ${JSON.stringify(r.state.text)} — play it in the route`)
        case 'title':
          throw new RouteError('back on the title page without an ending')
        default:
          throw new RouteError(`stalled at ${JSON.stringify(r.state.text)} (session ${r.state.session}; nothing to click, no options)`)
      }
    }
    throw new RouteError('no ending within the step limit')
  }

  /** The story parked on a line waiting for a click: click the clickable (else
   *  the panel button) clicked least so far, so repeated visits spread out. */
  async clickLeastUsed(state: PlayState): Promise<void> {
    const ids = state.clickables
    if (ids.length) {
      const pick = ids[leastUsed(ids, this.clicked)]!
      this.clicked.set(pick, (this.clicked.get(pick) ?? 0) + 1)
      await this.click(pick)
      return
    }
    const b = state.panelButtons[leastUsed(state.panelButtons, this.clicked, (l) => `ui:${l}`)]!
    this.clicked.set(`ui:${b}`, (this.clicked.get(`ui:${b}`) ?? 0) + 1)
    await this.button(b)
  }

  async toTitle(): Promise<void> {
    const started = Date.now()
    let clicked = false
    for (;;) {
      const s = await this.state()
      if (s.session === 'title' && !s.screen) return
      const elapsed = Date.now() - started
      if (elapsed > 90_000) throw new RouteError(`never back on the title page (session: ${s.session})`)
      // Credits that return to the title by themselves get 15 s; after that the
      // ending page's own button (Back to title) is what a player would press.
      if (!clicked && s.session === 'ending' && elapsed > 15_000) {
        const up = await this.js<boolean>(`const b = document.querySelector('.nilvn-screen--ending .nilvn-screen__button--primary'); return !!b && b.getClientRects().length > 0`)
        if (up) {
          await this.clickAt('.nilvn-screen--ending .nilvn-screen__button--primary', "the ending page's button")
          clicked = true
        }
      }
      await sleep(250)
    }
  }

  get(name: string): Promise<unknown> {
    return this.js(`return window.engine.getVar(${JSON.stringify(name)}) ?? null`)
  }

  async expect(name: string, value: unknown): Promise<void> {
    const got = await this.get(name)
    if (!isDeepStrictEqual(got, value ?? null)) throw new RouteError(`${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(value)}`)
  }

  async expectEnding(id: string): Promise<void> {
    if (!this.endings.length && !(await this.waitState((s) => s.session === 'ending', 15_000))) throw new RouteError(`no ending reached (session: ${(await this.state()).session})`)
    const last = this.endings[this.endings.length - 1]
    if (last !== id) throw new RouteError(`reached ending ${JSON.stringify(last)}, expected ${JSON.stringify(id)}`)
  }

  async screenshot(name: string): Promise<string> {
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    mkdirSync(this.opts.outDir, { recursive: true })
    const file = join(this.opts.outDir, `${name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }

  /** Play a route written as steps. */
  async steps(list: PlaytestStep[]): Promise<void> {
    for (const step of list) {
      const s = step as Record<string, unknown>
      if ('newGame' in s) await this.newGame()
      else if ('advance' in s) await this.advance(typeof s.advance === 'object' ? (s.advance as { until?: string; max?: number }) : {})
      else if ('choose' in s) await this.choose(s.choose as string | number)
      else if ('click' in s) await this.click(String(s.click))
      else if ('button' in s) await this.button(String(s.button))
      else if ('press' in s) await this.press(String(s.press))
      else if ('type' in s) await this.type(String(s.type), { submit: s.submit !== false })
      else if ('expect' in s) await this.expect(String(s.expect), s.equals)
      else if ('playToEnd' in s) await this.playToEnd(typeof s.playToEnd === 'object' ? (s.playToEnd as { answer?: string; max?: number }) : {})
      else if ('ending' in s) await this.expectEnding(String(s.ending))
      else if ('toTitle' in s) await this.toTitle()
      else if ('wait' in s) await this.wait(Number(s.wait))
      else if ('screenshot' in s) await this.screenshot(String(s.screenshot))
      else throw new RouteError(`unknown step ${JSON.stringify(step)}`)
    }
  }
}
