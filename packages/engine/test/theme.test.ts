// @vitest-environment jsdom
// The theme contract (batch G inc 1): every colour / size the built-in chrome
// draws with is a `--nilvn-<token>` custom property with a default in the base
// stylesheet; hosts, the config file, `engine.setTheme()` and `[theme …]` only
// override. Two layers — base (host / config, survives restart) and script
// (saved with the stage, reset by restart) — and the name tag's per-actor
// colours riding on top of both.
import { describe, it, expect, beforeAll } from 'vitest'
import { DomRenderer } from '../src/stage'
import { createEngine } from '../src/index'
import { THEME_TOKENS, themeVar } from '../src/theme'
import { applyConfig, windowTheme } from '../src/config'
import type { EnginePlugin, PluginContext } from '../src/types'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

const freshStage = (): DomRenderer => new DomRenderer(document.createElement('div'))
const rootVar = (stage: DomRenderer, token: string): string => stage.root.style.getPropertyValue(themeVar(token))
const nameEl = (stage: DomRenderer): HTMLElement => stage.root.querySelector<HTMLElement>('.nilvn-name')!
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15))

describe('the token contract', () => {
  it('declares every token with its default on .nilvn-root, and reads only declared tokens', () => {
    freshStage()
    const css = document.getElementById('nilvn-base-style')!.textContent!
    for (const k of Object.keys(THEME_TOKENS)) expect(css).toContain(`${themeVar(k)}:`)
    const read = new Set([...css.matchAll(/var\(--nilvn-([a-z0-9-]+)/g)].map((m) => m[1]))
    for (const token of read) expect(THEME_TOKENS).toHaveProperty(token)
    // The dialogue chrome reads the tokens it exists for (a token nobody reads is a lie).
    for (const must of ['font', 'text', 'ui-scale', 'dialog-bg', 'dialog-skin', 'dialog-opacity', 'name-bg', 'name-color', 'text-size', 'indicator-color', 'choice-bg']) {
      expect(read.has(must)).toBe(true)
    }
  })

  it('token names are lower-case dashed words', () => {
    for (const k of Object.keys(THEME_TOKENS)) expect(k).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('DomRenderer theme layers', () => {
  it('paints base then script overrides inline on the root; script wins', () => {
    const stage = freshStage()
    stage.setThemeBase({ 'name-bg': '#111111', accent: '#222222' })
    stage.setTheme({ 'name-bg': '#333333' })
    expect(rootVar(stage, 'name-bg')).toBe('#333333')
    expect(rootVar(stage, 'accent')).toBe('#222222')
    expect(stage.getTheme()).toEqual({ 'name-bg': '#333333', accent: '#222222' })
  })

  it('an empty value removes a token from the script layer; null clears the layer', () => {
    const stage = freshStage()
    stage.setThemeBase({ accent: '#222222' })
    stage.setTheme({ 'name-bg': '#333333', font: 'serif' })
    stage.setTheme({ 'name-bg': '' })
    expect(rootVar(stage, 'name-bg')).toBe('')
    expect(rootVar(stage, 'font')).toBe('serif')
    stage.setTheme(null)
    expect(rootVar(stage, 'font')).toBe('')
    expect(rootVar(stage, 'accent')).toBe('#222222') // base untouched
  })

  it('replacing the base layer drops tokens the new base no longer names', () => {
    const stage = freshStage()
    stage.setThemeBase({ accent: '#222222', font: 'serif' })
    stage.setThemeBase({ accent: '#444444' })
    expect(rootVar(stage, 'font')).toBe('')
    expect(rootVar(stage, 'accent')).toBe('#444444')
  })

  it('the script layer is in the snapshot and comes back on restore; the base is not', async () => {
    const a = freshStage()
    a.setThemeBase({ accent: '#222222' })
    a.setTheme({ 'name-bg': '#333333' })
    const snap = a.snapshot()
    expect(snap.theme).toEqual({ 'name-bg': '#333333' })
    const b = freshStage()
    b.setTheme({ font: 'serif' }) // a stale script layer on the target is reset first
    await b.restore(snap)
    expect(rootVar(b, 'name-bg')).toBe('#333333')
    expect(rootVar(b, 'font')).toBe('')
    expect(rootVar(b, 'accent')).toBe('')
    expect(freshStage().snapshot().theme).toBeUndefined()
  })
})

describe('name tag colours', () => {
  it('actor color is the background token, textColor the text token; --name-color stays as a read alias', () => {
    const stage = freshStage()
    stage.setName('Yuki', '#ff3366', '#ffe2a8')
    const st = nameEl(stage).style
    expect(st.getPropertyValue('--nilvn-name-bg')).toBe('#ff3366')
    expect(st.getPropertyValue('--nilvn-name-color')).toBe('#ffe2a8')
    expect(st.getPropertyValue('--name-color')).toBe('#ff3366')
  })

  it('absent colours remove the inline tokens so the theme defaults apply', () => {
    const stage = freshStage()
    stage.setName('Yuki', '#ff3366', '#ffe2a8')
    stage.setName('Rin')
    const st = nameEl(stage).style
    expect(st.getPropertyValue('--nilvn-name-bg')).toBe('')
    expect(st.getPropertyValue('--nilvn-name-color')).toBe('')
    expect(st.getPropertyValue('--name-color')).toBe('')
  })

  it('round-trips through snapshot / restore', async () => {
    const a = freshStage()
    a.setName('Yuki', '#ff3366', '#ffe2a8')
    const snap = a.snapshot()
    expect(snap.nameColor).toBe('#ff3366')
    expect(snap.nameTextColor).toBe('#ffe2a8')
    const b = freshStage()
    await b.restore(snap)
    expect(nameEl(b).style.getPropertyValue('--nilvn-name-color')).toBe('#ffe2a8')
    expect(b.snapshot().nameTextColor).toBe('#ffe2a8')
  })
})

describe('engine theme API', () => {
  it('createEngine({ theme }) paints the base layer and reports unknown tokens without refusing them', () => {
    const engine = createEngine({ container: document.createElement('div'), theme: { 'name-bg': '#0b1c2e', 'ui-scale': 1.2, bogus: 'x', 'Bad Key': 'y' } })
    expect(engine.theme['name-bg']).toBe('#0b1c2e')
    expect(engine.theme['ui-scale']).toBe('1.2')
    expect(engine.theme.bogus).toBe('x')
    const msgs = engine.diagnostics.map((d) => d.message)
    expect(msgs.some((m) => m.includes('unknown theme token "bogus"'))).toBe(true)
    expect(msgs.some((m) => m.includes('invalid theme token "Bad Key"'))).toBe(true)
    expect(engine.diagnostics.every((d) => d.phase === 'load')).toBe(true)
  })

  it('[theme] writes the script layer over the base; [theme reset] and restart clear it, the base survives', async () => {
    const engine = createEngine({ container: document.createElement('div'), theme: { accent: '#222222' } })
    engine.loadSource('[label s]\n[theme name-bg=#112233 accent=#999999]\n')
    await engine.start()
    expect(engine.theme).toEqual({ accent: '#999999', 'name-bg': '#112233' })
    engine.loadSource('[label s]\n[theme reset]\n')
    await engine.start()
    expect(engine.theme).toEqual({ accent: '#222222' })
    engine.loadSource('[label s]\n[theme font=serif]\n')
    await engine.start()
    expect(engine.theme.font).toBe('serif')
    engine.loadSource('[label s]\n[set x = 1]\n') // a restart replays the loaded script — one without [theme]
    await engine.restart()
    expect(engine.theme).toEqual({ accent: '#222222' })
  })

  it('an unknown token in [theme] is an exec diagnostic, still applied', async () => {
    const engine = createEngine({ container: document.createElement('div') })
    engine.loadSource('[label s]\n[theme nope=1]\n')
    await engine.start()
    expect(engine.theme.nope).toBe('1')
    expect(engine.diagnostics.some((d) => d.phase === 'exec' && d.message.includes('"nope"'))).toBe(true)
  })

  it('the script layer is saved with the session and painted again by restoreState', async () => {
    const engine = createEngine({ container: document.createElement('div') })
    engine.loadSource('[label s]\n[theme name-bg=#112233]\nyuki: hello\n')
    void engine.start()
    await tick() // parked on the line
    const save = engine.saveState()
    expect(save.stage.theme).toEqual({ 'name-bg': '#112233' })
    engine.stage.setTheme(null) // wiped (as a restart of a plain script would)
    expect(engine.theme['name-bg']).toBeUndefined()
    expect(await engine.restoreState(save)).toBe(true)
    expect(engine.theme['name-bg']).toBe('#112233')
    engine.destroy()
  })

  it('actor textColor reaches the name tag; [actor] keeps fields it does not mention', async () => {
    const engine = createEngine({ container: document.createElement('div'), actors: { yuki: { name: 'Yuki', color: '#ff3366', voice: 300 } } })
    engine.loadSource('[label s]\n[actor yuki textColor=#ffe2a8]\nyuki: hi\n')
    void engine.start()
    await tick()
    expect(engine.actors.yuki).toMatchObject({ color: '#ff3366', textColor: '#ffe2a8', voice: 300 })
    const st = engine.stage.root.querySelector<HTMLElement>('.nilvn-name')!.style
    expect(st.getPropertyValue('--nilvn-name-bg')).toBe('#ff3366')
    expect(st.getPropertyValue('--nilvn-name-color')).toBe('#ffe2a8')
    engine.destroy()
  })

  it('applyConfig maps [theme] and [window] onto tokens and reports unknown [window] keys', () => {
    const engine = createEngine({ container: document.createElement('div'), alias: { '@ui': 'assets/ui' } })
    applyConfig(engine, {
      theme: { accent: '#0b1c2e', 'text-size': '4cqh' },
      window: { skin: '@ui/box.png', position: 'top', offset: '2cqh', opacity: 0.8, nameColor: '#ffe2a8', bogus: 1 } as never,
    })
    const t = engine.theme
    expect(t.accent).toBe('#0b1c2e')
    expect(t['text-size']).toBe('4cqh')
    expect(t['dialog-skin']).toContain('assets/ui/box.png')
    expect(t['dialog-bg']).toBe('transparent') // a skin clears the default gradient …
    expect(t['dialog-border']).toBe('none') // … and border
    expect(t['dialog-top']).toBe('2cqh')
    expect(t['dialog-bottom']).toBe('auto')
    expect(t['dialog-opacity']).toBe('0.8')
    expect(t['name-color']).toBe('#ffe2a8')
    expect(engine.diagnostics.some((d) => d.message.includes('[window] unknown key "bogus"'))).toBe(true)
  })

  it('windowTheme keeps an explicit background / border next to a skin', () => {
    const { tokens, unknown } = windowTheme({ skin: 'box.png', background: '#000', border: '1px solid red' }, (p) => p)
    expect(tokens['dialog-bg']).toBe('#000')
    expect(tokens['dialog-border']).toBe('1px solid red')
    expect(tokens['dialog-skin']).toBe('url("box.png")')
    expect(unknown).toEqual([])
  })

  it('[window] slice turns the skin into a nine-slice border-image; slice without a skin is reported', () => {
    const a = windowTheme({ skin: 'box.png', slice: 40 }, (p) => p)
    expect(a.tokens['dialog-skin']).toBe('none')
    expect(a.tokens['dialog-skin-slice']).toBe('url("box.png") 40 fill / 40px stretch')
    expect(a.tokens['dialog-bg']).toBe('transparent')
    const b = windowTheme({ skin: 'box.png', slice: '40 30', sliceWidth: '4cqh 3cqw' }, (p) => p)
    expect(b.tokens['dialog-skin-slice']).toBe('url("box.png") 40 30 fill / 4cqh 3cqw stretch')
    const c = windowTheme({ slice: 40 }, (p) => p)
    expect(c.unknown).toEqual(['slice (needs skin)'])
  })

  it('plugins read the theme through ctx.theme and hear changes until disposed', async () => {
    const seen: string[] = []
    let ctxRef: PluginContext | undefined
    const plugin: EnginePlugin = {
      id: 'test.theme',
      activate(ctx) {
        ctxRef = ctx
        ctx.theme.onChange((t) => seen.push(t.accent ?? '-'))
      },
    }
    const engine = createEngine({ container: document.createElement('div'), plugins: [plugin], theme: { accent: '#111111' } })
    expect(ctxRef!.theme.get('accent')).toBe('#111111')
    expect(ctxRef!.theme.get('font')).toBeUndefined()
    engine.setTheme({ accent: '#222222' })
    expect(seen).toEqual(['#222222'])
    engine.disablePlugin('test.theme')
    engine.setTheme({ accent: '#333333' })
    expect(seen).toEqual(['#222222'])
    expect(ctxRef!.theme.all().accent).toBe('#333333')
  })
})
