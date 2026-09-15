import { describe, it, expect } from 'vitest'
import {
  decodeChannelSet,
  decodeFrames,
  decodeTracks,
  easeFn,
  sampleContinuous,
  sampleContinuousCarry,
  discreteAt,
} from '../src/keyframes'

// The keyframe wire codec + interpolation core (batch 4e / the animation redesign).
// Pure math shared by the event-frame player and the loop runtime — a regression here
// silently corrupts every recorded animation.
describe('decodeChannelSet', () => {
  it('parses `id=value` pairs, skipping malformed tokens', () => {
    expect(decodeChannelSet('x=10,y=20')).toEqual({ x: '10', y: '20' })
    expect(decodeChannelSet('x=1,,bad,=novalue,y=2')).toEqual({ x: '1', y: '2' })
  })
})

describe('decodeFrames', () => {
  it('decodes `t[~ease][:channels]` frames and sorts by time', () => {
    expect(decodeFrames('1:x=10;0:x=0')).toEqual([
      { t: 0, ch: { x: '0' }, ease: undefined },
      { t: 1, ch: { x: '10' }, ease: undefined },
    ])
  })

  it('captures per-frame easing and empty channel sets', () => {
    expect(decodeFrames('0~io:x=0')).toEqual([{ t: 0, ch: { x: '0' }, ease: 'io' }])
    expect(decodeFrames('0.5')).toEqual([{ t: 0.5, ch: {}, ease: undefined }])
  })
})

describe('decodeTracks', () => {
  it('splits `objId#frames|objId#frames` into tracks', () => {
    const tracks = decodeTracks('a#0:x=1|b#0:y=2')
    expect(tracks.map((t) => t.objId)).toEqual(['a', 'b'])
    expect(tracks[0]!.keys[0]!.ch).toEqual({ x: '1' })
  })

  it('returns an empty list for empty input and skips prefix-less tracks', () => {
    expect(decodeTracks('')).toEqual([])
    expect(decodeTracks('noHashHere')).toEqual([])
  })
})

describe('easeFn', () => {
  it('falls back to linear for undefined / unknown codes', () => {
    expect(easeFn(undefined)(0.3)).toBe(0.3)
    expect(easeFn('nonsense')(0.7)).toBe(0.7)
  })

  it('treats `hold` as a step (always 0 until the next keyframe)', () => {
    expect(easeFn('hold')(0.9)).toBe(0)
  })

  it('pins endpoints and stays monotonic for a bezier curve', () => {
    const io = easeFn('io')
    expect(io(0)).toBe(0)
    expect(io(1)).toBe(1)
    expect(io(0.5)).toBeCloseTo(0.5, 5) // io is symmetric about the midpoint
  })
})

describe('sampleContinuous', () => {
  const keys = decodeFrames('0:x=0;10:x=100')

  it('interpolates linearly and clamps at both ends', () => {
    expect(sampleContinuous(keys, 'x', 5)).toBe(50)
    expect(sampleContinuous(keys, 'x', -1)).toBe(0)
    expect(sampleContinuous(keys, 'x', 20)).toBe(100)
  })

  it('returns undefined for a channel the track never defines', () => {
    expect(sampleContinuous(keys, 'y', 5)).toBeUndefined()
  })

  it('a `hold` segment keeps the left value across the span', () => {
    const held = decodeFrames('0~hold:x=0;10:x=100')
    expect(sampleContinuous(held, 'x', 5)).toBe(0)
  })
})

describe('sampleContinuousCarry', () => {
  it('interpolates between temporally-adjacent effective poses (carry-forward)', () => {
    // x defined at t0 and t10; a y-only keyframe sits at t5. Carry-forward interpolates
    // x between the poses at t5 (carried 0) and t10 (100): at t7 → 40. The per-channel
    // sampler, by contrast, slides x from t0→t10 directly: at t7 → 70.
    const keys = decodeFrames('0:x=0;5:y=99;10:x=100')
    expect(sampleContinuousCarry(keys, 'x', 7)).toBeCloseTo(40, 5)
    expect(sampleContinuous(keys, 'x', 7)).toBeCloseTo(70, 5)
  })

  // Percent lengths are how a resolution-independent camera pan is authored: the unit
  // has to survive interpolation, or the shot silently becomes a pixel offset that
  // reframes at every other output size.
  it('keeps a percent unit through interpolation and at the ends', () => {
    const keys = decodeFrames('0:x=0%;1:x=20%')
    expect(sampleContinuousCarry(keys, 'x', 0)).toBe('0%')
    expect(sampleContinuousCarry(keys, 'x', 0.5)).toBe('10%')
    expect(sampleContinuousCarry(keys, 'x', 2)).toBe('20%')
  })

  it('treats a bare 0 as unit-agnostic, so a percent key still lands in percent', () => {
    // kf0 snapshots an untouched camera as a plain 0; the first authored pan is percent.
    expect(sampleContinuousCarry(decodeFrames('0:x=0;1:x=12.5%'), 'x', 1)).toBe('12.5%')
    expect(sampleContinuousCarry(decodeFrames('0:x=0;1:x=12.5%'), 'x', 0.5)).toBe('6.25%')
  })

  it('leaves pixel tracks alone (numbers in, numbers out)', () => {
    expect(sampleContinuousCarry(decodeFrames('0:x=0;1:x=100'), 'x', 0.5)).toBe(50)
  })
})

describe('discreteAt', () => {
  const keys = decodeFrames('0:face=a;5:face=b;10:face=c')

  it('snaps to the latest keyframe at or before t', () => {
    expect(discreteAt(keys, 'face', 0)).toBe('a')
    expect(discreteAt(keys, 'face', 7)).toBe('b')
    expect(discreteAt(keys, 'face', 100)).toBe('c')
  })

  it('is undefined before the channel is ever set', () => {
    expect(discreteAt(keys, 'face', -1)).toBeUndefined()
  })
})
