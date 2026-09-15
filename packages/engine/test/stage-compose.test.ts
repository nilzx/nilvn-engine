// @vitest-environment jsdom
// How an animation's frames combine with the object's RESTING pose (AnimOpts.compose).
// A transient gesture (a rumble, a hop) is a DISPLACEMENT and must ride on top of
// wherever the object currently sits; a state change ([fade] / [scale]) replaces the
// channels it names. Getting this wrong is invisible until something is already posed:
// shaking a panned camera used to snap the framing back to the origin for the shake.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { DomRenderer } from '../src/stage'

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

/** Every distinct transform string the last animation asked for. */
function transforms(): string[] {
  return (captured[0] ?? []).map((f) => String(f.transform))
}

describe("compose: 'offset' (transient gestures)", () => {
  it('displaces a percent camera pan through calc instead of replacing it', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'x', '12.5%')
    await stage.animate('camera', [{ x: 0, y: 0 }, { x: -8, y: 5 }, { x: 0, y: 0 }], { durationSec: 0.2, compose: 'offset' })
    expect(transforms()).toEqual([
      'translate(12.5%, 0px)',
      'translate(calc(12.5% - 8px), 5px)',
      'translate(12.5%, 0px)',
    ])
  })

  it('adds same-unit offsets numerically', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'x', 100)
    await stage.animate('camera', [{ x: 12 }], { durationSec: 0.2, compose: 'offset' })
    expect(transforms()).toEqual(['translate(112px, 0px)'])
  })

  it('adds rotation and multiplies scale, each by its own identity', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'rotation', 30)
    stage.setProp('camera', 'scale', 2)
    await stage.animate('camera', [{ rotation: -2.5, scale: 1.1 }], { durationSec: 0.2, compose: 'offset' })
    expect(transforms()).toEqual(['scale(2.2) rotate(27.5deg)'])
  })

  it('leaves an untouched object at its plain resting transform', async () => {
    const stage = freshStage()
    await stage.animate('camera', [{ x: 0 }, { x: 6 }], { durationSec: 0.2, compose: 'offset' })
    expect(transforms()).toEqual(['none', 'translate(6px, 0px)'])
  })
})

describe("compose: 'absolute' (default — state changes)", () => {
  it('replaces the channels a frame names and keeps the rest of the pose', async () => {
    const stage = freshStage()
    stage.setProp('camera', 'x', 100)
    stage.setProp('camera', 'scale', 2)
    await stage.animate('camera', [{ scale: 1 }, { scale: 1.5 }], { durationSec: 0.2 })
    // x survives (it comes from the resting model), scale is exactly what was asked
    // for — the resting 2 is overridden, and an identity scale drops out of the CSS.
    expect(transforms()).toEqual(['translate(100px, 0px)', 'translate(100px, 0px) scale(1.5)'])
  })
})
