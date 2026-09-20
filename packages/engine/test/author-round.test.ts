// @vitest-environment jsdom
// Feedback round two (the docs-only author round, 2026-09-21): the fixes for
// what an author hit writing against the public docs alone — scripts in a
// folder, `has()` on strings, `[hotspot] if=` with spaces, a language switch
// on a `{p}` page, panels before the first `[set]`, list items through the
// catalogs, missing images, `[choices timer=]`, `[title] logoWidth`, word
// wrapping and the name plate under `overflow = "page"`.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, evalExpr, parseSegments, type Engine } from '../src/index'

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
const catalogs = {
  en: { 'l.one': 'First page.{p}Second page.', 'clue.a': 'Pendant', 'ui.box': 'Box' },
  zh: { 'l.one': '第一页。{p}第二页。', 'clue.a': '坠子', 'ui.box': '盒' },
}
function engineWith(opts: Record<string, unknown> = {}): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, baseUrl: 'http://g.test/', catalogs, lang: 'en', defaultLang: 'en', languages: ['en', 'zh'], ...opts })
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
/** The characters the player can see: revealed and not on a turned page. */
const visible = (e: Engine): string =>
  [...e.stage.textEl.querySelectorAll<HTMLElement>('.nilvn-ch.on')]
    .filter((s) => !s.closest('.nilvn-off'))
    .map((s) => s.textContent)
    .join('')
const advance = (e: Engine): void => {
  e.stage.root.click()
}
const messages = (e: Engine): string[] => e.diagnostics.map((d) => d.message)

describe('paths and expressions', () => {
  it('[game] scripts in a folder leave baseUrl at the config directory (F1)', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const files: Record<string, string> = { 'http://g.test/scripts/a.nvn': 'narr: A\n[jump b]\n', 'http://g.test/scripts/b.nvn': 'narr: B\n' }
      const body = files[String(input)]
      return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 })
    })
    const e = engineWith()
    await e.loadScripts(['scripts/a.nvn', 'scripts/b.nvn'])
    expect(e.baseUrl).toBe('http://g.test/')
    expect(e.resolve('assets/bg.png')).toBe('http://g.test/assets/bg.png')
    void e.start()
    await until(() => text(e).includes('A'))
    vi.unstubAllGlobals()
    e.destroy()
  })

  it('has() on a string means "contains" (F2)', () => {
    expect(evalExpr('has("alpha,beta,gamma", "beta")', {})).toBe(true)
    expect(evalExpr('has("abcdef", "cd")', {})).toBe(true)
    expect(evalExpr('has("abc", "zz")', {})).toBe(false)
    expect(evalExpr('has(list, "b")', { list: ['a', 'b'] })).toBe(true)
  })

  it('[hotspot] if= runs to the end of the tag, spaces and all (F3)', async () => {
    const e = engineWith()
    e.loadSource('[set day = 2]\n[hotspot shop x=10 y=20 w=25 h=30 onclick="jump shop" if=day > 1]\n[hotspot gone x=1 y=1 w=1 h=1 onclick="jump shop" if=day > 5]\n[hotspot q x=1 y=1 w=1 h=1 onclick="jump shop" if="day >= 2"]\nnarr: parked\n[label shop]\nnarr: shop\n')
    void e.start()
    await until(() => text(e).includes('parked'))
    expect(e.stage.root.querySelector('.nilvn-hotspot[data-id="shop"]')).not.toBeNull()
    expect(e.stage.root.querySelector('.nilvn-hotspot[data-id="q"]')).not.toBeNull()
    expect(e.stage.root.querySelector('.nilvn-hotspot[data-id="gone"]')).toBeNull()
    e.destroy()
  })
})

describe('a language switch on a {p} page (F4)', () => {
  it('repaints the page the player is parked on and goes on from the next one', async () => {
    const e = engineWith()
    e.loadSource('@l.one\n[set done = 1]\n')
    void e.start()
    await until(() => visible(e) === 'First page.')
    await e.setLanguage('zh')
    await tick(20)
    expect(visible(e)).toBe('第一页。')
    advance(e)
    await until(() => visible(e) === '第二页。')
    await e.setLanguage('en')
    await tick(20)
    expect(visible(e)).toBe('Second page.') // parked at the end of the line: the ordinary repaint (last page)
    advance(e)
    await until(() => e.vars.done === 1)
    e.destroy()
  })

  it('a switch to a text with fewer pages parks on its last page', async () => {
    const e = engineWith({ catalogs: { en: { 'l.one': 'One.{p}Two.{p}Three.' }, zh: { 'l.one': '一。' } } })
    e.loadSource('@l.one\n[set done = 1]\n')
    void e.start()
    await until(() => visible(e) === 'One.')
    advance(e)
    await until(() => visible(e) === 'Two.')
    await e.setLanguage('zh')
    await tick(20)
    expect(visible(e)).toBe('一。')
    advance(e)
    await until(() => e.vars.done === 1)
    e.destroy()
  })
})

describe('panels (F6, F7, F17)', () => {
  it('draws quietly before the first [set]; list items go through the catalogs', async () => {
    const e = engineWith()
    applyConfig(e, {
      ui: {
        hud: { kind: 'hud', show: 'playing', widgets: [{ type: 'text', text: 'Found {$found}' }, { type: 'bar', var: 'heat', max: 10 }] },
        box: { kind: 'window', title: '@ui.box', show: 'always', widgets: [{ type: 'list', var: 'clues', empty: 'none' }] },
      },
    } as never)
    e.loadSource('[set found = 1]\n[set clues = "@clue.a, plain, {$found} found"]\nnarr: hi\n')
    void e.start()
    await until(() => text(e).includes('hi'))
    expect(messages(e).filter((m) => m.includes('not defined'))).toEqual([])
    expect(e.stage.root.querySelector('.nilvn-ui__text')?.textContent).toBe('Found 1')
    expect([...e.stage.root.querySelectorAll('.nilvn-ui__list li')].map((li) => li.textContent)).toEqual(['Pendant', 'plain', '1 found'])
    await e.setLanguage('zh')
    expect([...e.stage.root.querySelectorAll('.nilvn-ui__list li')].map((li) => li.textContent)).toEqual(['坠子', 'plain', '1 found'])
    e.destroy()
  })

  it('a manual panel shown in play is gone on the title page an ending returns to', async () => {
    const e = engineWith()
    applyConfig(e, {
      ui: { box: { kind: 'window', title: '@ui.box', show: 'manual', widgets: [{ type: 'text', text: 'x' }] } },
      ending: { fin: { after: 'title', credits: ['a'], creditsDuration: 0.01 } },
    } as never)
    e.loadSource('[ui show box]\nnarr: hi\n[ending fin]\n')
    void e.start()
    await until(() => text(e).includes('hi'))
    const panel = e.stage.root.querySelector<HTMLElement>('.nilvn-ui[data-id="box"], .nilvn-ui__window, .nilvn-ui')!
    expect(panel.style.display).toBe('')
    advance(e)
    await until(() => e.session === 'ending')
    e.stage.root.querySelector('.nilvn-screen__roll')!.dispatchEvent(new Event('animationend')) // jsdom runs no CSS animation
    await until(() => e.session === 'title')
    expect(panel.style.display).toBe('none')
    e.destroy()
  })
})

describe('images and chrome (F9, F13, F5, F18)', () => {
  it('an image that fails to load is a diagnostic', async () => {
    const e = engineWith()
    e.loadSource('narr: hi\n')
    void e.start()
    await until(() => text(e).includes('hi'))
    await e.stage.showChar('k', 'http://g.test/missing.png')
    e.stage.root.querySelector('.nilvn-char img')!.dispatchEvent(new Event('error'))
    expect(messages(e)).toContain('sprite of "k": image failed to load — http://g.test/missing.png')
    e.destroy()
  })

  it('[title] logoWidth sizes the logo', async () => {
    const e = engineWith()
    applyConfig(e, { title: { logo: 'logo.svg', logoWidth: '40cqw' } } as never)
    await e.showTitle()
    expect(e.stage.root.querySelector<HTMLElement>('.nilvn-screen__logo')?.style.width).toBe('40cqw')
    applyConfig(e, { title: { logo: 'logo.svg', logoWidth: 200 } } as never)
    await e.showTitle()
    expect(e.stage.root.querySelector<HTMLElement>('.nilvn-screen__logo')?.style.width).toBe('200px')
    e.destroy()
  })

  it('Latin words are wrapped as words, CJK per character; pages hide through the wrappers', async () => {
    const e = engineWith()
    e.stage.setLine(parseSegments('On that door, 你好'))
    const words = [...e.stage.textEl.querySelectorAll('.nilvn-word')].map((w) => w.textContent)
    expect(words).toEqual(['On', 'that', 'door,'])
    expect([...e.stage.textEl.children].filter((c) => c.classList.contains('nilvn-ch')).map((c) => c.textContent)).toEqual([' ', ' ', ' ', '你', '好'])
    e.loadSource('narr: ab cd{p}ef gh\n[set done = 1]\n')
    void e.start()
    await until(() => visible(e) === 'ab cd')
    advance(e)
    await until(() => visible(e) === 'ef gh')
    expect([...e.stage.textEl.querySelectorAll('.nilvn-word.nilvn-off')].map((w) => w.textContent)).toEqual(['ab', 'cd'])
    e.destroy()
  })

  it('overflow = "page" clips the text box, not the dialog (the name plate hangs outside)', () => {
    const e = engineWith()
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    expect(css).toContain('.nilvn-dialog--fixed .nilvn-text{height:100%;overflow:hidden}')
    expect(css).not.toContain('.nilvn-dialog--fixed{height:var(--nilvn-dialog-height);overflow:hidden}')
    e.destroy()
  })
})

describe('[choices timer=] (F12)', () => {
  it('overrides the config timer for the next prompt only; 0 turns it off', async () => {
    const e = engineWith()
    applyConfig(e, { choices: { timer: 0.05, timerDefault: 1 } } as never)
    e.loadSource('[choices timer=0]\n[choice A -> a]\n[choice B -> b]\n[label a]\nnarr: A\n[choices default=2 timer=0.05]\n[choice C -> c]\n[choice D -> d]\n[label c]\nnarr: C\n[end]\n[label d]\nnarr: D\n[end]\n[label b]\nnarr: B\n[end]\n')
    void e.start()
    await until(() => e.stage.root.querySelectorAll('.nilvn-choice').length === 2)
    await tick(150)
    expect(e.stage.root.querySelectorAll('.nilvn-choice').length).toBe(2) // no timer: still waiting
    e.stage.root.querySelector<HTMLButtonElement>('.nilvn-choice')!.click()
    await until(() => text(e).includes('A'))
    advance(e)
    await until(() => text(e).includes('D')) // the second prompt: timer 0.05, default 2
    e.destroy()
  })
})

describe('a click that moves the playhead while a line is still typing', () => {
  it('drops the line and plays on from the target at once (no extra tap)', async () => {
    const e = engineWith({ textSpeed: 20 })
    e.loadSource('[label start]\nnarr: A rather long line that takes a while to type out fully.\nnarr: never\n[label shop]\nnarr: shop\n')
    void e.start()
    await until(() => e.stage.textEl.querySelectorAll('.nilvn-ch.on').length > 3)
    await e.runInline('[jump shop]', 'hotspot')
    await until(() => visible(e) === 'shop')
    expect(text(e)).toBe('shop')
    expect(messages(e)).toEqual([])
    e.destroy()
  })
})
