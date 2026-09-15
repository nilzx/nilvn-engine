// @vitest-environment jsdom
// Window objectification: the dialogue box is the
// built-in `window:dialog` stage object — posable through the generic transform
// surface, reskinnable via setWindowSkin, persisted in StageState.windows (omitted
// entirely at rest so pre-window saves stay byte-identical).
import { describe, it, expect, beforeAll } from 'vitest'
import { DomRenderer } from '../src/stage'
import { createEngine, type EnginePlugin } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

function freshStage(): DomRenderer {
  return new DomRenderer(document.createElement('div'))
}

describe('window:dialog on the generic object surface', () => {
  it('resolves for get/set and paints the pose onto the dialog element', () => {
    const stage = freshStage()
    expect(stage.hasObject('window:dialog')).toBe(true)
    stage.setProp('window:dialog', 'x', -40)
    stage.setProp('window:dialog', 'scale', 0.8)
    expect(stage.getProp('window:dialog', 'x')).toBe(-40)
    const el = stage.objectElement('window:dialog')!
    expect(el.className).toContain('nilvn-dialog')
    expect(el.style.transform).toContain('translate(-40px, 0px)')
    expect(el.style.transform).toContain('scale(0.8)')
  })

  it('keeps a percent offset as a percent (resolves against the window box)', () => {
    const stage = freshStage()
    stage.setProp('window:dialog', 'y', '-10%')
    expect(stage.objectElement('window:dialog')!.style.transform).toContain('translate(0px, -10%)')
    expect(stage.snapshot().windows).toEqual([{ id: 'dialog', y: '-10%' }])
  })

  it('objectIdAt reports the dialog (and its children) as the window object', () => {
    const stage = freshStage()
    const el = stage.objectElement('window:dialog')!
    expect(stage.objectIdAt(el)).toBe('window:dialog')
    expect(stage.objectIdAt(el.firstElementChild)).toBe('window:dialog')
    // The camera element still hit-tests as background, not as any object.
    expect(stage.objectIdAt(stage.objectElement('camera'))).toBeNull()
  })

  it('objectIds enumerates world objects first, then the screen-space singletons', async () => {
    const stage = freshStage()
    expect(stage.objectIds()).toEqual(['camera', 'window:dialog'])
    await stage.showChar('yuki', 'x.png', { fade: 0 })
    expect(stage.objectIds()).toEqual(['character:yuki', 'camera', 'window:dialog'])
  })
})

describe('window state in StageState', () => {
  it('omits the windows field entirely at rest (pre-window saves byte-identical)', () => {
    const stage = freshStage()
    expect(stage.snapshot().windows).toBeUndefined()
  })

  it('persists non-identity channels + skin and drops identity ones', () => {
    const stage = freshStage()
    stage.setProp('window:dialog', 'rotation', -3)
    stage.setProp('window:dialog', 'opacity', 0.7)
    stage.setWindowSkin('window:dialog', 'https://x/skin.png')
    expect(stage.snapshot().windows).toEqual([{ id: 'dialog', rotation: -3, opacity: 0.7, skin: 'https://x/skin.png' }])
  })

  it('restore applies a saved window pose + skin', async () => {
    const stage = freshStage()
    await stage.restore({ chars: [], text: '', dialog: true, windows: [{ id: 'dialog', x: 25, scale: 1.2, skin: 'https://x/skin.png' }] })
    expect(stage.getProp('window:dialog', 'x')).toBe(25)
    expect(stage.getProp('window:dialog', 'scale')).toBe(1.2)
    const el = stage.objectElement('window:dialog')!
    expect(el.style.backgroundImage).toContain('skin.png')
    expect(el.style.backgroundSize).toBe('100% 100%')
  })

  it('restore without a windows field resets a posed / skinned window', async () => {
    const stage = freshStage()
    stage.setProp('window:dialog', 'x', 100)
    stage.setWindowSkin('window:dialog', 'https://x/skin.png')
    await stage.restore({ chars: [], text: '', dialog: false })
    expect(stage.getProp('window:dialog', 'x')).toBe(0)
    const el = stage.objectElement('window:dialog')!
    expect(el.style.transform).toBe('none')
    expect(el.style.backgroundImage).toBe('')
    expect(stage.snapshot().windows).toBeUndefined()
  })
})

describe('window skin', () => {
  it('setWindowSkin dresses and undresses the dialog', () => {
    const stage = freshStage()
    const el = stage.objectElement('window:dialog')!
    stage.setWindowSkin('window:dialog', 'https://x/a.png')
    expect(el.style.backgroundImage).toContain('a.png')
    expect(el.style.borderColor).toBe('transparent')
    stage.setWindowSkin('window:dialog', undefined)
    expect(el.style.backgroundImage).toBe('')
    expect(el.style.borderColor).toBe('')
  })

  it('ignores unknown window ids', () => {
    const stage = freshStage()
    stage.setWindowSkin('window:shop', 'https://x/a.png')
    expect(stage.objectElement('window:dialog')!.style.backgroundImage).toBe('')
    expect(stage.snapshot().windows).toBeUndefined()
  })

  it('[window skin=…] command applies it; skin=none restores the default', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const engine = createEngine({ container, textSpeed: 0 })
    engine.loadSource('[window skin=assets/ui/box.png]\n[window skin=none]\n')
    await engine.start()
    // Both commands ran (pure command script, start() resolves at the end): the
    // second restored the default chrome, proving apply AND clear paths execute.
    const el = container.querySelector<HTMLElement>('.nilvn-dialog')!
    expect(el.style.backgroundImage).toBe('')
    engine.destroy()
    const c2 = document.createElement('div')
    document.body.append(c2)
    const e2 = createEngine({ container: c2, textSpeed: 0 })
    e2.loadSource('[window skin=assets/ui/box.png]\n')
    await e2.start()
    expect(c2.querySelector<HTMLElement>('.nilvn-dialog')!.style.backgroundImage).toContain('box.png')
    e2.destroy()
  })
})

describe('event-frame window track (the anim-studio zero-change acceptance)', () => {
  it('plays a window track from the wire and settles the end pose', async () => {
    // The exact wire the serializer emits for a recorded window animation, fed
    // through the stage capability the way the animstudio plugin does (the
    // engine decodes it). Nothing here is window-specific — this passing proves
    // the recorder kind generalization + object registry seams are real (P4).
    const container = document.createElement('div')
    document.body.append(container)
    const ef: EnginePlugin = { id: 'test.ef', permissions: ['stage.write'], commands: { ef: ({ plugin, num, str }) => plugin.stage!.playFrames(num('dur', 1), str('kf', '')) } }
    const engine = createEngine({ container, textSpeed: 0, plugins: [ef] })
    engine.loadSource('[ef dur=0.2 kf=window:dialog#0:y=0;0.2:y=-141]\n')
    await engine.start()
    expect(engine.stage.getProp('window:dialog', 'y')).toBe(-141)
    expect(engine.stage.snapshot().windows).toEqual([{ id: 'dialog', y: -141 }])
    engine.destroy()
  })
})

describe('pose vs. show/hide interplay', () => {
  it('a pose-driven opacity stands the CSS transition down; releasing it restores', () => {
    const stage = freshStage()
    const el = stage.objectElement('window:dialog')!
    stage.setProp('window:dialog', 'opacity', 0.5)
    expect(el.style.transitionProperty).toBe('none')
    expect(el.style.opacity).toBe('0.5')
    stage.setProp('window:dialog', 'opacity', 1)
    expect(el.style.transitionProperty).toBe('')
    expect(el.style.opacity).toBe('')
  })
})
