// @vitest-environment jsdom
// The system menu's backlog panel against a real run: played lines appear as
// rows (speaker + text, ▶ only for voiced lines), wheel-up opens it, Esc closes
// it before the menu, and a wheel inside it scrolls natively.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, type Engine } from '../src/index'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

async function playedEngine(): Promise<{ engine: Engine; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.append(container)
  const engine = createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore() })
  engine.loadSource('[label start]\nyuki: Hello line one\n[voice v/one.mp3 offset=0.2]\nyuki: A voiced line')
  void engine.start()
  for (let i = 0; i < 50 && engine.getBacklog().length < 1; i++) await tick()
  expect(engine.getBacklog().length).toBe(1)
  return { engine, container }
}
const panel = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('.nilvn-panel--backlog')!

describe('backlog panel', () => {
  it('wheel-up opens the panel with the played lines; Esc closes it', async () => {
    const { engine, container } = await playedEngine()
    const root = container.querySelector<HTMLElement>('.nilvn-root')!
    expect(panel(container).classList.contains('on')).toBe(false)
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
    expect(panel(container).classList.contains('on')).toBe(true)
    const rows = panel(container).querySelectorAll('.nilvn-backlog__row')
    expect(rows.length).toBe(1)
    expect(rows[0]!.querySelector('.nilvn-backlog__who')!.textContent).toBe('yuki')
    expect(rows[0]!.querySelector('.nilvn-backlog__text')!.textContent).toBe('Hello line one')
    expect(rows[0]!.querySelector('.nilvn-backlog__voice')).toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel(container).classList.contains('on')).toBe(false)
    engine.destroy()
  })

  it('the speaker name carries the actor\'s colours (background + text), as the name tag does', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const engine = createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore() })
    engine.loadSource('[actor yuki name=Yuki color=#ff7eb6 textColor=#102030]\n[label start]\nyuki: Hi\nrin: Yo\nNarration')
    void engine.start()
    const root = container.querySelector<HTMLElement>('.nilvn-root')!
    for (let i = 0; i < 50 && engine.getBacklog().length < 1; i++) await tick()
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 50 && engine.getBacklog().length < 2; i++) await tick()
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 50 && engine.getBacklog().length < 3; i++) await tick()
    expect(engine.getBacklog().map((b) => b.actor)).toEqual(['yuki', undefined, undefined])
    engine.openMenu('backlog')
    const whos = panel(container).querySelectorAll<HTMLElement>('.nilvn-backlog__who')
    expect(whos.length).toBe(2) // narration has no name
    expect(whos[0]!.textContent).toBe('Yuki')
    expect(whos[0]!.style.background).toBe('rgb(255, 126, 182)')
    expect(whos[0]!.style.color).toBe('rgb(16, 32, 48)')
    expect(whos[1]!.textContent).toBe('rin')
    expect(whos[1]!.style.background).toBe('') // undeclared: the theme's name tokens
    engine.destroy()
  })

  it('a voiced line gets a ▶ replay button wired to its ref', async () => {
    const { engine, container } = await playedEngine()
    const root = container.querySelector<HTMLElement>('.nilvn-root')!
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 50 && engine.getBacklog().length < 2; i++) await tick()
    expect(engine.getBacklog()[1]).toMatchObject({ speaker: 'yuki', text: 'A voiced line', voiceRef: 'v/one.mp3', offset: 0.2 })
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
    const rows = panel(container).querySelectorAll('.nilvn-backlog__row')
    expect(rows.length).toBe(2)
    expect(rows[1]!.querySelector('.nilvn-backlog__voice')).not.toBeNull()
    engine.destroy()
  })

  it('wheel-up while the panel is open leaves it alone (native scroll); [menu] wheelBacklog = false disables the gesture', async () => {
    const { engine, container } = await playedEngine()
    const root = container.querySelector<HTMLElement>('.nilvn-root')!
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
    expect(panel(container).classList.contains('on')).toBe(true)
    const ev = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })
    panel(container).querySelector('.nilvn-backlog__list')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(panel(container).classList.contains('on')).toBe(true)
    engine.destroy()
    const c2 = document.createElement('div')
    const e2 = createEngine({ container: c2, textSpeed: 0, saveStore: new MemorySaveStore(), menu: { wheelBacklog: false } })
    e2.loadSource('[label s]\nyuki: hi\n')
    void e2.start()
    await tick()
    c2.querySelector<HTMLElement>('.nilvn-root')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
    expect(panel(c2).classList.contains('on')).toBe(false)
    e2.destroy()
  })
})
