// @vitest-environment jsdom
// The small capabilities 0.19 adds after the 《潮汐钟》 round: screen.open
// resolving on close, input.label, [game] lang, the [input] prompt / button
// colours and a colour for the title and ending pages.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, applyConfig, type Engine } from '../src/index'
import type { EngineOptions, PluginContext } from '../src/types'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ finished: Promise.resolve(), finish() {} })
})
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
function engineWith(opts: Partial<EngineOptions> = {}): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}

describe('plugin capabilities', () => {
  it('screen.open resolves when its screen closes — by Esc, by close(), or with the plugin', async () => {
    let ctx!: PluginContext
    const e = engineWith({ plugins: [{ id: 'com.x.game', permissions: ['ui.screen'], activate: (c) => void (ctx = c) }] })
    e.loadSource('narr: x\n')
    await e.prepare()
    let done = 0
    void ctx.screen!.open('a', 'A', () => {}).then(() => done++)
    await tick()
    expect(done).toBe(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()
    expect(done).toBe(1)
    void ctx.screen!.open('b', 'B', (_body, close) => setTimeout(close, 5)).then(() => done++)
    await tick(20)
    expect(done).toBe(2)
    void ctx.screen!.open('c', 'C', () => {}).then(() => done++)
    e.disablePlugin('com.x.game')
    await tick()
    expect(done).toBe(3)
    expect(e.stage.root.querySelector('.nilvn-screen-plugin')).toBeNull()
    e.destroy()
  })

  it('input.label names the key a binding has now, after a rebind too', async () => {
    let ctx!: PluginContext
    const e = engineWith({ plugins: [{ id: 'com.x.keys', permissions: ['input.keys'], keybindings: [{ id: 'strike', default: 'f' }, { id: 'off', default: false }], activate: (c) => void (ctx = c) }] })
    e.loadSource('narr: x\n')
    await e.prepare()
    expect(ctx.input!.label('strike')).toBe('F')
    expect(ctx.input!.label('off')).toBe('')
    e.assignKey('com.x.keys:strike', 'Ctrl+t')
    expect(ctx.input!.label('strike')).toBe('Ctrl+T')
    expect(ctx.input!.label('nope')).toBe('')
    expect(e.diagnostics.some((d) => d.message.includes('input.label("nope")'))).toBe(true)
    e.destroy()
  })
})

describe('config', () => {
  it('[game] lang starts the work in that language unless the host chose one', () => {
    const e = engineWith()
    applyConfig(e, { game: { lang: 'zh' } })
    expect([e.lang, e.defaultLang, e.languages]).toEqual(['zh', 'zh', ['zh']])
    e.destroy()
    const host = engineWith({ lang: 'en' })
    applyConfig(host, { game: { lang: 'zh' } })
    expect(host.lang).toBe('en')
    host.destroy()
  })

  it('[input] promptColor / buttonBackground / buttonColor and [title] / [ending] color', async () => {
    const e = engineWith()
    applyConfig(e, { input: { promptColor: '#222', buttonBackground: '#eee', buttonColor: '#111' }, title: { color: '#101010' }, ending: { good: { color: 'rgb(1, 2, 3)' } } })
    expect(e.theme).toMatchObject({ 'input-prompt-color': '#222', 'input-button-bg': '#eee', 'input-button-color': '#111' })
    expect(e.diagnostics).toEqual([])
    e.loadSource('narr: x\n[ending good]\n')
    await e.showTitle()
    expect(e.stage.root.querySelector<HTMLElement>('.nilvn-screen--title')!.style.color).toBe('rgb(16, 16, 16)')
    void e.start()
    await tick(30)
    e.stage.root.click()
    await tick(30)
    expect(e.session).toBe('ending')
    expect(e.stage.root.querySelector<HTMLElement>('.nilvn-screen--ending')!.style.color).toBe('rgb(1, 2, 3)')
    e.destroy()
  })
})
