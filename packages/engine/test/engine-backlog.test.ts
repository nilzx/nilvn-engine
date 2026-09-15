// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { newEngine, view } from './helpers'

// Runtime dialogue backlog: a capped, session-only ring buffer
// of played lines, never persisted. getBacklog returns a copy; plain text is stored
// (inline effects stripped, br → newline); a voice offset is kept only alongside a ref.
describe('backlog', () => {
  it('records plain text, stripping inline effects and turning br into newline', () => {
    const e = newEngine()
    const v = view(e)
    v.recordBacklog('yuki', [{ kind: 'text', text: 'hi', effect: 'wave' }, { kind: 'pause', sec: 1 }, { kind: 'text', text: '!' }])
    v.recordBacklog('', [{ kind: 'text', text: 'a' }, { kind: 'br' }, { kind: 'text', text: 'b' }])
    const bl = e.getBacklog()
    expect(bl).toHaveLength(2)
    expect(bl[0]).toMatchObject({ speaker: 'yuki', text: 'hi!' }) // effect kept as text, pause dropped
    expect(bl[1]).toMatchObject({ speaker: '', text: 'a\nb' })
  })

  it('keeps a voice ref + offset together, and strips a dangling offset', () => {
    const e = newEngine()
    const v = view(e)
    v.recordBacklog('a', [{ kind: 'text', text: 'x' }], 'voice/hi.webm', 0.2)
    v.recordBacklog('b', [{ kind: 'text', text: 'y' }], undefined, 0.5) // offset without a ref
    const bl = e.getBacklog()
    expect(bl[0]).toMatchObject({ voiceRef: 'voice/hi.webm', offset: 0.2 })
    expect(bl[1].voiceRef).toBeUndefined()
    expect(bl[1].offset).toBeUndefined() // dropped — no ref to seek
  })

  it('getBacklog returns a copy that cannot mutate engine state', () => {
    const e = newEngine()
    view(e).recordBacklog('a', [{ kind: 'text', text: 'x' }])
    const bl = e.getBacklog()
    bl.length = 0
    expect(e.getBacklog()).toHaveLength(1)
  })

  it('caps at 200, keeping the most recent lines (ring buffer)', () => {
    const e = newEngine()
    const v = view(e)
    for (let i = 0; i < 205; i++) v.recordBacklog('s', [{ kind: 'text', text: String(i) }])
    const bl = e.getBacklog()
    expect(bl).toHaveLength(200)
    expect(bl[bl.length - 1]!.text).toBe('204') // newest kept
    expect(bl[0]!.text).toBe('5') // oldest 5 front-trimmed
  })

  it('resetBacklog clears the log', () => {
    const e = newEngine()
    const v = view(e)
    v.recordBacklog('a', [{ kind: 'text', text: 'x' }])
    v.resetBacklog()
    expect(e.getBacklog()).toHaveLength(0)
  })

  it('replayVoice on an empty ref is a no-op that resolves', async () => {
    const e = newEngine()
    await expect(e.replayVoice('')).resolves.toBeUndefined()
  })
})
