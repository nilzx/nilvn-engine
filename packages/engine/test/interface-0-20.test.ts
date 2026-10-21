// @vitest-environment jsdom
// Engine 0.20 "interface gaps" (batch K7a): reconfigure() on a live engine, a
// silent engine, the editor's panel preview, `sys.*` settings variables and the
// play time, [menu open|close], the slider widget, skins (name tag, menu button,
// system pages, a panel, a button), a window's free layout, disabled / close /
// dim / open / dir, button keys, and panels as the recordable objects `ui:<id>`.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, THEME_TOKENS, SETTINGS_KEY, type Engine } from '../src/index'
import type { AdvConfig, EngineOptions } from '../src/types'
import type { SettingsPayload } from '../src/save-store'

let plays = 0
beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {} })
  ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => {
      plays++
      return Promise.resolve()
    },
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})
beforeEach(() => {
  plays = 0
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Partial<EngineOptions> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
const panel = (e: Engine, id: string): HTMLElement => e.stage.root.querySelector<HTMLElement>(`.nilvn-ui[data-id="${id}"]`)!
const shown = (e: Engine, id: string): boolean => !!e.stage.root.querySelector(`.nilvn-ui[data-id="${id}"]`) && panel(e, id).style.display !== 'none'
const messages = (e: Engine): string[] => e.diagnostics.map((d) => d.message)
const key = (k: string, init: KeyboardEventInit = {}): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...init }))
const menuPage = (e: Engine, id: string): HTMLElement | null => e.stage.root.querySelector<HTMLElement>(`.nilvn-panel--${id}.on`)

describe('engine.reconfigure', () => {
  it('re-applies the presentation sections from the construction values: a dropped key falls back, the rest is untouched', () => {
    const e = engineWith({ theme: { accent: '#111111' } })
    applyConfig(e, {
      game: { title: 'Kept' },
      macros: { m: 'set x = 1' },
      theme: { 'name-bg': '#ff0000' },
      window: { textSize: '5cqh', overflow: 'page' },
      choices: { position: 'top', chosenStyle: 'dim' },
      menu: { entry: 'top-left' },
      settings: { autoDelay: 3 },
      strings: { en: { 'ui.title.new': 'Go' } },
    } as AdvConfig)
    e.setScriptTheme({ 'text-color': '#00ff00' })
    expect(e.theme['text-size']).toBe('5cqh')
    expect(e.autoDelay).toBe(3)
    e.reconfigure({ theme: { 'name-color': '#0000ff' }, game: { title: 'Ignored' } } as AdvConfig)
    expect(e.theme.accent).toBe('#111111') // the host's construction theme
    expect(e.theme['name-bg']).toBeUndefined()
    expect(e.theme['text-size']).toBeUndefined()
    expect(e.theme['name-color']).toBe('#0000ff')
    expect(e.theme['text-color']).toBe('#00ff00') // the script layer is left alone
    expect(e.choicesConfig).toEqual({})
    expect(e.stage.root.querySelector('.nilvn-choices--top')).toBeNull()
    expect(e.stage.dialog.classList.contains('nilvn-dialog--fixed')).toBe(false) // overflow back to grow
    expect(e.autoDelay).toBe(1.5)
    expect(e.t('ui.title.new')).toBe('New game')
    expect(e.stage.root.querySelector('.nilvn-menu')!.className).toContain('nilvn-menu--top-right')
    expect(e.config.game?.title).toBe('Kept')
    expect(e.macros.m).toBe('set x = 1')
    e.reconfigure({ menu: { bogus: 1 }, window: { wobble: 2 } } as unknown as AdvConfig)
    expect(messages(e)).toEqual(expect.arrayContaining(['config: menu.bogus: unknown key', '[window] unknown key "wobble" — ignored']))
    e.destroy()
  })

  it('an open title page repaints in place and its music carries on; a config without music stops it', async () => {
    const e = engineWith()
    applyConfig(e, { title: { heading: 'First', bgm: 'title.wav' } })
    e.loadSource('narr: x\n')
    await e.showTitle()
    await until(() => e.stage.root.querySelector('.nilvn-screen__heading')?.textContent === 'First')
    expect(plays).toBe(1)
    e.reconfigure({ title: { heading: 'Second', bgm: 'title.wav' } })
    await until(() => e.stage.root.querySelector('.nilvn-screen__heading')?.textContent === 'Second')
    expect(plays).toBe(1) // not restarted
    expect(e.saveState().tracks?.map((t) => t.track)).toEqual(['bgm'])
    e.reconfigure({ title: { heading: 'Third' } })
    await until(() => e.stage.root.querySelector('.nilvn-screen__heading')?.textContent === 'Third')
    expect(e.saveState().tracks).toBeUndefined()
    e.destroy()
  })

  it('rebuilds the menu with its open page still open; panels keep their decisions and poses', async () => {
    const e = engineWith()
    const widgets = [{ type: 'text', text: 'old' }]
    applyConfig(e, { ui: { a: { kind: 'window', show: 'manual', widgets }, b: { widgets } } } as AdvConfig)
    e.loadSource('narr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    e.ui.show('a')
    e.applyChannel('ui:a', 'x', 30)
    e.openMenu('settings')
    e.reconfigure({ ui: { a: { kind: 'window', show: 'manual', widgets: [{ type: 'text', text: 'new' }] } }, menu: { entry: 'bottom-left' } } as AdvConfig)
    expect(menuPage(e, 'settings')).not.toBeNull()
    expect(shown(e, 'a')).toBe(true)
    expect(panel(e, 'a').textContent).toBe('new')
    expect(panel(e, 'a').style.transform).toContain('translate(30px, 0px)')
    expect(e.stage.root.querySelector('.nilvn-ui[data-id="b"]')).toBeNull()
    expect(e.stage.objectIds()).not.toContain('ui:b')
    e.destroy()
  })
})

describe('a silent engine (audio: false)', () => {
  it('never plays a track, sound or voice; volumes, tracks and saves still read', async () => {
    const e = engineWith({ audio: false })
    e.playBgm('theme.mp3', { volume: 0.5 })
    e.playSe('door.mp3')
    e.setPendingVoice('v.mp3', 0)
    e.loadSource('narr: line\n')
    void e.start()
    await until(() => text(e) === 'line')
    expect(plays).toBe(0)
    expect(e.audioEnabled).toBe(false)
    expect(e.getVolume('bgm')).toBe(1)
    e.setVar('sys.bgmVolume', 0.3)
    expect(e.getVar('sys.bgmVolume')).toBe(0.3)
    e.destroy()
  })
})

const PREVIEW_UI = {
  hud: { widgets: [{ type: 'text', text: 'always' }, { type: 'text', text: 'gated', if: 'coins > 5' }, { type: 'button', label: 'Spend', onclick: 'set spent = 1' }] },
  win: { kind: 'window', show: 'manual', title: 'Win', widgets: [{ type: 'text', text: 'inside' }] },
}

describe('ui.preview', () => {
  it('draws exactly the listed panels whatever their policy, failing widgets as is-off, buttons inert; null restores the rules', async () => {
    const e = engineWith()
    applyConfig(e, { ui: PREVIEW_UI } as AdvConfig)
    expect(shown(e, 'hud')).toBe(false) // idle: a `playing` HUD is off
    e.ui.preview(['hud', 'win'])
    expect(shown(e, 'hud')).toBe(true)
    expect(shown(e, 'win')).toBe(true)
    const kids = [...panel(e, 'hud').querySelectorAll<HTMLElement>('[data-widget]')]
    expect(kids.map((k) => k.dataset.widget)).toEqual(['0', '1', '2'])
    expect(kids.map((k) => k.classList.contains('is-off'))).toEqual([false, true, false])
    ;(kids[2] as HTMLButtonElement).click()
    await tick()
    expect(e.vars.spent).toBeUndefined()
    e.ui.preview(['win'])
    expect(shown(e, 'hud')).toBe(false)
    e.ui.preview(null)
    expect(shown(e, 'win')).toBe(false)
    e.loadSource('narr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    expect([...panel(e, 'hud').querySelectorAll<HTMLElement>('[data-widget]')].map((k) => k.dataset.widget)).toEqual(['0', '2'])
    e.destroy()
  })
})

describe('sys.* settings variables and sys.playTime', () => {
  it('reads the player settings, writes them as the settings page does (clamped, persisted)', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    e.loadSource('[set sys.bgmVolume = 0.4]\n[set sys.sfxVolume = 2]\n[set sys.voiceVolume = -1]\n[set sys.textSpeed = 300]\n[set sys.autoDelay = 2.5]\nnarr: speed {$sys.textSpeed}\n[if sys.bgmVolume < 0.5 -> quiet]\nnarr: loud\n[label quiet]\nnarr: quiet\n')
    void e.start()
    await until(() => text(e) === 'speed 300')
    expect([e.bgmVolume, e.seVolume, e.voiceVolume, e.textSpeed, e.autoDelay]).toEqual([0.4, 1, 0, 300, 2.5])
    expect(e.scope()['sys.sfxVolume']).toBe(1)
    expect(e.globals['sys.bgmVolume']).toBeUndefined() // a setting, not a persistent variable
    await until(() => e.waitingForPlayer)
    e.stage.root.click()
    await until(() => text(e) === 'quiet')
    await tick(350)
    const saved = (await store.get(SETTINGS_KEY)) as SettingsPayload
    expect(saved.volumes?.bgm).toBe(0.4)
    expect(saved.textSpeed).toBe(300)
    e.setVar('sys.textSpeed', 'fast')
    expect(messages(e)).toContain('sys.textSpeed takes a number — "fast" ignored')
    e.destroy()
  })

  it('sys.playTime counts the seconds of play in this run, is read-only, rides in a save and comes back on load', async () => {
    const e = engineWith({ catalogs: { en: { 'ui.time': 'Played {$sys.playTime} s' } } })
    applyConfig(e, { ui: { clock: { widgets: [{ type: 'text', text: '@ui.time' }] } } } as AdvConfig)
    e.loadSource('narr: one\n[set sys.playTime = 5]\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    expect(e.getVar('sys.playTime')).toBe(0)
    const save = e.saveState()
    expect(typeof save.playTime).toBe('number')
    e.stage.root.click()
    await until(() => text(e) === 'two')
    expect(messages(e)).toContain('sys.playTime is read-only — it reports what the engine is doing')
    expect(await e.restoreState({ ...save, playTime: 125.4 })).toBe(true)
    await until(() => text(e) === 'one')
    expect(e.playTime).toBe(125)
    expect(panel(e, 'clock').textContent).toBe('Played 125 s')
    for (let i = 0; i < 60 && panel(e, 'clock').textContent !== 'Played 126 s'; i++) await tick(50)
    expect(panel(e, 'clock').textContent).toBe('Played 126 s') // the panel ticks by itself
    await e.showTitle()
    expect(e.playTime).toBe(0)
    e.destroy()
  })
})

describe('[menu open|close]', () => {
  it('opens a system page from a script or a title-page button and closes it', async () => {
    const e = engineWith()
    e.loadSource('narr: a\n[menu open settings]\nnarr: b\n[menu close]\nnarr: c\n[menu open nowhere]\nnarr: d\n')
    void e.start()
    await until(() => text(e) === 'a')
    e.stage.root.click()
    await until(() => text(e) === 'b')
    expect(menuPage(e, 'settings')).not.toBeNull()
    e.closeMenu()
    e.stage.root.click()
    await until(() => text(e) === 'c')
    expect(menuPage(e, 'settings')).toBeNull()
    e.stage.root.click()
    await until(() => text(e) === 'd')
    expect(messages(e).some((m) => m.includes('[menu] syntax: [menu open saves|load|settings|backlog|replays] / [menu close]'))).toBe(true)
    await e.showTitle()
    await e.runInline('[menu open load]', 'button')
    expect(menuPage(e, 'saves')!.querySelector('.nilvn-saves__title')!.textContent).toBe('Load')
    e.destroy()
  })

  it('previewMenu shows the entry on an idle engine, survives a reconfigure; openMenu works idle', () => {
    const e = engineWith()
    const entry = (): HTMLElement => e.stage.root.querySelector<HTMLElement>('.nilvn-menu')!
    expect(e.session).toBe('idle')
    expect(entry().style.display).toBe('none')
    e.previewMenu(true)
    expect(entry().style.display).toBe('')
    e.openMenu('backlog')
    e.reconfigure({ menu: { entry: 'bottom-right' } })
    expect(entry().style.display).toBe('')
    expect(entry().className).toContain('nilvn-menu--bottom-right')
    expect(menuPage(e, 'backlog')).not.toBeNull()
    e.reconfigure({ menu: { entry: 'hidden' } })
    expect(entry().style.display).toBe('none')
    e.reconfigure({})
    e.previewMenu(false)
    expect(entry().style.display).toBe('none')
    e.openMenu('settings') // an idle engine opens a page for display
    expect(menuPage(e, 'settings')).not.toBeNull()
    e.destroy()
  })

  it('is a no-op with a diagnostic when the menu is off', async () => {
    const e = engineWith({ menu: { enabled: false } })
    e.loadSource('[menu open saves]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    expect(e.hasMenu).toBe(false)
    expect(messages(e).some((m) => m.includes('the system menu is off'))).toBe(true)
    e.destroy()
  })
})

describe('the slider widget', () => {
  it('writes its variable through setVar (sys.* included), follows the variable, keeps its element; disabled greys it', async () => {
    const e = engineWith()
    applyConfig(e, {
      ui: {
        snd: {
          kind: 'window',
          widgets: [
            { type: 'slider', var: 'sys.bgmVolume', min: 0, max: 1, step: 0.05, label: 'Music' },
            { type: 'slider', var: 'level', max: 10, disabled: 'locked == 1' },
          ],
        },
      },
    } as AdvConfig)
    e.loadSource('narr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    const [music, level] = [...panel(e, 'snd').querySelectorAll<HTMLInputElement>('.nilvn-ui__slider-input')]
    expect(panel(e, 'snd').querySelector('.nilvn-ui__slider-label')!.textContent).toBe('Music')
    expect([music!.min, music!.max, music!.step, music!.value]).toEqual(['0', '1', '0.05', '1'])
    music!.value = '0.35'
    music!.dispatchEvent(new Event('input'))
    expect(e.bgmVolume).toBe(0.35)
    expect(panel(e, 'snd').querySelector('.nilvn-ui__slider-input')).toBe(music) // the same element after the redraw
    e.setVolume('bgm', 0.8) // the settings page writes: the slider follows
    expect(music!.value).toBe('0.8')
    level!.value = '7'
    level!.dispatchEvent(new Event('input'))
    expect(e.vars.level).toBe(7)
    e.setVar('locked', 1)
    expect(level!.disabled).toBe(true)
    expect(level!.parentElement!.classList.contains('is-disabled')).toBe(true)
    e.destroy()
  })
})

describe('skins and looks', () => {
  it('[window] nameSkin, [menu] skin / background / color / panelSkin map onto tokens', () => {
    const e = engineWith()
    applyConfig(e, {
      window: { nameSkin: 'ui/name.png', nameSlice: 12, nameSliceWidth: '2cqh' },
      menu: { skin: 'ui/menu.png', slice: 8, color: '#fff', panelSkin: 'ui/page.png' },
    } as AdvConfig)
    const t = e.theme
    expect(t['name-skin-slice']).toBe('url("http://g.test/ui/name.png") 12 fill / 2cqh stretch')
    expect([t['name-bg'], t['name-radius'], t['name-shadow']]).toEqual(['transparent', '0', 'none'])
    expect(t['menu-button-skin-slice']).toContain('url("http://g.test/ui/menu.png") 8 fill')
    expect([t['menu-button-bg'], t['menu-button-border'], t['menu-button-color']]).toEqual(['transparent', 'none', '#fff'])
    expect(t['panel-skin']).toBe('url("http://g.test/ui/page.png")')
    // by default the ☰ is a floating chip on the stage, drawn like a HUD
    expect([THEME_TOKENS['menu-button-bg'], THEME_TOKENS['menu-button-color'], THEME_TOKENS['menu-button-border']]).toEqual(['var(--nilvn-hud-bg)', 'var(--nilvn-hud-color)', 'var(--nilvn-hud-border)'])
    applyConfig(e, { window: { nameSlice: 4 }, menu: { panelSlice: 3 } } as AdvConfig)
    expect(messages(e)).toEqual(expect.arrayContaining(['[window] unknown key "nameSlice (needs nameSkin)" — ignored', '[menu] unknown key "panelSlice (needs panelSkin)" — ignored']))
    e.destroy()
  })

  it('a panel and a button take their own skin and colours', async () => {
    const e = engineWith()
    applyConfig(e, {
      ui: {
        hud: { skin: 'ui/hud.png', slice: 10, radius: '0', widgets: [{ type: 'button', label: 'Go', onclick: 'set x = 1', skin: 'ui/b.png', color: '#123' }, { type: 'button', label: 'Plain', onclick: 'set y = 1', background: '#456' }] },
        win: { kind: 'window', background: '#000', skin: 'ui/w.png', widgets: [{ type: 'text', text: 'w' }] },
      },
    } as AdvConfig)
    const hud = panel(e, 'hud')
    expect(hud.style.getPropertyValue('--ui-panel-skin-slice')).toBe('url("http://g.test/ui/hud.png") 10 fill / 10px stretch')
    expect([hud.style.getPropertyValue('--nilvn-hud-bg'), hud.style.getPropertyValue('--nilvn-hud-border'), hud.style.getPropertyValue('--nilvn-hud-radius')]).toEqual(['transparent', 'none', '0'])
    expect(panel(e, 'win').style.getPropertyValue('--nilvn-window-bg')).toBe('#000')
    e.ui.preview(['hud'])
    const [go, plain] = [...hud.querySelectorAll<HTMLButtonElement>('.nilvn-ui__button')]
    expect(go!.style.getPropertyValue('--ui-button-skin')).toBe('url("http://g.test/ui/b.png")')
    expect([go!.style.getPropertyValue('--nilvn-button-bg'), go!.style.getPropertyValue('--nilvn-button-color')]).toEqual(['transparent', '#123'])
    expect(plain!.style.getPropertyValue('--nilvn-button-bg')).toBe('#456')
    e.destroy()
  })
})

describe('windows: free layout, anchor, close, dim, open, dir', () => {
  it('places widgets with x / y / w / h in percent of the body; the window then has a size; anchor works', () => {
    const e = engineWith()
    applyConfig(e, {
      ui: {
        free: { kind: 'window', anchor: 'top-right', widgets: [{ type: 'text', text: 'a', x: 10, y: 20, w: 30 }, { type: 'text', text: 'flow' }, { type: 'button', label: 'b', onclick: 'set q = 1', x: '1cqw', y: 0, h: 25 }] },
        row: { dir: 'row', widgets: [{ type: 'text', text: 'r' }] },
      },
    } as AdvConfig)
    e.ui.preview(['free', 'row'])
    const w = panel(e, 'free')
    expect(w.className).toBe('nilvn-ui nilvn-ui--window nilvn-ui--top-right nilvn-ui--free nilvn-ui--preview')
    expect([w.style.width, w.style.height]).toEqual(['40cqw', '36cqh'])
    const [a, flow, b] = [...w.querySelectorAll<HTMLElement>('[data-widget]')]
    expect([a!.style.position, a!.style.left, a!.style.top, a!.style.width]).toEqual(['absolute', '10%', '20%', '30%'])
    expect(flow!.style.position).toBe('')
    expect([b!.style.left, b!.style.height]).toEqual(['1cqw', '25%'])
    expect(w.querySelector('.nilvn-ui__body')!.className).toBe('nilvn-ui__body nilvn-ui__body--free')
    expect(panel(e, 'row').querySelector('.nilvn-ui__body')!.className).toBe('nilvn-ui__body nilvn-ui__body--row')
    e.destroy()
  })

  it('close = true hides from an ×; dim = true puts a click-swallowing backdrop behind; open animates show and hide', async () => {
    const e = engineWith()
    applyConfig(e, { ui: { box: { kind: 'window', show: 'manual', title: 'Box', close: true, dim: true, open: 'fade', widgets: [{ type: 'text', text: 'hi' }] } } } as AdvConfig)
    e.loadSource('narr: one\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    const dim = e.stage.root.querySelector<HTMLElement>('.nilvn-ui-dim[data-id="box"]')!
    expect(dim.style.display).toBe('none')
    e.ui.show('box')
    expect(panel(e, 'box').classList.contains('nilvn-ui--opening')).toBe(true)
    expect(dim.style.display).toBe('')
    dim.click()
    key(' ')
    await tick()
    expect(text(e)).toBe('one') // the backdrop took the click, the advance key waits
    panel(e, 'box').querySelector<HTMLButtonElement>('.nilvn-ui__close')!.click()
    expect(e.ui.isShown('box')).toBe(false)
    expect(panel(e, 'box').classList.contains('nilvn-ui--closing')).toBe(true)
    expect(panel(e, 'box').style.display).toBe('') // still fading out
    await until(() => panel(e, 'box').style.display === 'none')
    expect(dim.style.display).toBe('none')
    e.destroy()
  })

  it('disabled = expr greys a button and keeps its click from running', async () => {
    const e = engineWith()
    applyConfig(e, { ui: { shop: { widgets: [{ type: 'button', label: 'Buy', onclick: 'set bought = 1', disabled: 'coins < 5' }] } } } as AdvConfig)
    e.loadSource('[set coins = 1]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    const buy = (): HTMLButtonElement => panel(e, 'shop').querySelector<HTMLButtonElement>('.nilvn-ui__button')!
    expect(buy().disabled).toBe(true)
    buy().click()
    await tick()
    expect(e.vars.bought).toBeUndefined()
    e.setVar('coins', 9)
    expect(buy().disabled).toBe(false)
    buy().click()
    await until(() => e.vars.bought === 1)
    e.destroy()
  })
})

describe('button keys', () => {
  it('a key clicks its button while the panel is up and nothing else holds the keyboard; a clash with a system key is reported', async () => {
    const e = engineWith({ keys: { save: 's' } })
    applyConfig(e, {
      ui: {
        hud: { widgets: [{ type: 'button', label: 'Vol', key: 'v', onclick: 'set pressed = pressed + 1' }, { type: 'button', label: 'Clash', key: 's', onclick: 'set clash = 1' }] },
      },
    } as AdvConfig)
    expect(messages(e).some((m) => m.includes('[ui.hud] widgets[1]: key S is already bound to "save"'))).toBe(true)
    e.loadSource('[set pressed = 0]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    key('v')
    await until(() => e.vars.pressed === 1)
    key('s')
    await tick()
    expect(e.vars.clash).toBeUndefined() // the system binding wins
    e.openMenu('backlog')
    key('v')
    await tick()
    expect(e.vars.pressed).toBe(1) // a system page is up
    e.closeMenu()
    e.ui.hide('hud')
    key('v')
    await tick()
    expect(e.vars.pressed).toBe(1)
    e.destroy()
  })
})

describe('panels as recordable stage objects', () => {
  it('ui:<id> is listed, posed over its anchor, survives a redraw, saved and restored', async () => {
    const e = engineWith()
    applyConfig(e, { ui: { hud: { anchor: 'top', widgets: [{ type: 'text', var: 'n' }] }, win: { kind: 'window', show: 'manual', widgets: [{ type: 'text', text: 'w' }] } } } as AdvConfig)
    expect(e.stage.objectIds()).toEqual(['camera', 'window:dialog', 'ui:hud', 'ui:win'])
    e.loadSource('[set n = 1]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    const hud = panel(e, 'hud')
    expect(e.stage.objectElement('ui:hud')).toBe(hud)
    expect(e.stage.objectIdAt(hud.firstElementChild)).toBe('ui:hud')
    e.applyChannel('ui:hud', 'x', 20)
    e.applyChannel('ui:hud', 'opacity', 0.5)
    expect(hud.style.transform).toBe('translateX(-50%) translate(20px, 0px)')
    e.setVar('n', 2) // a redraw rebuilds the widgets, never the pose
    expect(hud.textContent).toBe('2')
    expect(hud.style.transform).toContain('translate(20px, 0px)')
    expect(e.readChannel('ui:hud', 'x')).toBe(20)
    const save = e.saveState()
    expect(save.stage.panels).toEqual([{ id: 'ui:hud', x: 20, opacity: 0.5 }])
    await e.playFrames(0.05, [{ objId: 'ui:win', keys: [{ t: 0, ch: { y: '0' } }, { t: 0.05, ch: { y: '-12' } }] }])
    expect(e.stage.getProp('ui:win', 'y')).toBe(-12)
    expect(panel(e, 'win').style.transform).toBe('translate(-50%,-50%) translate(0px, -12px)')
    await e.restoreState(save)
    await until(() => text(e) === 'x')
    expect(e.stage.getProp('ui:win', 'y')).toBe(0)
    expect(e.stage.getProp('ui:hud', 'x')).toBe(20)
    await e.showTitle() // a fresh run: every panel at rest
    expect(e.stage.getProp('ui:hud', 'x')).toBe(0)
    e.destroy()
  })
})
