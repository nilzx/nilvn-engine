// @vitest-environment jsdom
// Saves carry asset REFS, not resolved URLs: a single-file export
// used to write every visible sprite's data: URI into localStorage per save. The
// stage stores the unresolved script path and a load re-resolves it through the
// engine; older URL-form saves still restore unchanged.
import { describe, it, expect, beforeAll } from 'vitest'
import { DomRenderer, createEngine, type Engine } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

const stage = (): DomRenderer => new DomRenderer(document.createElement('div'))
const resolver = (src: string): string => (/^[a-z]+:/.test(src) ? src : `https://cdn/${src.replace(/^@bg\//, 'bg/')}`)

describe('StageState refs', () => {
  it('stores the character ref and re-resolves it on restore', async () => {
    const s = stage()
    await s.showChar('yuki', 'data:image/png;base64,AAA=', { at: '50', fade: 0, ref: 'char/yuki/happy.png' })
    const snap = s.snapshot()
    expect(snap.chars[0]!.src).toBe('char/yuki/happy.png')
    const t = stage()
    await t.restore(snap, undefined, resolver)
    expect(t.charElement('yuki')!.querySelector('img')!.src).toBe('https://cdn/char/yuki/happy.png')
    expect(t.snapshot().chars[0]!.src).toBe('char/yuki/happy.png') // still a ref after a round trip
  })

  it('a legacy URL-form save restores as-is', async () => {
    const t = stage()
    await t.restore({ chars: [{ id: 'yuki', src: 'https://old/yuki.png', at: 50 }], text: '', dialog: false }, undefined, resolver)
    expect(t.charElement('yuki')!.querySelector('img')!.src).toBe('https://old/yuki.png')
  })

  it('stores the background ref (bgRef) instead of the legacy cssText, and re-resolves it on restore', async () => {
    const s = stage()
    await s.setBackground({ url: 'data:image/svg+xml;base64,AAA=', ref: '@bg/room.svg' }, 0)
    const snap = s.snapshot()
    expect(snap.bgRef).toBe('@bg/room.svg')
    expect(snap.bgCss).toBeUndefined()
    const t = stage()
    await t.restore(snap, undefined, resolver)
    const bg = t.root.querySelector<HTMLElement>('.nilvn-bg-item')!
    expect(bg.style.backgroundImage).toContain('https://cdn/bg/room.svg')
    expect(t.snapshot().bgRef).toBe('@bg/room.svg')
  })

  it('a colour background clears the ref and keeps the legacy css form', async () => {
    const s = stage()
    await s.setBackground({ url: 'x.png', ref: 'x.png' }, 0)
    await s.setBackground({ color: '#123' }, 0)
    expect(s.snapshot().bgRef).toBeUndefined()
    expect(s.snapshot().bgCss).toContain('background')
  })

  it('a legacy cssText-only save still paints the background', async () => {
    const t = stage()
    await t.restore({ bgCss: 'background-image: url("https://old/bg.png");', chars: [], text: '', dialog: false }, undefined, resolver)
    expect(t.root.querySelector<HTMLElement>('.nilvn-bg-item')!.style.backgroundImage).toContain('https://old/bg.png')
  })

  it('stores sprite and window-skin refs', async () => {
    const s = stage()
    await s.showSprite('star', { url: 'data:image/png;base64,AAA=', ref: 'fx/star.png', frames: 4, fps: 8, loop: true }, 0)
    s.setWindowSkin('window:dialog', 'data:image/png;base64,BBB=', 'ui/box.png')
    const snap = s.snapshot()
    expect(snap.sprites![0]!.url).toBe('fx/star.png')
    expect(snap.windows![0]!.skin).toBe('ui/box.png')
    const t = stage()
    await t.restore(snap, undefined, resolver)
    expect(t.snapshot().sprites![0]!.url).toBe('fx/star.png')
    expect(t.snapshot().windows![0]!.skin).toBe('ui/box.png')
    expect(t.root.querySelector<HTMLElement>('.nilvn-dialog')!.style.backgroundImage).toContain('https://cdn/ui/box.png')
  })
})

describe('engine saves through the by-ref table', () => {
  function engine(): Engine {
    const container = document.createElement('div')
    document.body.append(container)
    return createEngine({
      container,
      textSpeed: 0,
      alias: { '@bg': 'assets/bg' },
      assets: { 'assets/bg/room.svg': 'data:image/svg+xml;base64,AAA=' },
      actors: { yuki: { sprites: 'assets/char/yuki-{face}.svg', defaultFace: 'happy' } },
    })
  }
  const SCRIPT = '[label s1]\n[bg @bg/room.svg]\n[char yuki happy]\n[set x = 1]\n'

  it('saveState carries refs (no data URIs) and restoreState re-resolves them', async () => {
    const e = engine()
    e.loadSource(SCRIPT)
    await e.start()
    const save = e.saveState()
    expect(save.stage.bgRef).toBe('@bg/room.svg')
    expect(save.stage.chars[0]!.src).toBe('assets/char/yuki-happy.svg')
    expect(JSON.stringify(save)).not.toContain('base64')
    save.at = { label: 's1', offset: 3 }
    const e2 = engine()
    e2.loadSource(SCRIPT)
    expect(await e2.restoreState(save)).toBe(true)
    const bg = e2.stage.root.querySelector<HTMLElement>('.nilvn-bg-item')!
    expect(bg.style.backgroundImage).toContain('data:image/svg+xml;base64,AAA=') // by-ref table hit
    expect(e2.stage.charElement('yuki')!.querySelector('img')!.src).toContain('assets/char/yuki-happy.svg')
    e.destroy()
    e2.destroy()
  })
})
