import { describe, it, expect } from 'vitest'
import { serializeChunk, serializeProject, bodyLabel, mergeLabel } from '../src/serialize'
import { nestedProject } from './nested-fixture'

describe('serializing nested branches (schema v14)', () => {
  it('flattens option bodies and branch cases into labels and merge jumps', () => {
    expect(serializeProject(nestedProject())).toBe(
      [
        '[label s1]',
        '[set trail = ""]',
        '[choice 甲 -> __b_c1_0]',
        '[choice 乙 -> __b_c1_1]',
        '[choice 丙 -> __b_c1_2]',
        '[jump __m_c1]',
        '[label __b_c1_0]',
        '[set trail = trail + "A"]',
        '[set trust = trust + 1]',
        '[choice 甲甲 -> __b_c2_0]',
        '[choice 甲乙 -> __b_c2_1]',
        '[jump __m_c2]',
        '[label __b_c2_0]',
        '[set trail = trail + "a"]',
        '[jump __m_c2]',
        '[label __b_c2_1]',
        '[set trail = trail + "b"]',
        '[jump __m_c2]',
        '[label __m_c2]',
        '[set trail = trail + "!"]',
        '[jump __m_c1]',
        '[label __b_c1_1]',
        '[set trail = trail + "B"]',
        '[jump __m_c1]',
        '[label __b_c1_2]',
        '[jump __m_c1]',
        '[label __m_c1]',
        '[set trail = trail + "|"]',
        '[if trust >= 1 -> __b_br1_0]',
        '[set trail = trail + "E"]',
        '[jump __m_br1]',
        '[label __b_br1_0]',
        '[set trail = trail + "T"]',
        '[jump __m_br1]',
        '[label __m_br1]',
        '[set trail = trail + "."]',
        '',
        '[label __nilvn_unset__]',
        '',
      ].join('\n'),
    )
  })

  it('derives the synthetic labels from the owner id', () => {
    expect(bodyLabel('c9', 2)).toBe('__b_c9_2')
    expect(mergeLabel('c9')).toBe('__m_c9')
  })

  it('a choice whose options all jump stays as before (no merge scaffolding)', () => {
    const p = nestedProject()
    p.scenes[0]!.nodes = [{ kind: 'choice', id: 'c', options: [{ labelKey: 'o.a', target: { label: 'x' } }] }, { kind: 'label', id: 'l', name: 'x' }]
    expect(serializeProject(p)).toBe('[label s1]\n[choice 甲 -> x]\n[label x]\n\n[label __nilvn_unset__]\n')
  })

  it('anchors, labels and text keys reach nested nodes', () => {
    const p = nestedProject()
    const out = serializeChunk(p, { anchorNodeId: 'ab1' })
    expect(out.body).toContain('[label __b_c2_1]\n[label __nilvn_here__]\n[set trail = trail + "b"]')
    // Synthetic branch labels are scene-local: they never go into the labelIndex.
    expect(out.labels).toEqual(['s1'])
  })
})

describe('node guards (NodeBase.condition)', () => {
  it('skips a guarded node (and its nested bodies) when the condition fails', () => {
    const p = nestedProject()
    p.scenes[0]!.nodes = [
      { kind: 'set', id: 'g', var: 'trail', expr: '"x"', condition: 'trust >= 1' },
      { kind: 'choice', id: 'c', condition: 'trust > 9', options: [{ labelKey: 'o.a', body: [{ kind: 'set', id: 'in', var: 'trail', expr: '"y"' }] }] },
    ]
    expect(serializeProject(p)).toBe([
      '[label s1]',
      '[if !(trust >= 1) -> __s_g]', '[set trail = "x"]', '[label __s_g]',
      '[if !(trust > 9) -> __s_c]', '[choice 甲 -> __b_c_0]', '[jump __m_c]', '[label __b_c_0]', '[set trail = "y"]', '[jump __m_c]', '[label __m_c]', '[label __s_c]',
      '', '[label __nilvn_unset__]', '',
    ].join('\n'))
  })
  it('a plugin command takes the native trailing if=; a jump keeps [if]', () => {
    const p = nestedProject()
    p.scenes[0]!.nodes = [
      { kind: 'command', id: 'k', cmd: 'glitch', params: { duration: 0.4 }, condition: 'chapter >= 3' },
      { kind: 'jump', id: 'j', target: { label: 's1' }, condition: 'a' },
    ]
    expect(serializeProject(p)).toBe('[label s1]\n[glitch duration=0.4 if=chapter >= 3]\n[if a -> s1]\n\n[label __nilvn_unset__]\n')
  })
})
