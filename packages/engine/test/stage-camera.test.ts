// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { DomRenderer } from '../src/stage'

// jsdom has no WAAPI: stub Element.animate with an instantly-finished animation so
// the renderer's `animate()` helper resolves (its wall-clock fallback would also
// fire, but the resolved `finished` settles first).
beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

function freshStage(): DomRenderer {
  return new DomRenderer(document.createElement('div'))
}

describe('camera resting transform in StageState', () => {
  it('omits the camera field entirely at identity', () => {
    const stage = freshStage()
    expect(stage.snapshot().camera).toBeUndefined()
  })

  it('persists non-identity channels and drops identity ones', () => {
    const stage = freshStage()
    stage.setProp('camera', 'x', -120)
    stage.setProp('camera', 'scale', 1.5)
    expect(stage.snapshot().camera).toEqual({ x: -120, scale: 1.5 })
  })

  it('restore applies a saved camera pose', async () => {
    const stage = freshStage()
    await stage.restore({ chars: [], text: '', dialog: false, camera: { y: 40, rotation: -8 } })
    expect(stage.getProp('camera', 'y')).toBe(40)
    expect(stage.getProp('camera', 'rotation')).toBe(-8)
    expect(stage.getProp('camera', 'x')).toBe(0)
    expect(stage.getProp('camera', 'scale')).toBe(1)
  })

  it('restore without a camera field resets a moved camera to identity', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'scale', 2)
    stage.setProp('camera', 'x', 300)
    await stage.restore({ chars: [], text: '', dialog: false })
    expect(stage.getProp('camera', 'scale')).toBe(1)
    expect(stage.getProp('camera', 'x')).toBe(0)
    expect(stage.snapshot().camera).toBeUndefined()
    // The DOM transform is cleared too, not just the model.
    expect(stage.objectElement('camera')!.style.transform).toBe('none')
  })

  it('keeps a percent pan as a percent (through the model, the CSS and a save)', () => {
    // The editor authors camera pans as a percent of the stage so the framing survives
    // any output size; the whole path has to carry the unit rather than collapse to px.
    const stage = freshStage()
    stage.setProp('camera', 'x', '12.5%')
    expect(stage.objectElement('camera')!.style.transform).toContain('translate(12.5%, 0px)')
    expect(stage.snapshot().camera).toEqual({ x: '12.5%' })
  })

  it('restore re-applies a percent pan verbatim', async () => {
    const stage = freshStage()
    await stage.restore({ chars: [], text: '', dialog: false, camera: { x: '-8%', y: '4%' } })
    expect(stage.getProp('camera', 'x')).toBe('-8%')
    expect(stage.objectElement('camera')!.style.transform).toContain('translate(-8%, 4%)')
  })

  it('persists a screen dim / hide the camera is holding', () => {
    // [fade|opacity|visibility target=screen] resolve to the camera and STAY there
    // (objectfx writes the resting model), so a save taken under a dim must come back dim.
    const stage = freshStage()
    stage.setProp('camera', 'opacity', 0.3)
    stage.setProp('camera', 'visible', false)
    expect(stage.snapshot().camera).toEqual({ opacity: 0.3, visible: false })
  })

  it('restore re-applies the saved dim and clears it when absent', async () => {
    const stage = freshStage()
    await stage.restore({ chars: [], text: '', dialog: false, camera: { opacity: 0.3 } })
    expect(stage.getProp('camera', 'opacity')).toBe(0.3)
    expect(stage.getProp('camera', 'visible')).toBe(true)
    await stage.restore({ chars: [], text: '', dialog: false })
    expect(stage.getProp('camera', 'opacity')).toBe(1)
  })

  it('objectElement resolves the camera (the editor anchors its frame on it)', () => {
    const stage = freshStage()
    const el = stage.objectElement('camera')
    expect(el).not.toBeNull()
    expect(stage.root.contains(el!)).toBe(true)
    // But hit-testing still never reports the camera (background presses stay background).
    expect(stage.objectIdAt(el)).toBeNull()
  })
})

describe('transitionScreen', () => {
  it('cover hands off to the fader and removes its overlay', async () => {
    const stage = freshStage()
    const before = stage.root.childElementCount
    await stage.transitionScreen(1, 0.01, { shape: 'wipe', dir: 'left', color: '#112233' })
    const fader = stage.root.querySelector<HTMLElement>('.nilvn-fader')!
    expect(fader.style.opacity).toBe('1')
    expect(fader.style.background).toContain('17, 34, 51') // #112233 as rgb
    expect(stage.root.childElementCount).toBe(before) // transient overlay removed
  })

  it('reveal drops the fader and cleans up (blinds shape)', async () => {
    const stage = freshStage()
    await stage.transitionScreen(1, 0.01)
    await stage.transitionScreen(0, 0.01, { shape: 'blinds' })
    const fader = stage.root.querySelector<HTMLElement>('.nilvn-fader')!
    expect(fader.style.opacity).toBe('0')
    expect(stage.root.querySelectorAll('div').length).toBeGreaterThan(0)
  })

  it('a load resets a covered screen (restore clears the fader)', async () => {
    const stage = freshStage()
    await stage.transitionScreen(1, 0.01, { shape: 'circle' })
    await stage.restore({ chars: [], text: '', dialog: false })
    expect(stage.root.querySelector<HTMLElement>('.nilvn-fader')!.style.opacity).toBe('0')
  })

  it('a restore mid-transition wins — the finishing cover does not re-blacken', async () => {
    // Loading / restarting / entering a replay while a [transout] is in flight: the
    // transition's hand-off to the fader lands AFTER the restore has repainted, which
    // used to leave the player on a black screen with the story running underneath.
    // The shape animation is gated here so it genuinely finishes last (a long duration
    // keeps `animate`'s wall-clock fallback out of the race).
    const proto = Element.prototype as unknown as { animate: () => unknown }
    const original = proto.animate
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    proto.animate = () => ({ finished: gate, finish: () => release() })
    try {
      const stage = freshStage()
      const before = stage.root.childElementCount
      const inFlight = stage.transitionScreen(1, 5, { shape: 'circle' })
      await stage.restore({ chars: [], text: '', dialog: false })
      release()
      await inFlight
      expect(stage.root.querySelector<HTMLElement>('.nilvn-fader')!.style.opacity).toBe('0')
      expect(stage.root.childElementCount).toBe(before) // its overlay still cleans up
    } finally {
      proto.animate = original
    }
  })
})
