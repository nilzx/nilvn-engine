// @vitest-environment jsdom
// The built-in title and ending pages (batch G inc 3): drawn by the DOM
// renderer from a model the engine builds out of `[title]` / `[ending.<id>]`,
// the chrome strings (overridable per work) and the session — and the autosave
// behind the title page's Continue.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, AUTOSAVE_KEY, titleModel, isSlotPayload } from '../src/index'
import { applyConfig } from '../src/config'
import type { ChromeHost } from '../src/chrome'
import type { SlotPayload } from '../src/save-store'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

const tick = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms))
const box = (): HTMLElement => document.createElement('div')
const screen = (root: HTMLElement, id: string): HTMLElement | null => root.querySelector<HTMLElement>(`.nilvn-screen--${id}`)
const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLButtonElement>('.nilvn-screen__button')].map((b) => `${b.dataset.id}:${b.textContent}`)
const button = (el: HTMLElement, id: string): HTMLButtonElement => el.querySelector<HTMLButtonElement>(`.nilvn-screen__button[data-id="${id}"]`)!

describe('the title page', () => {
  it('shows the work title and New game; Continue only when an autosave exists', async () => {
    const store = new MemorySaveStore()
    const engine = createEngine({ container: box(), saveStore: store, buildInfo: 'studio 1.2.3' })
    applyConfig(engine, { game: { title: 'Borrowed Stars' } })
    engine.loadSource('[label s]\nyuki: hi\n')
    await engine.showTitle()
    const el = screen(engine.stage.root, 'title')!
    expect(el.querySelector('.nilvn-screen__heading')!.textContent).toBe('Borrowed Stars')
    expect(buttons(el)).toEqual(['new:New game'])
    expect(el.querySelector('.nilvn-screen__version')!.textContent).toBe('studio 1.2.3')
    await store.set(AUTOSAVE_KEY, { v: 1, savedAt: 1, preview: '', state: engine.saveState() })
    await engine.showTitle()
    expect(buttons(screen(engine.stage.root, 'title')!)).toEqual(['new:New game', 'continue:Continue'])
    engine.destroy()
  })

  it('New game starts a fresh run and the page goes away; the stage click never reaches the story', async () => {
    const engine = createEngine({ container: box() })
    engine.loadSource('[label s]\n[set x = 1]\nyuki: hi\n')
    await engine.showTitle()
    const el = screen(engine.stage.root, 'title')!
    let stageTaps = 0
    engine.stage.root.addEventListener('click', () => stageTaps++)
    el.click() // a click on the page itself is swallowed
    expect(stageTaps).toBe(0)
    button(el, 'new').click()
    await tick()
    expect(engine.session).toBe('playing')
    expect(engine.stage.chrome.currentScreen()).toBeNull()
    expect(engine.vars).toEqual({ x: 1 })
    engine.destroy()
  })

  it('Continue restores the autosave the story wrote at its labels', async () => {
    const store = new MemorySaveStore()
    const a = createEngine({ container: box(), saveStore: store })
    a.loadSource('[label s]\n[set x = 1]\n[label two]\n[set y = 2]\nyuki: hi\n')
    void a.start()
    await tick()
    const auto = (await store.get(AUTOSAVE_KEY)) as SlotPayload
    expect(isSlotPayload(auto)).toBe(true)
    expect(auto.state.at.label).toBe('two')
    a.destroy()
    const b = createEngine({ container: box(), saveStore: store })
    b.loadSource('[label s]\n[set x = 1]\n[label two]\n[set y = 2]\nyuki: hi\n')
    await b.showTitle()
    button(screen(b.stage.root, 'title')!, 'continue').click()
    await tick()
    expect(b.session).toBe('playing')
    expect(b.vars).toEqual({ x: 1, y: 2 })
    b.destroy()
  })

  it('autosave can be per line or off', async () => {
    const store = new MemorySaveStore()
    const a = createEngine({ container: box(), saveStore: store, saves: { autosave: false } })
    a.loadSource('[label s]\nyuki: hi\n')
    void a.start()
    await tick()
    expect(await store.get(AUTOSAVE_KEY)).toBeUndefined()
    a.destroy()
    const b = createEngine({ container: box(), saveStore: store, saves: { autosave: 'line' }, textSpeed: 0 }) // instant reveal: the line autosave lands once the line is shown
    b.loadSource('[label s]\nyuki: hi\n')
    void b.start()
    await tick()
    expect(((await store.get(AUTOSAVE_KEY)) as SlotPayload).preview).toBe('yuki: hi')
    b.destroy()
  })

  it('config: heading / subtitle / logo / background / layout / buttons / version; unknown buttons are reported', async () => {
    const engine = createEngine({ container: box(), buildInfo: 'v9', alias: { '@ui': 'assets/ui' } })
    applyConfig(engine, {
      game: { title: 'Work' },
      title: { heading: 'Custom', subtitle: 'sub', logo: '@ui/logo.png', background: '@ui/bg.png', layout: 'left', buttons: ['new', 'bogus'], version: false },
    })
    engine.loadSource('[label s]\n')
    await engine.showTitle()
    const el = screen(engine.stage.root, 'title')!
    expect(el.classList.contains('nilvn-screen--left')).toBe(true)
    expect(el.querySelector('.nilvn-screen__heading')!.textContent).toBe('Custom')
    expect(el.querySelector('.nilvn-screen__subtitle')!.textContent).toBe('sub')
    expect(el.querySelector<HTMLImageElement>('.nilvn-screen__logo')!.src).toContain('assets/ui/logo.png')
    expect(el.style.getPropertyValue('--screen-bg')).toContain('assets/ui/bg.png')
    expect(el.querySelector('.nilvn-screen__version')).toBeNull()
    expect(engine.diagnostics.some((d) => d.message.includes('unknown button "bogus"'))).toBe(true)
    engine.destroy()
  })

  it('a colour background stays a colour; @key headings resolve through the catalogs', async () => {
    const engine = createEngine({ container: box(), catalogs: { en: { 'title.h': 'Resolved' } }, lang: 'en' })
    applyConfig(engine, { title: { heading: '@title.h', background: '#102030' } })
    engine.loadSource('[label s]\n')
    await engine.showTitle()
    const el = screen(engine.stage.root, 'title')!
    expect(el.querySelector('.nilvn-screen__heading')!.textContent).toBe('Resolved')
    expect(el.style.getPropertyValue('--screen-bg')).toBe('#102030')
    engine.destroy()
  })
})

describe('the ending page', () => {
  it('[end] shows the default ending with the chrome title and both buttons', async () => {
    const engine = createEngine({ container: box() })
    engine.loadSource('[label s]\n[end 0]\n')
    await engine.start()
    const el = screen(engine.stage.root, 'ending')!
    expect(el.querySelector('.nilvn-screen__heading')!.textContent).toBe('The End')
    expect(buttons(el)).toEqual(['title:Back to title', 'restart:Play again'])
    button(el, 'restart').click()
    await tick()
    expect(engine.session).toBe('ending') // restart replayed the script to its [end] again
    expect(screen(engine.stage.root, 'ending')).not.toBeNull()
    button(screen(engine.stage.root, 'ending')!, 'title').click()
    await tick()
    expect(engine.session).toBe('title')
    expect(screen(engine.stage.root, 'title')).not.toBeNull()
    engine.destroy()
  })

  it('[ending id] picks that ending\'s config; credits roll and `after = title` returns when they end', async () => {
    const engine = createEngine({ container: box() })
    applyConfig(engine, {
      ending: {
        true_end: { heading: 'True End', subtitle: 'thanks', credits: 'Writer — A\nArt — B', after: 'title', creditsDuration: 3 },
        default: { heading: 'Bad End', buttons: false },
      },
    })
    engine.loadSource('[label s]\n[ending true_end sec=0]\n')
    await engine.start()
    const el = screen(engine.stage.root, 'ending')!
    expect(el.querySelector('.nilvn-screen__heading')!.textContent).toBe('True End')
    const roll = el.querySelector<HTMLElement>('.nilvn-screen__roll')!
    expect(roll.textContent).toBe('Writer — A\nArt — B')
    expect(roll.style.getPropertyValue('--roll-duration')).toBe('3s')
    roll.dispatchEvent(new Event('animationend'))
    await tick()
    expect(engine.session).toBe('title')
    engine.loadSource('[label s]\n[end 0]\n')
    await engine.start()
    const def = screen(engine.stage.root, 'ending')!
    expect(def.querySelector('.nilvn-screen__heading')!.textContent).toBe('Bad End')
    expect(buttons(def)).toEqual([])
    engine.destroy()
  })
})

describe('strings, screens off, language', () => {
  it('a work overrides chrome strings through messages or [strings]; the page follows a language switch', async () => {
    const engine = createEngine({ container: box(), saveStore: new MemorySaveStore(), catalogs: { en: {}, zh: {} }, lang: 'en', messages: { en: { 'ui.title.new': 'Begin' } } })
    applyConfig(engine, { strings: { zh: { 'ui.title.new': '开局' } } })
    engine.loadSource('[label s]\n')
    await engine.showTitle()
    expect(buttons(screen(engine.stage.root, 'title')!)).toEqual(['new:Begin'])
    await engine.setLanguage('zh')
    await tick()
    expect(buttons(screen(engine.stage.root, 'title')!)).toEqual(['new:开局'])
    expect(engine.t('ui.ending.title')).toBe('完')
    engine.destroy()
  })

  it('screens: false leaves the states without pages; [title] enabled = false and per-ending enabled = false do the same', async () => {
    const a = createEngine({ container: box(), screens: false })
    a.loadSource('[label s]\n[end 0]\n')
    await a.showTitle()
    expect(a.session).toBe('title')
    expect(a.stage.chrome.currentScreen()).toBeNull()
    await a.start()
    expect(a.session).toBe('ending')
    expect(a.stage.chrome.currentScreen()).toBeNull()
    a.destroy()
    const b = createEngine({ container: box() })
    applyConfig(b, { title: { enabled: false }, ending: { default: { enabled: false } } })
    b.loadSource('[label s]\n[end 0]\n')
    await b.showTitle()
    expect(b.stage.chrome.currentScreen()).toBeNull()
    await b.start()
    expect(b.stage.chrome.currentScreen()).toBeNull()
    b.destroy()
  })

  it('plugins read the engine strings (and a work\'s overrides) through ctx.t', async () => {
    let seen = ''
    const engine = createEngine({
      container: box(),
      messages: { en: { 'ui.title.continue': 'Resume' } },
      plugins: [
        {
          id: 'test.t',
          activate: (ctx) => {
            seen = `${ctx.t('ui.title.new')}/${ctx.t('ui.title.continue')}`
          },
        },
      ],
    })
    expect(seen).toBe('New game/Resume')
    engine.destroy()
  })
})

describe('titleModel', () => {
  it('is pure: buttons come from the host actions, unknown ids are returned, not thrown', () => {
    const calls: string[] = []
    const host: ChromeHost = {
      t: (id) => id,
      text: (s) => s,
      resolve: (p) => `r:${p}`,
      workTitle: 'W',
      buildInfo: 'b',
      hasContinue: true,
      actions: { newGame: () => calls.push('new'), continueGame: () => calls.push('continue'), toTitle: () => calls.push('title'), restart: () => calls.push('restart') },
    }
    const { model, unknownButtons } = titleModel({ buttons: ['continue', 'new', 'load', 'nope'] }, host)
    expect(model.buttons.map((b) => b.id)).toEqual(['continue', 'new']) // load needs an `open` action (inc 4)
    expect(unknownButtons).toEqual(['nope'])
    model.buttons[1]!.onSelect()
    expect(calls).toEqual(['new'])
    expect(model.heading).toBe('W')
    expect(model.version).toBe('b')
  })
})
