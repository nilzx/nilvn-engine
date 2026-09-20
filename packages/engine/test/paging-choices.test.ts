// @vitest-environment jsdom
// Batch I inc 2 — dialogue paging (`{p}`, `[window] overflow`) and the choices
// prompt's config (`[choices]` section: layout, skin, chosen / disabled looks,
// timer) plus `[choice … disabled=cond]`. jsdom lays nothing out, so overflow
// paging (measured) is covered in the browser; the explicit `{p}` path and the
// mode plumbing are pinned here.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, GLOBALS_KEY, applyConfig, choicesTheme, windowTheme, parseSegments, type Engine } from '../src/index'
import type { GlobalsPayload } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, ...opts })
}
/** The characters on screen: revealed and not paged out. */
const visible = (e: Engine): string =>
  [...e.stage.textEl.querySelectorAll<HTMLElement>('.nilvn-ch')]
    .filter((s) => s.classList.contains('on') && !s.classList.contains('nilvn-off'))
    .map((s) => s.textContent)
    .join('')
const indicator = (e: Engine): boolean => e.stage.root.querySelector('.nilvn-indicator')!.classList.contains('on')
const buttons = (e: Engine): HTMLButtonElement[] => [...e.stage.choicesEl.querySelectorAll<HTMLButtonElement>('.nilvn-choice')]

describe('{p} paging', () => {
  it('parses {p} as a page segment', () => {
    expect(parseSegments('one{p}two')).toEqual([{ kind: 'text', text: 'one' }, { kind: 'page' }, { kind: 'text', text: 'two' }])
  })

  it('types the first page, waits for a tap with the indicator, then clears it and types the next; the backlog holds the whole line', async () => {
    const e = engineWith()
    e.loadSource('yuki: First page.{p}Second{br}page.{p}Third.\nyuki: Next line.\n')
    void e.start()
    await until(() => visible(e) === 'First page.' && indicator(e))
    expect(e.getBacklog()).toHaveLength(0) // not recorded until the line is done
    e.stage.root.click()
    await until(() => visible(e) === 'Secondpage.')
    expect(e.stage.textEl.querySelector('br')!.classList.contains('nilvn-off')).toBe(false)
    e.stage.root.click()
    await until(() => visible(e) === 'Third.')
    expect(e.getBacklog().at(-1)?.text).toBe('First page.Second\npage.Third.')
    e.stage.root.click()
    await until(() => visible(e) === 'Next line.')
    e.destroy()
  })

  it('a tap while a page types reveals the page; the next tap turns it', async () => {
    const e = engineWith({ textSpeed: 5 })
    e.loadSource('yuki: Slow page one.{p}Two.\n')
    void e.start()
    await until(() => visible(e).length >= 2)
    e.stage.root.click() // reveal the rest of page one
    await until(() => visible(e) === 'Slow page one.' && indicator(e))
    e.stage.root.click()
    await until(() => visible(e) === 'Two.')
    e.destroy()
  })

  it('skip mode and auto mode turn pages by themselves', async () => {
    const e = engineWith()
    e.loadSource('yuki: A.{p}B.{p}C.\n[set done = 1]\n')
    void e.start()
    await until(() => visible(e) === 'A.')
    e.setSkipMode('all', false)
    e.setSkip(true)
    await until(() => e.vars.done === 1)
    e.destroy()
    const a = engineWith({ settings: { autoDelay: 0.02 } })
    a.loadSource('yuki: A.{p}B.\n[set done = 1]\n')
    a.setAuto(true)
    void a.start()
    await until(() => a.vars.done === 1)
    a.destroy()
  })

  it('a repaint (language switch) shows the last page only', async () => {
    const e = engineWith({ catalogs: { en: { l: 'One.{p}Two.' }, zh: { l: '一。{p}二。' } }, lang: 'en', defaultLang: 'en', languages: ['en', 'zh'] })
    e.loadSource('yuki: @l\n')
    void e.start()
    await until(() => visible(e) === 'One.')
    e.stage.root.click()
    await until(() => visible(e) === 'Two.')
    await e.setLanguage('zh')
    expect(visible(e)).toBe('二。')
    e.destroy()
  })

  it('[window] overflow switches the box to a fixed height; shrink resets the font on the way back; a bad value is reported', () => {
    const e = engineWith()
    const dialog = e.stage.root.querySelector('.nilvn-dialog')!
    applyConfig(e, { window: { overflow: 'page' } })
    expect(dialog.classList.contains('nilvn-dialog--fixed')).toBe(true)
    applyConfig(e, { window: { overflow: 'shrink' } })
    expect(dialog.classList.contains('nilvn-dialog--fixed')).toBe(true)
    applyConfig(e, { window: { overflow: 'grow' } })
    expect(dialog.classList.contains('nilvn-dialog--fixed')).toBe(false)
    expect(windowTheme({ overflow: 'huge' as never }, (p) => p).unknown).toEqual(['overflow=huge'])
    applyConfig(e, { window: { overflow: 'huge' as never } })
    expect(e.diagnostics.some((d) => d.message.includes('[window] unknown key "overflow=huge"'))).toBe(true)
    e.destroy()
  })
})

describe('choices: disabled, chosen, layout, timer', () => {
  it('disabled= greys an option and ignores its click; an all-disabled prompt is re-enabled with a diagnostic', async () => {
    const e = engineWith()
    e.loadSource('[set locked = 1]\n[choice Locked -> a disabled=locked == 1]\n[choice Open -> b disabled=locked == 2]\n[label a]\n[set x = 1]\n[label b]\n[set x = 2]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    expect(buttons(e)[0]!.disabled).toBe(true)
    expect(buttons(e)[1]!.disabled).toBe(false)
    buttons(e)[0]!.click()
    await tick(30)
    expect(e.vars.x).toBeUndefined()
    buttons(e)[1]!.click()
    await until(() => e.vars.x === 2)
    e.loadSource('[choice A -> a disabled=true]\n[choice B -> b disabled=true]\n[label a]\n[label b]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    expect(buttons(e).every((b) => !b.disabled)).toBe(true)
    expect(e.diagnostics.some((d) => d.message.includes('every option of this prompt is disabled'))).toBe(true)
    e.destroy()
  })

  it('chosenStyle = "dim" marks options taken in an earlier run (sys.chosen)', async () => {
    const store = new MemorySaveStore()
    await store.set(GLOBALS_KEY, { v: 1, vars: { 'sys.chosen': ['a'] } } satisfies GlobalsPayload)
    const e = engineWith({}, store)
    e.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[label b]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    expect(buttons(e).map((b) => b.classList.contains('chosen'))).toEqual([false, false]) // default: none
    e.destroy()
    const d = engineWith({}, store)
    applyConfig(d, { choices: { chosenStyle: 'dim' } })
    d.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[label b]\n')
    void d.start()
    await until(() => buttons(d).length === 2)
    expect(buttons(d).map((b) => b.classList.contains('chosen'))).toEqual([true, false])
    d.destroy()
  })

  it('the [choices] section sets position / layout classes, tokens and the skin; unknown keys are reported', async () => {
    const e = engineWith()
    applyConfig(e, { choices: { position: 'bottom', layout: 'grid', columns: 3, width: '30cqw', skin: '@ui/btn.png', slice: 12, chosenColor: '#888888', bogus: 1, timer: -1 } as never })
    expect(e.stage.choicesEl.classList.contains('nilvn-choices--bottom')).toBe(true)
    expect(e.theme).toMatchObject({ 'choice-width': '30cqw', 'choice-bg': 'transparent', 'choice-border': 'none', 'choice-skin': 'none', 'choice-chosen-color': '#888888' })
    expect(e.theme['choice-skin-slice']).toMatch(/btn\.png"\) 12 fill \/ 12px stretch$/)
    expect(e.diagnostics.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringContaining('[choices] unknown key "bogus"'), expect.stringContaining('timer=-1')]))
    e.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[label b]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    const list = e.stage.choicesEl.querySelector<HTMLElement>('.nilvn-choices__list')!
    expect(list.classList.contains('nilvn-choices__list--grid')).toBe(true)
    expect(list.style.getPropertyValue('--choices-columns')).toBe('3')
    e.destroy()
    expect(choicesTheme({ position: 'middle' as never, layout: 'row' as never, slice: 2 }, (p) => p).unknown).toEqual(['position=middle', 'layout=row', 'slice (needs skin)'])
  })

  it('timer picks timerDefault (1-based) when the player does nothing, skipping a disabled default; a pick clears it', async () => {
    const e = engineWith()
    applyConfig(e, { choices: { timer: 0.05, timerDefault: 2 } })
    e.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[set x = 1]\n[end 0]\n[label b]\n[set x = 2]\n[end 0]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    expect(e.stage.choicesEl.querySelector('.nilvn-choices__timer')).not.toBeNull()
    await until(() => e.vars.x === 2)
    e.loadSource('[choice A -> a]\n[choice B -> b disabled=true]\n[label a]\n[set x = 1]\n[end 0]\n[label b]\n[set x = 2]\n[end 0]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    await until(() => e.vars.x === 1) // default 2 is disabled → the first enabled one
    e.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[set x = 1]\n[end 0]\n[label b]\n[set x = 2]\n[end 0]\n')
    void e.start()
    await until(() => buttons(e).length === 2)
    buttons(e)[0]!.click()
    await until(() => e.vars.x === 1)
    await tick(80)
    expect(e.vars.x).toBe(1) // the timer did not fire after the pick
    e.destroy()
  })
})
