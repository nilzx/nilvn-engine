// @vitest-environment jsdom
// What a save has to carry off the stage, beyond the obvious. Two channels used to be
// dropped silently — each is invisible until a load, and each comes back as a stage that
// disagrees with the story that was running.
import { describe, it, expect, beforeAll } from 'vitest'
import { DomRenderer } from '../src/stage'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

function freshStage(): DomRenderer {
  return new DomRenderer(document.createElement('div'))
}

/** Put a character on stage without waiting on an image jsdom will never load. */
async function withYuki(stage: DomRenderer): Promise<void> {
  await stage.showChar('yuki', 'yuki.png', { at: '50', fade: 0 })
}

const fader = (stage: DomRenderer): HTMLElement => stage.root.querySelector<HTMLElement>('.nilvn-fader')!

describe('a held screen cover in StageState', () => {
  it('is absent while the screen is clear', () => {
    expect(freshStage().snapshot().cover).toBeUndefined()
  })

  it('persists what [fadeout] is holding, colour and all', async () => {
    const stage = freshStage()
    await stage.fadeScreen(1, 0, '#101820')
    expect(stage.snapshot().cover).toEqual({ color: 'rgb(16, 24, 32)', opacity: 1 })
  })

  it('persists a partial dim, not just a blackout', async () => {
    const stage = freshStage()
    await stage.fadeScreen(0.4, 0)
    expect(stage.snapshot().cover?.opacity).toBe(0.4)
  })

  it('persists the cover a [transout] handed to the fader', async () => {
    const stage = freshStage()
    await stage.transitionScreen(1, 0.01, { shape: 'wipe', color: '#112233' })
    expect(stage.snapshot().cover?.opacity).toBe(1)
  })

  it('round-trips: save under a cover, load, still covered', async () => {
    const a = freshStage()
    await a.fadeScreen(1, 0, '#000')
    const b = freshStage()
    await b.restore(a.snapshot())
    expect(fader(b).style.opacity).toBe('1')
    // And the load is itself saveable — the state doesn't decay on a second round trip.
    expect(b.snapshot().cover?.opacity).toBe(1)
  })

  it('a state with no cover clears one that is up — [end] black on restart', async () => {
    const stage = freshStage()
    await stage.fadeScreen(1, 0)
    await stage.restore({ chars: [], text: '', dialog: false })
    expect(fader(stage).style.opacity).toBe('0')
  })

  it('is dropped once a reveal clears it', async () => {
    const stage = freshStage()
    await stage.fadeScreen(1, 0)
    await stage.fadeScreen(0, 0)
    expect(stage.snapshot().cover).toBeUndefined()
  })
})

describe('percent transform offsets in a resting pose', () => {
  it('keeps a percent x/y on a character rather than dropping the channel', async () => {
    // The camera has kept its unit since percent panning landed; characters were still
    // gated on `typeof === "number"`, so an event-frame that settled an actor at "5%"
    // saved with the offset missing — and the actor loaded standing where it started,
    // while every other channel came back.
    const stage = freshStage()
    await withYuki(stage)
    stage.setProp('character:yuki', 'x', '5%')
    stage.setProp('character:yuki', 'y', '-2.5%')
    expect(stage.snapshot().chars[0]).toMatchObject({ tx: '5%', ty: '-2.5%' })
  })

  it('still omits both at rest, so an untouched save stays byte-identical', async () => {
    const stage = freshStage()
    await withYuki(stage)
    const c = stage.snapshot().chars[0]!
    expect(c.tx).toBeUndefined()
    expect(c.ty).toBeUndefined()
    // "0%" is rest too, not a value worth writing.
    stage.setProp('character:yuki', 'x', '0%')
    expect(stage.snapshot().chars[0]!.tx).toBeUndefined()
  })

  it('restores a percent offset back onto the element', async () => {
    const stage = freshStage()
    await stage.restore({ chars: [{ id: 'yuki', src: 'yuki.png', at: 50, tx: '5%', ty: -12 }], text: '', dialog: false })
    expect(stage.getProp('character:yuki', 'x')).toBe('5%')
    expect(stage.getProp('character:yuki', 'y')).toBe(-12)
    expect(stage.objectElement('character:yuki')!.style.transform).toContain('translate(5%, -12px)')
  })

  it('keeps carrying plain pixel offsets, the case that always worked', async () => {
    const stage = freshStage()
    await withYuki(stage)
    stage.setProp('character:yuki', 'x', 40)
    expect(stage.snapshot().chars[0]).toMatchObject({ tx: 40 })
  })
})
