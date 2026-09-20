// @vitest-environment jsdom
// The dialogue layer moved behind the Renderer seam: the engine
// owns pacing policy and per-character side effects, the DOM renderer owns spans
// and buttons. Plugins see choices only through sealed handles (no element).
import { describe, it, expect, beforeAll } from 'vitest'
import { newEngine } from './helpers'
import { DomRenderer, parseSegments } from '../src/index'
import type { EnginePlugin, ChoiceItem } from '../src/index'
import type { ChoiceHandle } from '../src/renderer/types'

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick()
  expect(cond()).toBe(true)
}

function renderer(): DomRenderer {
  const container = document.createElement('div')
  document.body.append(container)
  return new DomRenderer(container)
}

describe('Renderer.typeLine', () => {
  it('reveals every character, calling onReveal with the sealed span and its effect', async () => {
    const r = renderer()
    const seen: string[] = []
    await r.typeLine(parseSegments('a{wave:b}{br}c'), {
      cps: () => 0,
      skip: () => false,
      alive: () => true,
      onReveal: (span, effect) => seen.push(`${span.index}${span.char}${effect ?? ''}`),
    })
    expect(seen).toEqual(['0a', '1bwave', '2c'])
    expect(r.textEl.querySelectorAll('.nilvn-ch.on')).toHaveLength(3)
    expect(r.textEl.querySelector('br')).toBeTruthy()
  })

  it('skip() reveals the rest at once; alive() false aborts mid-line', async () => {
    const r = renderer()
    let skip = false
    const p = r.typeLine(parseSegments('hello'), { cps: () => 5, skip: () => skip, alive: () => true })
    await tick()
    expect(r.textEl.querySelectorAll('.nilvn-ch.on').length).toBeLessThan(5)
    skip = true
    await p
    expect(r.textEl.querySelectorAll('.nilvn-ch.on')).toHaveLength(5)

    const r2 = renderer()
    let alive = true
    const p2 = r2.typeLine(parseSegments('hello'), { cps: () => 5, skip: () => false, alive: () => alive })
    await tick()
    alive = false
    await p2
    expect(r2.textEl.querySelectorAll('.nilvn-ch.on').length).toBeLessThan(5)
  })

  it('setLine repaints fully revealed (a language switch)', () => {
    const r = renderer()
    r.setLine(parseSegments('你好'))
    expect(r.textEl.textContent).toBe('你好')
    expect(r.textEl.querySelectorAll('.nilvn-ch.on')).toHaveLength(2)
  })
})

describe('Renderer.showChoices', () => {
  it('one button per item, sealed handles, a click resolves the index', async () => {
    const r = renderer()
    const prompt = r.showChoices([{ segments: parseSegments('A') }, { segments: parseSegments('B') }])
    expect(prompt.handles.map((h) => h.index)).toEqual([0, 1])
    prompt.handles[1]!.addClass('cfx')
    prompt.handles[1]!.setVar('--cfx-delay', '0.12s')
    const buttons = r.choicesEl.querySelectorAll<HTMLButtonElement>('.nilvn-choice')
    expect(buttons).toHaveLength(2)
    expect(buttons[1]!.classList.contains('cfx')).toBe(true)
    expect(buttons[1]!.style.getPropertyValue('--cfx-delay')).toBe('0.12s')
    expect(r.choicesEl.classList.contains('on')).toBe(true)
    buttons[1]!.click()
    expect(await prompt.chosen).toBe(1)
    r.hideChoices()
    expect(r.choicesEl.children).toHaveLength(0)
    expect(r.choicesEl.classList.contains('on')).toBe(false)
  })

  it('cancel() resolves null; relabel repaints one button', async () => {
    const r = renderer()
    const prompt = r.showChoices([{ segments: parseSegments('A') }])
    prompt.relabel(0, parseSegments('甲'))
    expect(r.choicesEl.querySelector('.nilvn-choice')!.textContent).toBe('甲')
    prompt.cancel()
    expect(await prompt.chosen).toBeNull()
  })
})

describe('engine choice hooks', () => {
  it('onChoices gets handles (no elements) and onChoose fires with the picked item', async () => {
    const seen: string[] = []
    const spy: EnginePlugin = {
      id: 'test.spy',
      hooks: {
        onChoices: (items: ChoiceItem[], choices: ChoiceHandle[]) => {
          seen.push(`shown:${items.length}:${choices.length}:${'classList' in (choices[0] as object)}`)
        },
        onChoose: (item: ChoiceItem, index: number) => seen.push(`chose:${index}:${item.target}`),
      },
    }
    const e = newEngine({ textSpeed: 0, plugins: [spy] })
    e.loadSource('[choice A -> a]\n[choice B -> b]\n[label a]\n[set x = 1]\n[label b]\n[set x = 2]\n')
    void e.start()
    await until(() => e.stage.choicesEl.querySelectorAll('.nilvn-choice').length === 2)
    expect(seen).toEqual(['shown:2:2:false'])
    e.stage.choicesEl.querySelectorAll<HTMLButtonElement>('.nilvn-choice')[1]!.click()
    await until(() => e.vars.x === 2)
    expect(seen[1]).toBe('chose:1:b')
    e.destroy()
  })

  it('a language switch relabels the parked prompt in place', async () => {
    const e = newEngine({
      textSpeed: 0,
      catalogs: { zh: { 'c.a': '甲' }, en: { 'c.a': 'Alpha' } },
      lang: 'zh',
      defaultLang: 'zh',
      languages: ['zh', 'en'],
    })
    e.loadSource('[choice @c.a -> a]\n[label a]\n')
    void e.start()
    await until(() => e.stage.choicesEl.querySelectorAll('.nilvn-choice').length === 1)
    const btn = (): HTMLElement => e.stage.choicesEl.querySelector<HTMLElement>('.nilvn-choice')!
    expect(btn().textContent).toBe('甲')
    await e.setLanguage('en')
    expect(btn().textContent).toBe('Alpha')
    e.destroy()
  })
})
