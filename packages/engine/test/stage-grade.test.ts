// @vitest-environment jsdom
// The camera's colour grade: six numeric channels composed into one CSS `filter`.
// Identity paints nothing (pixel-identical to before the channels existed), a save
// carries only the non-identity ones, and an animated grade spells out every
// function so WAAPI can tween between frames whose non-identity sets differ.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { DomRenderer } from '../src/stage'
import { BUILTIN_KINDS } from '../src/object'

let captured: Keyframe[][] = []

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: (k: Keyframe[]) => unknown }).animate = (frames: Keyframe[]) => {
    captured.push(frames)
    return { finished: Promise.resolve(), finish() {} }
  }
})
afterEach(() => {
  captured = []
})

function freshStage(): DomRenderer {
  return new DomRenderer(document.createElement('div'))
}

const FULL_IDENTITY = 'hue-rotate(0deg) invert(0) saturate(1) brightness(1) contrast(1) grayscale(0)'

describe('camera colour grade', () => {
  it('is recordable on the camera and nowhere else', () => {
    const ids = (kind: string) => BUILTIN_KINDS.find((k) => k.id === kind)!.recordable!.map((p) => p.id)
    expect(ids('camera')).toEqual(expect.arrayContaining(['hue', 'invert', 'saturate', 'brightness', 'contrast', 'grayscale']))
    expect(ids('character')).not.toContain('hue')
    expect(ids('window')).not.toContain('hue')
  })

  it('paints nothing at identity', () => {
    const stage = freshStage()
    stage.setProp('camera', 'x', 10)
    expect(stage.objectElement('camera')!.style.filter).toBe('')
  })

  it('composes the non-identity channels in a fixed order', () => {
    const stage = freshStage()
    stage.setProp('camera', 'invert', 1)
    stage.setProp('camera', 'hue', 90)
    stage.setProp('camera', 'saturate', 3)
    expect(stage.objectElement('camera')!.style.filter).toBe('hue-rotate(90deg) invert(1) saturate(3)')
    stage.setProp('camera', 'hue', 0)
    stage.setProp('camera', 'invert', 0)
    stage.setProp('camera', 'saturate', 1)
    expect(stage.objectElement('camera')!.style.filter).toBe('')
  })

  it('clamps invert / grayscale to 0..1 and multipliers to ≥ 0 in the CSS', () => {
    const stage = freshStage()
    stage.setProp('camera', 'invert', 1.4)
    stage.setProp('camera', 'brightness', -2)
    expect(stage.objectElement('camera')!.style.filter).toBe('invert(1) brightness(0)')
  })

  it('leaves other objects unpainted', async () => {
    const stage = freshStage()
    await stage.showChar('yuki', 'x.png', { fade: 0 })
    stage.setProp('character:yuki', 'hue', 120)
    expect(stage.objectElement('character:yuki')!.style.filter).toBe('')
    await stage.animate('character:yuki', [{ hue: 0 }, { hue: 180 }], { durationSec: 0.1 })
    expect(captured.at(-1)!.every((f) => f.filter === undefined)).toBe(true)
  })

  it('saves only the non-identity channels and restores them', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'grayscale', 0.5)
    stage.setProp('camera', 'contrast', 1.4)
    const snap = stage.snapshot()
    expect(snap.camera).toEqual({ grayscale: 0.5, contrast: 1.4 })

    const other = freshStage()
    await other.restore(snap)
    expect(other.getProp('camera', 'grayscale')).toBe(0.5)
    expect(other.objectElement('camera')!.style.filter).toBe('contrast(1.4) grayscale(0.5)')
    // A later restore without a grade clears it.
    await other.restore({ chars: [], text: '', dialog: false })
    expect(other.objectElement('camera')!.style.filter).toBe('')
  })

  it('animates every frame with the full function list', async () => {
    const stage = freshStage()
    await stage.animate('camera', [{ hue: 0 }, { hue: 180, invert: 1 }, { hue: 0, invert: 0 }], { durationSec: 0.3 })
    const frames = captured[0]!
    expect(frames[0]!.filter).toBe(FULL_IDENTITY)
    expect(frames[1]!.filter).toBe('hue-rotate(180deg) invert(1) saturate(1) brightness(1) contrast(1) grayscale(0)')
    expect(frames[2]!.filter).toBe(FULL_IDENTITY)
    // A grade-free animation leaves `filter` alone.
    await stage.animate('camera', [{ x: 0 }, { x: 10 }], { durationSec: 0.1 })
    expect(captured[1]!.every((f) => f.filter === undefined)).toBe(true)
  })

  it("composes offset frames by each channel's identity", async () => {
    const stage = freshStage()
    stage.setProp('camera', 'hue', 30)
    stage.setProp('camera', 'saturate', 2)
    await stage.animate('camera', [{ hue: 60, saturate: 1.5, invert: 0.5 }], { durationSec: 0.1, compose: 'offset' })
    // hue adds, saturate multiplies, invert adds onto its resting 0.
    expect(captured[0]![0]!.filter).toBe('hue-rotate(90deg) invert(0.5) saturate(3) brightness(1) contrast(1) grayscale(0)')
  })
})
