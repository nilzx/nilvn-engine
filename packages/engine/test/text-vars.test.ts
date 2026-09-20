// @vitest-environment jsdom
// Batch I inc 1 — text and variables: `{$var}` / `{@key}` interpolation at
// display time, persistent variables (`[persist]`, the `globals` store key,
// `sys.endings` / `sys.chosen`), and the `[input]` box.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, GLOBALS_KEY, applyConfig, inputTheme, interpolateText, interpolateSegments, parseSegments, type Engine } from '../src/index'
import type { EnginePlugin, PluginContext, GlobalsPayload } from '../src/index'

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
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
const name = (e: Engine): string => e.stage.root.querySelector('.nilvn-name')?.textContent ?? ''
const modal = (e: Engine): HTMLElement | null => e.stage.root.querySelector<HTMLElement>('.nilvn-modal--input')
const field = (e: Engine): HTMLInputElement => modal(e)!.querySelector<HTMLInputElement>('.nilvn-modal__input')!
const button = (e: Engine, id: 'ok' | 'cancel'): HTMLButtonElement => modal(e)!.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!
const flushStore = (e: Engine): Promise<void> => tick(350).then(() => void e)

describe('interpolation', () => {
  const host = { getVar: (n: string) => ({ player: 'Rin', n: 3, list: ['a', 'b'] })[n], resolveKey: (k: string) => ({ 'ui.hi': 'Hi {$player}' })[k] ?? '' }

  it('fills {$var} and {@key}; a key may itself carry {$var}; a missing var is empty and reported', () => {
    const missing: string[] = []
    expect(interpolateText('Dear {$player}, {$n} times', host)).toBe('Dear Rin, 3 times')
    expect(interpolateText('{@ui.hi}!', host)).toBe('Hi Rin!')
    expect(interpolateText('list: {$list}', host)).toBe('list: a, b')
    expect(interpolateText('{$nope}.', { ...host, missing: (n) => missing.push(n) })).toBe('.')
    expect(missing).toEqual(['nope'])
    expect(interpolateText('plain', host)).toBe('plain')
  })

  it('interpolates segments, keeping the array identity when nothing changes; an effect whose content is a bare @key resolves it', () => {
    const plain = parseSegments('hello {w:0.2}there')
    expect(interpolateSegments(plain, host)).toBe(plain)
    const segs = interpolateSegments(parseSegments('{wave:{$player}} says {pop:@ui.hi}'), host)
    expect(segs).toEqual([
      { kind: 'text', text: 'Rin', effect: 'wave' },
      { kind: 'text', text: ' says ' },
      { kind: 'text', text: 'Hi Rin', effect: 'pop' },
    ])
  })

  it('dialogue, the name tag and choices show current values; a language switch re-resolves {@key}', async () => {
    const e = engineWith({
      catalogs: { en: { 'k.city': 'Tokyo', 'k.line': 'Welcome to {@k.city}, {$player}!' }, zh: { 'k.city': '东京', 'k.line': '{$player}，欢迎来到{@k.city}！' } },
      lang: 'en',
      defaultLang: 'en',
      languages: ['en', 'zh'],
      actors: { me: { name: '{$player}', color: '#123456' } },
    })
    e.loadSource('[set player = "Rin"]\nme: @k.line\n[choice Stay in {@k.city} -> a]\n[label a]\n')
    void e.start()
    await until(() => text(e) === 'Welcome to Tokyo, Rin!')
    expect(name(e)).toBe('Rin')
    await e.setLanguage('zh')
    expect(text(e)).toBe('Rin，欢迎来到东京！')
    expect(e.getBacklog().at(-1)).toMatchObject({ speaker: 'Rin', text: 'Welcome to Tokyo, Rin!' }) // a snapshot at play time
    e.stage.root.click()
    await until(() => e.stage.choicesEl.querySelectorAll('.nilvn-choice').length === 1)
    expect(e.stage.choicesEl.querySelector('.nilvn-choice')!.textContent).toBe('Stay in 东京')
    await e.setLanguage('en')
    expect(e.stage.choicesEl.querySelector('.nilvn-choice')!.textContent).toBe('Stay in Tokyo')
    e.destroy()
  })

  it('an undefined variable shows as empty with one exec diagnostic per name', async () => {
    const e = engineWith()
    e.loadSource('narr: [{$ghost}] and [{$ghost}]\n')
    void e.start()
    await until(() => text(e) === '[] and []')
    expect(e.diagnostics.filter((d) => d.message.includes('"ghost"'))).toHaveLength(1)
    e.destroy()
  })
})

describe('persistent variables', () => {
  it('[persist] declares; [set] writes the store, not the save state; restart and [title] keep it', async () => {
    const store = new MemorySaveStore()
    const seen: string[] = []
    const spy: EnginePlugin = {
      id: 'test.spy',
      permissions: ['vars.read'],
      activate(ctx: PluginContext) {
        ctx.on('onVarChange', (n: string, v: unknown) => seen.push(`${n}=${String(v)}`))
      },
    }
    const e = engineWith({ plugins: [spy] }, store)
    e.loadSource('[persist runs = 0 hero = "Nobody" seen]\n[set runs = runs + 1]\n[set local = 5]\nnarr: run {$runs} by {$hero}\n')
    void e.start()
    await until(() => text(e) === 'run 1 by Nobody')
    expect(seen).toEqual(['runs=1', 'local=5'])
    expect(e.globals).toEqual({ runs: 1, hero: 'Nobody', seen: '', 'sys.endings': [], 'sys.chosen': [] })
    expect(e.vars).toEqual({ local: 5 })
    expect(e.saveState().vars).toEqual({ local: 5 })
    expect(e.scope()).toMatchObject({ runs: 1, local: 5 })
    await flushStore(e)
    expect(((await store.get(GLOBALS_KEY)) as GlobalsPayload).vars).toMatchObject({ runs: 1, hero: 'Nobody', seen: '' })
    await e.restart()
    await until(() => text(e) === 'run 2 by Nobody')
    expect(e.vars).toEqual({ local: 5 })
    await e.showTitle()
    expect(e.vars).toEqual({})
    expect(e.globals.runs).toBe(2)
    e.destroy()
  })

  it('a new engine on the same store reads the stored value over the declared default; undeclared entries are kept', async () => {
    const store = new MemorySaveStore()
    await store.set(GLOBALS_KEY, { v: 1, vars: { runs: 7, forgotten: 'x' } } satisfies GlobalsPayload)
    const e = engineWith({}, store)
    applyConfig(e, { persist: { runs: 0, hero: 'Nobody' } })
    e.loadSource('[set runs = runs + 1]\nnarr: {$runs}\n')
    void e.start()
    await until(() => text(e) === '8')
    await flushStore(e)
    expect(((await store.get(GLOBALS_KEY)) as GlobalsPayload).vars).toMatchObject({ runs: 8, hero: 'Nobody', forgotten: 'x' })
    e.destroy()
  })

  it('a declaration seeded before the store loads never overwrites the store', async () => {
    const store = new MemorySaveStore()
    await store.set(GLOBALS_KEY, { v: 1, vars: { runs: 3 } } satisfies GlobalsPayload)
    const e = engineWith({}, store)
    applyConfig(e, { persist: { runs: 0 } })
    await tick(350) // the seed alone schedules nothing
    expect(((await store.get(GLOBALS_KEY)) as GlobalsPayload).vars).toEqual({ runs: 3 })
    e.loadSource('narr: {$runs}\n')
    void e.start()
    await until(() => text(e) === '3')
    e.destroy()
  })

  it('sys.endings and sys.chosen accumulate; has() reads them in [if] and choice conditions', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    e.loadSource('[choice Secret -> secret]\n[choice Plain -> plain]\n[label secret]\n[ending true sec=0]\n[label plain]\n[end 0]\n')
    void e.start()
    await until(() => e.stage.choicesEl.querySelectorAll('.nilvn-choice').length === 2)
    e.stage.choicesEl.querySelectorAll<HTMLButtonElement>('.nilvn-choice')[0]!.click()
    await until(() => e.session === 'ending')
    expect(e.globals['sys.chosen']).toEqual(['secret'])
    expect(e.diagnostics.some((d) => d.message.includes('"sys.'))).toBe(false) // the lists exist from the start
    expect(e.globals['sys.endings']).toEqual(['true'])
    e.loadSource('[if has(sys.endings, "true") && has(sys.chosen, "secret") -> unlocked]\nnarr: locked\n[end 0]\n[label unlocked]\nnarr: unlocked {$sys.endings}\n')
    void e.start()
    await until(() => text(e) === 'unlocked true')
    await flushStore(e)
    expect(((await store.get(GLOBALS_KEY)) as GlobalsPayload).vars).toEqual({ 'sys.chosen': ['secret'], 'sys.endings': ['true'] })
    e.destroy()
  })

  it('the vars capability sees persistent and session variables alike; setGlobal declares', async () => {
    let cap: PluginContext['vars'] | undefined
    const spy: EnginePlugin = {
      id: 'test.cap',
      permissions: ['vars.write'],
      activate(ctx: PluginContext) {
        cap = ctx.vars
      },
    }
    const e = engineWith({ plugins: [spy] })
    e.loadSource('[persist p = 1]\n[set s = 2]\nnarr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    expect(cap!.get('p')).toBe(1)
    expect(cap!.has('p')).toBe(true)
    expect(cap!.all()).toMatchObject({ p: 1, s: 2 })
    e.setGlobal('q', 'new')
    cap!.set('p', 9)
    expect(e.globals).toMatchObject({ p: 9, q: 'new' })
    expect(e.isPersistent('q')).toBe(true)
    e.destroy()
  })
})

describe('[input]', () => {
  it('shows an in-engine box; Enter writes the trimmed value and the line after it interpolates', async () => {
    const e = engineWith({ catalogs: { en: { 'ui.ask': 'Your name?' } } })
    e.loadSource('[input player prompt=@ui.ask default=Traveler maxlength=8]\nnarr: Hi {$player}\n')
    void e.start()
    await until(() => modal(e) !== null)
    expect(modal(e)!.querySelector('.nilvn-modal__msg')!.textContent).toBe('Your name?')
    expect(field(e).placeholder).toBe('Traveler')
    expect(field(e).maxLength).toBe(8)
    expect(button(e, 'ok').textContent).toBe('OK')
    expect(document.activeElement).toBe(field(e))
    field(e).value = '  Rin '
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => text(e) === 'Hi Rin')
    expect(modal(e)).toBeNull()
    expect(e.vars.player).toBe('Rin')
    e.destroy()
  })

  it('cancel, Escape and an empty OK fall back to the default; persist=true declares the variable', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    e.loadSource('[input a default=D1 persist=true]\n[input b default=D2]\n[input c default=D3]\nnarr: {$a}/{$b}/{$c}\n')
    void e.start()
    await until(() => modal(e) !== null)
    button(e, 'cancel').click()
    await until(() => modal(e) !== null && field(e).placeholder === 'D2')
    modal(e)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await until(() => modal(e) !== null && field(e).placeholder === 'D3')
    button(e, 'ok').click()
    await until(() => text(e) === 'D1/D2/D3')
    expect(e.globals).toMatchObject({ a: 'D1' })
    expect(e.vars).toEqual({ b: 'D2', c: 'D3' })
    e.destroy()
  })

  it('pattern= gates OK on the whole value; a bad pattern is reported and ignored', async () => {
    const e = engineWith()
    e.loadSource('[input n pattern=[0-9]+]\n[input m pattern=(]\nnarr: {$n}-{$m}\n')
    void e.start()
    await until(() => modal(e) !== null)
    field(e).value = 'ab'
    field(e).dispatchEvent(new Event('input'))
    expect(button(e, 'ok').disabled).toBe(true)
    expect(field(e).getAttribute('aria-invalid')).toBe('true')
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick(20)
    expect(modal(e)).not.toBeNull() // Enter on an invalid value does nothing
    field(e).value = '42'
    field(e).dispatchEvent(new Event('input'))
    expect(button(e, 'ok').disabled).toBe(false)
    button(e, 'ok').click()
    await until(() => modal(e) !== null && field(e).placeholder === '')
    expect(e.diagnostics.some((d) => d.message.includes('[input] pattern "("'))).toBe(true)
    field(e).value = 'anything'
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => text(e) === '42-anything')
    e.destroy()
  })

  it('a restart during the prompt dismisses it without writing; keys inside the box never reach the engine', async () => {
    const e = engineWith()
    e.loadSource('[input a default=X]\nnarr: {$a}\n')
    void e.start()
    await until(() => modal(e) !== null)
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await tick(20)
    expect(modal(e)).not.toBeNull()
    await e.restart()
    await until(() => modal(e) !== null)
    expect(e.vars).toEqual({})
    e.destroy()
  })

  it('the [input] section sets position, button labels and input-* tokens; unknown keys are reported', async () => {
    const e = engineWith({ catalogs: { en: { 'ui.go': 'Go!', 'ui.no': 'Nah' } } })
    applyConfig(e, { input: { position: 'top', ok: '@ui.go', cancel: '@ui.no', skin: '@ui/box.png', slice: 24, fieldColor: '#ff0000', bogus: 1 } as never })
    expect(e.theme).toMatchObject({ 'input-box-skin': 'none', 'input-box-bg': 'transparent', 'input-box-border': 'none', 'input-color': '#ff0000' })
    expect(e.theme['input-box-skin-slice']).toMatch(/^url\(".*box\.png"\) 24 fill \/ 24px stretch$/)
    expect(e.diagnostics.some((d) => d.message.includes('[input] unknown key "bogus"'))).toBe(true)
    e.loadSource('[input a]\nnarr: {$a}\n')
    void e.start()
    await until(() => modal(e) !== null)
    expect(modal(e)!.classList.contains('nilvn-modal--top')).toBe(true)
    expect(button(e, 'ok').textContent).toBe('Go!')
    expect(button(e, 'cancel').textContent).toBe('Nah')
    e.destroy()
    expect(inputTheme({ slice: 3 }, (p) => p).unknown).toEqual(['slice (needs skin)'])
    expect(inputTheme({ position: 'left' as never }, (p) => p).unknown).toEqual(['position=left'])
  })

  it('offers the current value back: a persisted answer on the next run, the first answer on a second ask', async () => {
    const store = new MemorySaveStore()
    await store.set(GLOBALS_KEY, { v: 1, vars: { hero: 'Rin' } } satisfies GlobalsPayload)
    const e = engineWith({}, store)
    e.loadSource('[input hero default=Traveler persist=true]\n[input hero default=Traveler]\nnarr: {$hero}\n')
    void e.start()
    await until(() => modal(e) !== null)
    expect(field(e).placeholder).toBe('Rin')
    field(e).value = 'Yuki'
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await until(() => modal(e) !== null && field(e).placeholder === 'Yuki')
    button(e, 'cancel').click()
    await until(() => text(e) === 'Yuki')
    e.destroy()
  })

  it('a plugin can prompt through ui.dialog', async () => {
    let cap: PluginContext['dialog'] | undefined
    const spy: EnginePlugin = {
      id: 'test.dlg',
      permissions: ['ui.dialog'],
      activate(ctx: PluginContext) {
        cap = ctx.dialog
      },
    }
    const e = engineWith({ plugins: [spy] })
    e.loadSource('narr: x\n')
    void e.start()
    await until(() => text(e) === 'x')
    const p = cap!.prompt('Code?', { pattern: '\\d+' })
    await until(() => modal(e) !== null)
    field(e).value = '77'
    field(e).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe('77')
    e.destroy()
  })
})
