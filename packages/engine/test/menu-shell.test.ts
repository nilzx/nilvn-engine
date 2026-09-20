// @vitest-environment jsdom
// The in-game system menu (batch G inc 4, moved in from the menu plugin): it is
// the engine's own — no `[use menu]` needed (and the old line is ignored with a
// diagnostic); it releases every window listener on destroy; two engines on one
// page label their menus in their own work language; it hides off the story.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, type Engine } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

function watchWindowListeners(): () => { leaked: string[] } {
  const live = new Map<object, string>()
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    live.set(fn, type)
    add(type, fn, opts as AddEventListenerOptions)
  }) as typeof window.addEventListener
  window.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    live.delete(fn)
    remove(type, fn, opts as EventListenerOptions)
  }) as typeof window.removeEventListener
  return () => {
    window.addEventListener = add
    window.removeEventListener = remove
    return { leaked: [...live.values()] }
  }
}

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
function engineWith(lang?: string): Engine {
  const container = document.createElement('div')
  document.body.append(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), ...(lang ? { lang, defaultLang: lang, languages: [lang] } : {}) })
}
const items = (e: Engine): HTMLButtonElement[] => [...e.stage.root.querySelectorAll<HTMLButtonElement>('.nilvn-menu__item')]

describe('the system menu', () => {
  it('is built in: the shell renders with no plugin, [use menu] is ignored with one diagnostic', async () => {
    const e = engineWith()
    e.loadSource('[use menu]\n[label s1]\nyuki: Hello\n')
    void e.start()
    await tick()
    expect(e.stage.root.querySelector('.nilvn-menu')).not.toBeNull()
    expect(e.activePlugins).toEqual([])
    expect(e.missingPlugins).toEqual([])
    expect(e.diagnostics.filter((d) => d.message.includes('[use menu] ignored'))).toHaveLength(1)
    e.destroy()
  })

  it('leaves no window listener behind after a run', async () => {
    const done = watchWindowListeners()
    const e = engineWith()
    e.loadSource('[label s1]\n[bgm music.mp3]\n[se ding.mp3]\nyuki: Hello\n')
    void e.start()
    for (let i = 0; i < 50 && !e.stage.textEl.textContent; i++) await tick(5)
    e.destroy()
    const { leaked } = done()
    expect(leaked).toEqual([])
  })

  it('two engines with different work languages label their menus independently', async () => {
    const zh = engineWith('zh')
    const en = engineWith('en')
    const label = (e: Engine): string => items(e)[1]!.textContent ?? ''
    expect(label(zh)).toBe(zh.t('ui.menu.load'))
    expect(label(en)).toBe(en.t('ui.menu.load'))
    expect(label(zh)).toBe('读取进度')
    expect(label(en)).toBe('Load')
    zh.destroy()
    en.destroy()
  })

  it('shows only while playing; Esc toggles it; a panel closes first', async () => {
    const e = engineWith()
    e.loadSource('[label s1]\nyuki: Hello\n')
    const wrap = e.stage.root.querySelector<HTMLElement>('.nilvn-menu')!
    expect(wrap.style.display).toBe('none') // idle
    void e.start()
    await tick()
    expect(wrap.style.display).toBe('')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrap.classList.contains('on')).toBe(true)
    // Space does not advance the story while the menu is up.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    await tick()
    expect(e.session).toBe('playing')
    expect(e.getBacklog()).toHaveLength(1)
    items(e).find((b) => b.textContent === e.t('ui.menu.backlog'))!.click()
    expect(e.stage.root.querySelector('.nilvn-panel--backlog')!.classList.contains('on')).toBe(true)
    expect(wrap.classList.contains('on')).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(e.stage.root.querySelector('.nilvn-panel--backlog')!.classList.contains('on')).toBe(false)
    await e.showTitle()
    expect(wrap.style.display).toBe('none')
    e.destroy()
  })

  it('[menu] config: entry position, item set, unknown items reported; enabled = false = no menu', async () => {
    const a = createEngine({ container: document.createElement('div'), saveStore: new MemorySaveStore(), menu: { entry: 'bottom-left', items: ['save', 'bogus', 'settings'] } })
    expect(a.stage.root.querySelector('.nilvn-menu--bottom-left')).not.toBeNull()
    expect(items(a).map((b) => b.dataset.id ?? b.className)).toHaveLength(2)
    expect(a.diagnostics.some((d) => d.message.includes('unknown item "bogus"'))).toBe(true)
    a.destroy()
    const b = createEngine({ container: document.createElement('div'), saveStore: new MemorySaveStore(), menu: { enabled: false } })
    expect(b.stage.root.querySelector('.nilvn-menu')).toBeNull()
    b.destroy()
    const c = createEngine({ container: document.createElement('div'), saveStore: new MemorySaveStore(), screens: { menu: false } })
    expect(c.stage.root.querySelector('.nilvn-menu')).toBeNull()
    c.destroy()
  })

  it('the title page\'s Load / Settings buttons open the menu panels', async () => {
    const e = createEngine({ container: document.createElement('div'), saveStore: new MemorySaveStore(), title: { buttons: ['new', 'load', 'settings'] } })
    e.loadSource('[label s1]\nyuki: Hello\n')
    await e.showTitle()
    const btn = (id: string): HTMLButtonElement => e.stage.root.querySelector<HTMLButtonElement>(`.nilvn-screen__button[data-id="${id}"]`)!
    expect(btn('load')).not.toBeNull()
    btn('settings').click()
    expect(e.stage.root.querySelector('.nilvn-panel--settings')!.classList.contains('on')).toBe(true)
    expect(e.stage.root.querySelector('.nilvn-menu__grid')).not.toBeNull()
    e.destroy()
  })
})
