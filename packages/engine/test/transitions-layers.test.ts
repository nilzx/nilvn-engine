// @vitest-environment jsdom
// Batch I inc 4 — scene transitions (`[trans …]`, `[bg trans=]`, the snapshot
// layer, the six kinds + rule masks) and layered sprites (`[actors.<id>.layers]`,
// `[char id face body=… extra=…]`, `speaker(face):`, save / restore). jsdom has no
// layout, canvas or WAAPI, so the effects are pinned by their DOM lifecycle and
// the rule mask by its fade fallback.
import { describe, it, expect, beforeAll } from 'vitest'
import { createEngine, MemorySaveStore, scanAssetRefs, type Engine } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
  ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve()
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
const snapshot = (e: Engine): HTMLElement | null => e.stage.root.querySelector<HTMLElement>('.nilvn-snapshot')
const bgUrl = (e: Engine): string => (e.stage.root.querySelector<HTMLElement>('.nilvn-bg-item:last-child')?.style.backgroundImage ?? '')

const LAYERED = {
  mira: {
    name: 'Mira',
    canvas: [600, 1100] as [number, number],
    layers: {
      body: { src: '@char/mira/body-{body}.png', default: 'uniform' },
      face: { src: '@char/mira/face-{face}.png', default: 'happy', offset: [150, 120] as [number, number] },
      extra: { src: '@char/mira/extra-{extra}.png', optional: true },
    },
  },
}
const layerImgs = (e: Engine): HTMLImageElement[] => [...e.stage.root.querySelectorAll<HTMLImageElement>('.nilvn-char[data-id="mira"] .nilvn-char__layers img')]
const layerNames = (e: Engine): string[] => layerImgs(e).map((i) => i.src.replace('http://g.test/@char/mira/', ''))

describe('scene transitions', () => {
  it('[trans] freezes a snapshot of the camera; the next line reveals and drops it', async () => {
    const e = engineWith()
    e.loadSource('[bg #111111]\n[trans wipe dir=left duration=0]\n[bg #222222]\n[set mid = 1]\n[wait 0.08]\nnarr: shown\n')
    void e.start()
    await until(() => e.vars.mid === 1)
    expect(snapshot(e)).not.toBeNull()
    expect(snapshot(e)!.classList.contains('nilvn-camera')).toBe(true) // a clone of the camera, above it
    expect(snapshot(e)!.previousElementSibling?.classList.contains('nilvn-camera')).toBe(true)
    await until(() => text(e) === 'shown')
    expect(snapshot(e)).toBeNull()
    e.destroy()
  })

  it('[trans end] reveals explicitly; [bg trans=] swaps through a transition at once; every kind runs; a bad kind reports', async () => {
    const e = engineWith()
    e.loadSource(
      ['[trans crossfade 0]', '[bg #333333]', '[trans end]', '[set a = 1]', '[bg #444444 trans=circle duration=0]', '[set b = 1]']
        .concat(['fade', 'slide', 'blinds', 'rule'].map((k) => `[trans ${k} duration=0]\n[bg #555555]\n[trans end]`))
        .concat(['[trans swirl]', '[set c = 1]'])
        .join('\n'),
    )
    void e.start()
    await until(() => e.vars.a === 1)
    expect(snapshot(e)).toBeNull()
    await until(() => e.vars.b === 1)
    expect(snapshot(e)).toBeNull()
    await until(() => e.vars.c === 1)
    expect(snapshot(e)).toBeNull()
    expect(e.diagnostics.some((d) => d.message.includes('unknown transition "swirl"'))).toBe(true)
    expect(e.diagnostics.filter((d) => d.phase === 'exec')).toHaveLength(1)
    e.destroy()
  })

  it('a slide keeps the camera\'s resting `none` out of its keyframes (it is not a transform list)', async () => {
    const e = engineWith()
    const frames: Record<string, string>[][] = []
    const proto = Element.prototype as unknown as { animate: (kf: Record<string, string>[]) => unknown }
    const real = proto.animate
    proto.animate = function (this: Element, kf: Record<string, string>[]) {
      if (this.classList.contains('nilvn-snapshot')) frames.push(kf)
      return { finished: Promise.resolve(), finish() {} }
    }
    try {
      e.loadSource('[bg #111111]\n[set ready = 1]\n[wait 0.2]\n[trans slide dir=left duration=0]\n[bg #222222]\n[trans end]\n[set done = 1]')
      void e.start()
      await until(() => e.vars.ready === 1)
      // Writing the camera's resting pose — what loading a save does — leaves the
      // literal `none` in its inline transform (composeTransform's fallback).
      // `translateX(-100%) none` is not a transform list, so the browser would
      // drop that keyframe and play the slide as a cut.
      e.stage.restore(e.stage.snapshot())
      await until(() => e.stage.root.querySelector<HTMLElement>('.nilvn-camera')!.style.transform === 'none')
      await until(() => e.vars.done === 1)
    } finally {
      proto.animate = real
    }
    expect(frames).toHaveLength(1)
    expect(frames[0]!.map((f) => f.transform)).toEqual(['none', 'translateX(-100%)'])
    e.destroy()
  })

  it('a rule mask falls back to a fade when the image cannot be read (no canvas here); restore drops an armed snapshot', async () => {
    const e = engineWith()
    e.loadSource('[trans wipe mask=@fx/rule.png duration=0]\n[bg #666666]\n[trans end]\n[set a = 1]\n[trans circle]\n[bg #777777]\n[set armed = 1]\n[wait 0.08]\nnarr: x\n')
    void e.start()
    await until(() => e.vars.a === 1)
    await until(() => e.vars.armed === 1)
    expect(snapshot(e)).not.toBeNull()
    await e.showTitle() // a session reset drops the armed snapshot (restart would arm a new one at once)
    expect(snapshot(e)).toBeNull()
    e.destroy()
  })

  it('transitionScreen takes a rule mask too (the cover-with-a-colour primitive behind screenfx); fade fallback here', async () => {
    const e = engineWith()
    await e.stage.transitionScreen(1, 0, { mask: 'http://g.test/fx/rule.png', color: '#123456' })
    expect(e.stage.snapshot().cover?.opacity).toBe(1)
    await e.stage.transitionScreen(0, 0, { mask: 'http://g.test/fx/rule.png' })
    expect(e.stage.snapshot().cover).toBeUndefined()
    e.destroy()
  })
})

describe('layered sprites', () => {
  it('composes the layers on the canvas in declaration order; the face is a layer; body/extra come from params; none clears an optional layer', async () => {
    const e = engineWith({ actors: LAYERED })
    e.loadSource('[char mira]\n[set a = 1]\n[wait 0.08]\n[char mira sad body=casual extra=blush]\n[set b = 1]\n[wait 0.08]\nmira(happy): hi\n[char mira extra=none]\n[set c = 1]\n')
    void e.start()
    await until(() => e.vars.a === 1)
    expect(layerNames(e)).toEqual(['body-uniform.png', 'face-happy.png'])
    const box = e.stage.root.querySelector<HTMLElement>('.nilvn-char__layers')!
    expect(box.style.getPropertyValue('--canvas-w')).toBe('600')
    expect(layerImgs(e)[1]!.style.left).toBe('25%') // 150 / 600
    expect(layerImgs(e)[1]!.style.top).toBe(`${(120 / 1100) * 100}%`)
    expect(e.stage.charFace('mira')).toBe('happy')
    await until(() => e.vars.b === 1)
    expect(layerNames(e)).toEqual(['body-casual.png', 'face-sad.png', 'extra-blush.png'])
    expect(e.stage.charLayers('mira')).toEqual({ body: 'casual', face: 'sad', extra: 'blush' })
    await until(() => text(e) === 'hi')
    expect(layerNames(e)).toEqual(['body-casual.png', 'face-happy.png', 'extra-blush.png'])
    e.stage.root.click()
    await until(() => e.vars.c === 1)
    expect(layerNames(e)).toEqual(['body-casual.png', 'face-happy.png'])
    expect(bgUrl(e)).toBe('')
    e.destroy()
  })

  it('a face keyframe (setFace) re-paints the face layer; src= bypasses the layers', async () => {
    const e = engineWith({ actors: LAYERED })
    e.loadSource('[char mira]\n[set a = 1]\n[wait 0.08]\n[char mira src=@char/flat.png]\n[set b = 1]\n')
    void e.start()
    await until(() => e.vars.a === 1)
    e.stage.setFace('character:mira', 'sad')
    expect(layerNames(e)).toEqual(['body-uniform.png', 'face-sad.png'])
    expect(e.stage.charFace('mira')).toBe('sad')
    await until(() => e.vars.b === 1)
    expect(e.stage.root.querySelector('.nilvn-char[data-id="mira"] .nilvn-char__layers')).toBeNull()
    expect(e.stage.root.querySelector<HTMLImageElement>('.nilvn-char[data-id="mira"] img')!.src).toBe('http://g.test/@char/flat.png')
    e.destroy()
  })

  it('saves the layer values (not urls) and rebuilds them on load; a layer without a value reports', async () => {
    const store = new MemorySaveStore()
    const e = engineWith({ actors: LAYERED }, store)
    e.loadSource('[char mira sad body=casual extra=blush at=left]\nnarr: one\nnarr: two\n')
    void e.start()
    await until(() => text(e) === 'one')
    const save = e.saveState()
    expect(save.stage.chars[0]).toMatchObject({ id: 'mira', src: '', face: 'sad', layers: { body: 'casual', face: 'sad', extra: 'blush' }, at: 25 })
    e.stage.root.click()
    await until(() => text(e) === 'two')
    expect(await e.restoreState(save)).toBe(true)
    await until(() => text(e) === 'one')
    expect(layerNames(e)).toEqual(['body-casual.png', 'face-sad.png', 'extra-blush.png'])
    e.destroy()
    const f = engineWith({ actors: { mira: { canvas: [600, 1100], layers: { body: { src: '@char/mira/body-{body}.png' } } } } })
    f.loadSource('[char mira]\n[set a = 1]\n')
    void f.start()
    await until(() => f.vars.a === 1)
    expect(f.diagnostics.some((d) => d.message.includes('layer "body" of "mira" has no value'))).toBe(true)
    f.destroy()
  })

  it('scanAssetRefs lists every layer image a command or face implies', () => {
    const e = engineWith({ actors: LAYERED })
    e.loadSource('[char mira]\n[char mira sad body=casual]\nmira(wink): x\n')
    expect(scanAssetRefs(e['nodes' as never] as never, e.actors)).toEqual([
      '@char/mira/body-uniform.png',
      '@char/mira/face-happy.png',
      '@char/mira/body-casual.png',
      '@char/mira/face-sad.png',
      '@char/mira/face-wink.png',
    ])
    e.destroy()
  })
})
