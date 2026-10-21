// @vitest-environment jsdom
// The IR's nested branches (schema v14) round-trip through the serializer into
// routes the engine actually plays: each body runs only when its option / case
// is taken, and every route merges back after its choice.
import { describe, it, expect } from 'vitest'
import { serializeProject } from '@nilvn/core'
import { createEngine } from '../src/index'
import { nestedProject } from '../../core/test/nested-fixture'

const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!cond()) throw new Error('timed out')
}

async function play(picks: number[]): Promise<string> {
  const container = document.createElement('div')
  document.body.append(container)
  const e = createEngine({ container, textSpeed: 0 })
  e.loadSource(serializeProject(nestedProject()))
  void e.start()
  for (const pick of picks) {
    await until(() => e.stage.choicesEl.querySelectorAll('.nilvn-choice').length > 0)
    const buttons = e.stage.choicesEl.querySelectorAll<HTMLButtonElement>('.nilvn-choice')
    buttons[pick]!.click()
    // The next prompt may follow at once (a nested choice): wait for this one to go.
    await until(() => !buttons[0]!.isConnected)
  }
  await until(() => String(e.vars.trail ?? '').endsWith('.'))
  const trail = String(e.vars.trail)
  e.destroy()
  container.remove()
  return trail
}

describe('nested branches play as their tree says', () => {
  it('A then A-a: both bodies, merge, condition case holds', async () => {
    expect(await play([0, 0])).toBe('Aa!|T.')
  })
  it('A then A-b', async () => {
    expect(await play([0, 1])).toBe('Ab!|T.')
  })
  it('B: its body only, the condition falls to else', async () => {
    expect(await play([1])).toBe('B|E.')
  })
  it('an empty body merges straight back', async () => {
    expect(await play([2])).toBe('|E.')
  })
})

describe('a guarded node runs only when its condition holds', () => {
  it('skips the node and everything nested in it', async () => {
    const p = nestedProject()
    p.scenes[0]!.nodes = [
      { kind: 'set', id: 'init', var: 'trail', expr: '""' },
      { kind: 'set', id: 'g1', var: 'trail', expr: 'trail + "1"', condition: 'trust >= 1' },
      { kind: 'set', id: 'up', var: 'trust', expr: '1' },
      { kind: 'set', id: 'g2', var: 'trail', expr: 'trail + "2"', condition: 'trust >= 1' },
      { kind: 'branch', id: 'b', condition: 'trust > 5', cases: [{ condition: 'true', body: [{ kind: 'set', id: 'x', var: 'trail', expr: 'trail + "X"' }] }] },
      { kind: 'set', id: 'end', var: 'trail', expr: 'trail + "."' },
    ]
    const container = document.createElement('div')
    document.body.append(container)
    const e = createEngine({ container, textSpeed: 0 })
    e.loadSource(serializeProject(p))
    void e.start()
    await until(() => String(e.vars.trail ?? '').endsWith('.'))
    expect(e.vars.trail).toBe('2.')
    e.destroy()
    container.remove()
  })
})
