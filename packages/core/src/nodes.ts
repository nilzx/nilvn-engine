// Walking a scene's node tree (schema v14). Since in-scene branches nest —
// a choice option's `body`, a branch node's case bodies and `else` — no code
// should loop over `scene.nodes` by hand to find "every node": use these. This
// module is the one place that knows which node kinds own child lists; a new
// nesting kind only has to be added to `childLists`.
import type { JumpTarget, Project, Scene, SceneNode } from './ir.js'

/** Where a child list sits inside its owner: an option body, a branch case, or
 *  a branch's else. */
export type Slot = { kind: 'option'; index: number } | { kind: 'case'; index: number } | { kind: 'else' }

export interface ChildList {
  slot: Slot
  nodes: SceneNode[]
}

/** The child node lists a node owns, in play order. Empty for leaf kinds. */
export function childLists(node: SceneNode): ChildList[] {
  if (node.kind === 'choice') {
    const out: ChildList[] = []
    node.options.forEach((o, index) => { if (o.body) out.push({ slot: { kind: 'option', index }, nodes: o.body }) })
    return out
  }
  if (node.kind === 'branch') {
    const out: ChildList[] = node.cases.map((c, index) => ({ slot: { kind: 'case', index }, nodes: c.body }))
    if (node.else) out.push({ slot: { kind: 'else' }, nodes: node.else })
    return out
  }
  return []
}

/** Where a node hands control away by a real jump: a `[jump]` / `[call]`
 *  target, or each choice option that jumps (body options stay in the scene
 *  and are not jumps). Children are not included — walk for those. */
export function jumpTargetsOf(node: SceneNode): JumpTarget[] {
  if (node.kind === 'jump' || node.kind === 'call') return [node.target]
  if (node.kind === 'choice') return node.options.flatMap((o) => (o.target ? [o.target] : []))
  return []
}

/** One step down the tree: the owning node and the slot of the list entered. */
export interface PathStep {
  owner: SceneNode
  slot: Slot
}

/** A node as a walk meets it: the list it sits in (mutable — splice to edit),
 *  its index there, and the chain of owners from the scene root. */
export interface NodeVisit {
  node: SceneNode
  list: SceneNode[]
  index: number
  path: PathStep[]
}

/** Depth-first, in document order (a node, then its children). Return `false`
 *  from `visit` to skip that node's children. */
export function walkNodes(nodes: SceneNode[], visit: (v: NodeVisit) => void | false, path: PathStep[] = []): void {
  nodes.forEach((node, index) => {
    if (visit({ node, list: nodes, index, path }) === false) return
    for (const c of childLists(node)) walkNodes(c.nodes, visit, [...path, { owner: node, slot: c.slot }])
  })
}

/** Every node of a list, nested ones included, in document order. */
export function allNodes(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = []
  walkNodes(nodes, (v) => { out.push(v.node) })
  return out
}

/** Every node of every scene, nested ones included. */
export function projectNodes(project: Project): { scene: Scene; node: SceneNode }[] {
  const out: { scene: Scene; node: SceneNode }[] = []
  for (const scene of project.scenes) walkNodes(scene.nodes, (v) => { out.push({ scene, node: v.node }) })
  return out
}

/** A node by id, wherever it nests in `nodes`. */
export function findNode(nodes: SceneNode[], id: string): NodeVisit | undefined {
  let hit: NodeVisit | undefined
  walkNodes(nodes, (v) => {
    if (hit) return false
    if (v.node.id === id) { hit = v; return false }
  })
  return hit
}

/** A node by id across the project: its scene and its visit. */
export function findProjectNode(project: Project, id: string): (NodeVisit & { scene: Scene }) | undefined {
  for (const scene of project.scenes) {
    const v = findNode(scene.nodes, id)
    if (v) return { ...v, scene }
  }
  return undefined
}

/** Structural problems the type system cannot rule out: an option with both or
 *  neither of `target` / `body`, a branch with no case, a node id used twice
 *  (ids must be unique across the whole project, nesting included). */
export interface StructureProblem {
  sceneId: string
  nodeId: string
  message: 'option-target-and-body' | 'option-no-target-or-body' | 'branch-no-case' | 'duplicate-id'
}

export function structureProblems(project: Project): StructureProblem[] {
  const out: StructureProblem[] = []
  const seen = new Set<string>()
  for (const scene of project.scenes) {
    walkNodes(scene.nodes, ({ node }) => {
      if (seen.has(node.id)) out.push({ sceneId: scene.id, nodeId: node.id, message: 'duplicate-id' })
      seen.add(node.id)
      if (node.kind === 'choice') {
        for (const o of node.options) {
          const both = o.body !== undefined && o.target !== undefined, none = o.body === undefined && o.target === undefined
          if (both) out.push({ sceneId: scene.id, nodeId: node.id, message: 'option-target-and-body' })
          if (none) out.push({ sceneId: scene.id, nodeId: node.id, message: 'option-no-target-or-body' })
        }
      }
      if (node.kind === 'branch' && node.cases.length === 0) out.push({ sceneId: scene.id, nodeId: node.id, message: 'branch-no-case' })
    })
  }
  return out
}
