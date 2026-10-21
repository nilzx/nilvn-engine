import { describe, it, expect } from 'vitest'
import { allNodes, childLists, findNode, findProjectNode, structureProblems, walkNodes } from '../src/nodes'
import type { SceneNode } from '../src/ir'
import { nestedProject } from './nested-fixture'

describe('node tree walk (schema v14)', () => {
  const nodes = () => nestedProject().scenes[0]!.nodes

  it('visits every node depth-first in document order', () => {
    expect(allNodes(nodes()).map((n) => n.id)).toEqual(['init', 'c1', 'a1', 'a2', 'c2', 'aa1', 'ab1', 'a3', 'b1', 'm1', 'br1', 't1', 'e1', 'm2'])
  })

  it('reports the owner chain and the slot of each list', () => {
    const v = findNode(nodes(), 'ab1')!
    expect(v.path.map((p) => [p.owner.id, p.slot])).toEqual([['c1', { kind: 'option', index: 0 }], ['c2', { kind: 'option', index: 1 }]])
    expect(findNode(nodes(), 'e1')!.path[0]!.slot).toEqual({ kind: 'else' })
  })

  it('hands out the live list, so a splice edits the tree', () => {
    const list = nodes()
    const v = findNode(list, 'aa1')!
    v.list.splice(v.index, 1)
    expect(findNode(list, 'aa1')).toBeUndefined()
    expect(allNodes(list)).toHaveLength(13)
  })

  it('can skip a subtree', () => {
    const seen: string[] = []
    walkNodes(nodes(), ({ node }) => { seen.push(node.id); if (node.id === 'c1') return false })
    expect(seen).toEqual(['init', 'c1', 'm1', 'br1', 't1', 'e1', 'm2'])
  })

  it('lists children only for nesting kinds', () => {
    const say: SceneNode = { kind: 'say', id: 'x', actor: 'a', textKey: 'k' }
    expect(childLists(say)).toEqual([])
    const c1 = findNode(nodes(), 'c1')!.node
    expect(childLists(c1).map((c) => c.slot)).toEqual([{ kind: 'option', index: 0 }, { kind: 'option', index: 1 }, { kind: 'option', index: 2 }])
  })

  it('finds a node across scenes', () => {
    const hit = findProjectNode(nestedProject(), 't1')!
    expect(hit.scene.id).toBe('s1')
    expect(hit.node.kind).toBe('set')
  })
})

describe('structure problems', () => {
  it('a well-formed tree has none', () => {
    expect(structureProblems(nestedProject())).toEqual([])
  })

  it('catches both / neither target and body, empty branches and duplicate ids', () => {
    const p = nestedProject()
    const nodes = p.scenes[0]!.nodes
    const c1 = findNode(nodes, 'c1')!.node as Extract<SceneNode, { kind: 'choice' }>
    ;(c1.options[1] as unknown as Record<string, unknown>).target = { label: 'x' }
    delete (c1.options[2] as unknown as Record<string, unknown>).body
    ;(findNode(nodes, 'br1')!.node as Extract<SceneNode, { kind: 'branch' }>).cases = []
    nodes.push({ kind: 'set', id: 'a1', var: 'x', expr: '1' })
    expect(structureProblems(p).map((x) => [x.nodeId, x.message])).toEqual([
      ['c1', 'option-target-and-body'],
      ['c1', 'option-no-target-or-body'],
      ['br1', 'branch-no-case'],
      ['a1', 'duplicate-id'],
    ])
  })
})
