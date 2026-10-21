// @vitest-environment jsdom
// The default runtime chrome (0.20 "soft dark"): one scale of tokens, line icons
// instead of glyphs, pages as cards, and states (hover / focus-visible / active /
// disabled) everywhere. Plus the two layering bugs a real run in the editor
// showed: the stage did not contain its own z-indexes, and a top-right HUD sat
// on a fixed offset that a bigger ☰ (or a ☰ on another corner) did not match.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, windowTheme, THEME_TOKENS, type Engine } from '../src/index'
import { DomRenderer } from '../src/stage'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {} })
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}
const baseCss = (): string => {
  new DomRenderer(document.createElement('div'))
  return document.getElementById('nilvn-base-style')!.textContent!
}
/** Every `selector { body }` rule of the sheet (rules inside an at-rule included). */
const rules = (css: string): { sel: string; body: string }[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }))
const decl = (css: string, selector: string, prop: string): string | undefined => {
  const r = rules(css).filter((x) => x.sel === selector).reverse().find((x) => x.body.split(';').some((d) => d.split(':')[0]!.trim() === prop))
  return r?.body.split(';').map((d) => d.split(':')).find(([p]) => p!.trim() === prop)?.slice(1).join(':').trim()
}

describe('stacking', () => {
  it('the stage root is its own stacking context, so its layers never paint over the host page', () => {
    // The bug: `.nilvn-root` set no z-index and `container-type` no longer
    // implies containment, so the screens layer (z-index 40) and the panels in
    // it competed with the host's own stacking — in the editor, the canvas
    // engine's HUD drew over the game preview's title and settings pages.
    expect(decl(baseCss(), '.nilvn-root', 'isolation')).toBe('isolate')
  })

  it('panels sit under the menu dropdown, the system pages, the toast and the modals', async () => {
    const css = baseCss()
    const z = (sel: string): number => Number(decl(css, sel, 'z-index'))
    expect(z('.nilvn-ui')).toBeLessThan(z('.nilvn-menu'))
    expect(z('.nilvn-ui--window')).toBeLessThan(z('.nilvn-menu'))
    expect(z('.nilvn-ui-dim')).toBeLessThan(z('.nilvn-menu'))
    expect(z('.nilvn-hud')).toBeLessThan(z('.nilvn-menu'))
    expect(z('.nilvn-menu')).toBeLessThan(z('.nilvn-backlog'))
    expect(z('.nilvn-backlog')).toBeLessThan(z('.nilvn-modal'))
    // …and they are siblings in one layer, so those numbers are compared at all.
    const e = engineWith()
    applyConfig(e, { ui: { hud: { kind: 'hud', anchor: 'top-right', widgets: [{ type: 'text', text: 'x' }] } } } as never)
    e.loadSource('narr: one\n')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '') === 'one')
    e.openMenu('settings')
    const hud = e.stage.root.querySelector<HTMLElement>('.nilvn-ui[data-id="hud"]')!
    const page = e.stage.root.querySelector<HTMLElement>('.nilvn-panel--settings')!
    const menu = e.stage.root.querySelector<HTMLElement>('.nilvn-menu')!
    expect(hud.parentElement).toBe(page.parentElement)
    expect(menu.parentElement).toBe(page.parentElement)
    e.destroy()
  })

  it('a [ui] HUD with show = "playing" is hidden on the title page, also after a run', async () => {
    const e = engineWith()
    applyConfig(e, { ui: { hud: { kind: 'hud', anchor: 'top-right', show: 'playing', widgets: [{ type: 'bar', var: 'trust', max: 3 }] } } } as never)
    e.loadSource('narr: one\n')
    const hud = (): HTMLElement => e.stage.root.querySelector<HTMLElement>('.nilvn-ui[data-id="hud"]')!
    await e.showTitle()
    expect(hud().style.display).toBe('none')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '') === 'one')
    expect(hud().style.display).toBe('')
    await e.showTitle()
    expect(e.stage.root.querySelector('.nilvn-screen--title')).not.toBeNull()
    expect(hud().style.display).toBe('none')
    e.destroy()
  })
})

describe('the ☰ and the HUDs share the corners', () => {
  it('the root names the corner the ☰ sits in; a HUD on that corner stands beside it', () => {
    const e = engineWith()
    expect(e.stage.root.classList.contains('nilvn-root--menu-top-right')).toBe(true)
    applyConfig(e, { menu: { entry: 'top-left' } } as never)
    expect(e.stage.root.classList.contains('nilvn-root--menu-top-right')).toBe(false)
    expect(e.stage.root.classList.contains('nilvn-root--menu-top-left')).toBe(true)
    applyConfig(e, { menu: { enabled: false } } as never)
    expect([...e.stage.root.classList].filter((c) => c.startsWith('nilvn-root--menu-'))).toEqual([])
    e.destroy()
    // The offset is the ☰'s own size plus the gaps — no fixed `8cqw` that a
    // floor-sized ☰ on a small stage would outgrow.
    const css = baseCss()
    const right = rules(css).find((r) => r.sel.startsWith('.nilvn-root--menu-top-right'))!
    expect(right.sel).toContain('.nilvn-ui--top-right')
    expect(right.sel).toContain('.nilvn-hud--top-right')
    expect(right.body).toContain('var(--nilvn-menu-button-size)')
    expect(decl(css, '.nilvn-root--menu-top-left :is(.nilvn-ui--top-left,.nilvn-hud--top-left)', 'left')).toContain('var(--nilvn-menu-button-size)')
    expect(css).not.toMatch(/right:8cqw|bottom:30cqh/)
  })

  it('bottom-anchored things clear the dialogue box through one token; a box at the top frees the bottom', () => {
    const css = baseCss()
    for (const sel of ['.nilvn-toast', '.nilvn-hud--bottom-left', '.nilvn-choices--bottom']) expect(rules(css).find((r) => r.sel === sel)!.body).toContain('var(--nilvn-dialog-clearance)')
    expect(windowTheme({ position: 'top' }, (p) => p).tokens['dialog-clearance']).toBe('var(--nilvn-space-m)')
    expect(windowTheme({ skin: 'box.png' }, (p) => p).tokens['dialog-shadow']).toBe('none')
  })
})

describe('states', () => {
  const INTERACTIVE = ['.nilvn-choice', '.nilvn-menu__btn', '.nilvn-menu__item', '.nilvn-menu__seg button', '.nilvn-menu__seg .nilvn-menu__key', '.nilvn-saves__slot', '.nilvn-saves__page', '.nilvn-saves__del', '.nilvn-backlog__close', '.nilvn-backlog__voice', '.nilvn-screen__button', '.nilvn-ui__close', '.nilvn-ui .nilvn-ui__button', '.nilvn-replays__card']

  it('every control shows keyboard focus: one focus ring for the stage, no rule turns it off', () => {
    const css = baseCss()
    expect(decl(css, '.nilvn-root :is(button,input,textarea,select,[tabindex]):focus-visible', 'outline')).toBe('var(--nilvn-focus-ring)')
    for (const r of rules(css)) if (/:focus-visible/.test(r.sel) && !/nilvn-modal__input|:not\(:focus-visible\)/.test(r.sel)) expect(r.body, r.sel).not.toMatch(/outline:\s*none/)
    // …and focus looks like hover on each one (the focused control is the one a key presses).
    for (const sel of INTERACTIVE) {
      const hit = rules(css).some((r) => r.sel.split(',').some((s) => s.startsWith(sel) && s.includes(':focus-visible')))
      expect(hit, `${sel}:focus-visible`).toBe(true)
    }
  })

  it('hover, pressed and disabled states are drawn, and disabled is a colour, not an opacity', () => {
    const css = baseCss()
    for (const sel of INTERACTIVE) expect(rules(css).some((r) => r.sel.split(',').some((s) => s.startsWith(sel) && s.includes(':hover'))), `${sel}:hover`).toBe(true)
    for (const sel of ['.nilvn-choice', '.nilvn-menu__btn', '.nilvn-menu__item', '.nilvn-screen__button', '.nilvn-saves__slot', '.nilvn-backlog__close']) expect(rules(css).some((r) => r.sel.startsWith(sel) && r.sel.includes(':active')), `${sel}:active`).toBe(true)
    for (const r of rules(css)) if (/:disabled|is-disabled|\.nilvn-saves__slot\b/.test(r.sel)) expect(r.body, r.sel).not.toMatch(/(^|;)opacity:/)
    expect(decl(css, '.nilvn-menu__item:disabled', 'color')).toBe('var(--nilvn-disabled)')
    expect(decl(css, '.nilvn-screen__button:disabled', 'color')).toBe('var(--nilvn-disabled)')
  })

  it('reduced motion stops the blinking indicator, the lifts and the panel effects, and keeps the credits readable', () => {
    const css = baseCss()
    const at = css.indexOf('@media (prefers-reduced-motion:reduce)')
    expect(at).toBeGreaterThan(-1)
    const block = css.slice(at)
    for (const s of ['.nilvn-indicator.on{animation:none}', '--nilvn-duration:0s', '.nilvn-ui--opening,.nilvn-ui--closing{animation:none!important}', '.nilvn-screen__roll{position:static;animation-name:nilvn-roll-still}']) expect(block).toContain(s)
    expect(css).not.toContain('scale(1.02)') // no blurry scaled text on a hovered option
  })

  it('text and tap targets have a px floor on a small stage', () => {
    for (const k of ['text-size', 'name-size', 'choice-size', 'hud-size', 'input-size', 'font-size-s', 'font-size-m', 'font-size-l', 'control-height', 'menu-button-size']) expect(THEME_TOKENS[k], k).toMatch(/^max\(\d+(\.\d+)?px, /)
  })
})

describe('icons and pages', () => {
  it('draws line icons, never glyphs: the ☰, a page close, the delete, the voice, the replay badges', async () => {
    const e = engineWith()
    e.loadSource('narr: one\n')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '') === 'one')
    const btn = e.stage.root.querySelector<HTMLButtonElement>('.nilvn-menu__btn')!
    expect(btn.textContent).toBe('')
    expect(btn.querySelector('svg.nilvn-icon--menu')).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toBe(e.t('ui.menu.title'))
    await e.writeSave('slot:0')
    e.openMenu('saves')
    await until(() => !!e.stage.root.querySelector('.nilvn-saves__del'))
    const del = e.stage.root.querySelector<HTMLButtonElement>('.nilvn-saves__del')!
    expect(del.textContent).toBe('')
    expect(del.querySelector('svg.nilvn-icon--trash')).not.toBeNull()
    expect(del.getAttribute('aria-label')).toBe(e.t('ui.saves.delete'))
    const close = e.stage.root.querySelector<HTMLButtonElement>('.nilvn-panel--saves .nilvn-backlog__close')!
    expect(close.querySelector('svg.nilvn-icon--close')).not.toBeNull()
    expect(close.getAttribute('aria-label')).toBe(e.t('ui.menu.close'))
    e.destroy()
  })

  it('a menu item keeps its icon across a language switch; the menu is a grid of tiles', async () => {
    const e = engineWith({ lang: 'en', defaultLang: 'en', languages: ['en', 'zh'], catalogs: { en: {}, zh: {} } })
    e.loadSource('narr: one\n')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '') === 'one')
    const save = (): HTMLButtonElement => e.stage.root.querySelector<HTMLButtonElement>('.nilvn-menu__panel > .nilvn-menu__item')!
    expect(save().textContent).toBe('Save')
    await e.setLanguage('zh')
    expect(save().textContent).toBe(e.t('ui.menu.save'))
    expect(save().querySelectorAll('svg.nilvn-icon--save')).toHaveLength(1)
    expect(decl(baseCss(), '.nilvn-menu.on .nilvn-menu__panel', 'display')).toBe('grid')
    e.destroy()
  })

  it('a system page is a card on a backdrop; its slots say whether they are empty; settings come in sections', async () => {
    const e = engineWith()
    e.loadSource('narr: one\n')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '') === 'one')
    await e.writeSave('slot:1')
    e.openMenu('load')
    await until(() => !!e.stage.root.querySelector('.nilvn-saves__slot.has-data'))
    const page = e.stage.root.querySelector<HTMLElement>('.nilvn-panel--saves')!
    expect(page.classList.contains('nilvn-page')).toBe(true)
    expect(page.classList.contains('nilvn-saves--load')).toBe(true)
    const card = page.querySelector(':scope > .nilvn-page__card')!
    expect(card.querySelector('.nilvn-page__head .nilvn-saves__title')!.textContent).toBe(e.t('ui.menu.load'))
    expect(card.querySelector('.nilvn-saves__body.nilvn-page__body')).not.toBeNull()
    expect(page.querySelectorAll('.nilvn-saves__slot.is-empty').length).toBeGreaterThan(0)
    e.openMenu('saves')
    await tick()
    expect(page.classList.contains('nilvn-saves--load')).toBe(false)
    e.openMenu('settings')
    const heads = [...e.stage.root.querySelectorAll('.nilvn-panel--settings .nilvn-settings__section > .nilvn-settings__head')].map((h) => h.textContent)
    expect(heads).toEqual(['Text', 'Sound', 'Display', 'Keys'])
    // a slider is the themed track around the native input; its fill follows the value
    const vol = e.stage.root.querySelector<HTMLInputElement>('.nilvn-panel--settings .nilvn-menu__vol')!
    expect(vol.parentElement!.classList.contains('nilvn-range')).toBe(true)
    vol.value = '50'
    vol.dispatchEvent(new Event('input'))
    const p = (Number(vol.value) - Number(vol.min)) / (Number(vol.max) - Number(vol.min))
    expect(Number(vol.parentElement!.style.getPropertyValue('--range-p'))).toBeCloseTo(p, 3)
    e.destroy()
  })
})

describe('a command-window list of options', () => {
  it('frames the list, aligns the text and draws a cursor from tokens whose defaults keep separate centred buttons', () => {
    expect(THEME_TOKENS['choices-list-border']).toBe('none')
    expect(THEME_TOKENS['choice-align']).toBe('center')
    expect(THEME_TOKENS['choice-cursor']).toBe('none')
    const css = baseCss()
    expect(decl(css, '.nilvn-choices__list', 'border')).toBe('var(--nilvn-choices-list-border)')
    expect(decl(css, '.nilvn-choice', 'text-align')).toBe('var(--nilvn-choice-align)')
    expect(decl(css, '.nilvn-choice::before', 'content')).toBe('var(--nilvn-choice-cursor)')
    expect(rules(css).some((r) => r.sel.includes(':focus-visible::before') && r.body.includes('visibility:visible'))).toBe(true)
    expect(decl(css, '.nilvn-root .nilvn-choices .nilvn-choice:focus-visible', 'outline')).toBe('var(--nilvn-choice-focus-ring)')
  })
})

describe('overlayOpen', () => {
  it("says when the game's own chrome holds Esc: the menu, a page", async () => {
    const e = engineWith()
    e.loadSource('Hello.\n')
    void e.start()
    await until(() => e.session === 'playing')
    expect(e.overlayOpen).toBe(false)
    e.openMenu('settings')
    expect(e.overlayOpen).toBe(true)
    e.closeMenu()
    expect(e.overlayOpen).toBe(false)
    e.destroy()
  })
})
