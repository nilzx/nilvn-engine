// Batch J inc 3: the flow the editor now authors as first-class fields and
// nodes — a choice prompt's timer, a greyed-out option, `[call]` / `[return]`
// — and the built-in commands whose params need care on the wire: a list
// positional (`[preload a b]`), a condition read to the tag's end (raw, last),
// and a localizable `@key` param that resolves when keys are not kept.
import { describe, expect, it } from 'vitest'
import type { Project } from '../src/ir'
import { serializeChunk, serializeProject } from '../src/index'
import { makeProject } from './fixtures'

function withNodes(nodes: Project['scenes'][number]['nodes'], extraCatalog: Record<string, string> = {}): Project {
  const p = makeProject()
  p.scenes = [{ id: 's1', titleKey: 's1.title', nodes }]
  Object.assign(p.catalogs.zh!, extraCatalog)
  return p
}

describe('choices: timer and disabled', () => {
  it('a timer rides a [choices] line before the prompt; guards go last and unquoted', () => {
    const p = withNodes([
      { kind: 'label', id: 'l', name: 'here' },
      {
        kind: 'choice',
        id: 'c',
        timer: 8,
        timerDefault: 2,
        options: [
          { labelKey: 'o1', target: { label: 'here' }, condition: 'day > 1' },
          { labelKey: 'o2', target: { label: 'here' }, disabled: 'seen == true' },
        ],
      },
    ], { o1: 'Go', o2: 'Stay' })
    const body = serializeProject(p)
    expect(body).toContain('[choices timer=8 default=2]\n[choice Go -> here if=day > 1]\n[choice Stay -> here disabled=seen == true]')
  })

  it('no timer → no [choices] line', () => {
    const p = withNodes([{ kind: 'choice', id: 'c', options: [{ labelKey: 'o1', target: { label: '' } }] }], { o1: 'Go' })
    expect(serializeProject(p)).not.toContain('[choices')
  })
})

describe('call / return', () => {
  it('serialize like a jump and a bare tag; a call to another scene is a chunk edge', () => {
    const p = makeProject()
    p.scenes[0]!.nodes.push({ kind: 'call', id: 'k', target: { scene: 's2', label: 's2' } }, { kind: 'return', id: 'r' })
    const { body } = serializeChunk(p, { scenes: ['s1'], crossChunk: true })
    expect(body).toContain('[call s2]')
    expect(body).toContain('[return]')
  })

  it('a scoped preview redirects an out-of-scope call to the unset landing, like a jump', () => {
    const p = makeProject()
    p.scenes[0]!.nodes.push({ kind: 'call', id: 'k', target: { scene: 's2', label: 's2' } })
    const { body } = serializeChunk(p, { scenes: ['s1'] })
    expect(body).not.toContain('[call s2]')
    expect(body).toMatch(/\[call __nilvn_unset__\]/)
  })
})

describe('built-in command params on the wire', () => {
  it('[preload] emits its list positional as several tokens', () => {
    const p = withNodes([{ kind: 'command', id: 'n', cmd: 'preload', params: { assets: 'bg/a.png  audio/b.wav', wait: true } }])
    expect(serializeProject(p)).toContain('[preload bg/a.png audio/b.wav wait=true]')
  })

  it('[hotspot] writes its condition last and raw, after the quoted click script', () => {
    const p = withNodes([{ kind: 'command', id: 'n', cmd: 'hotspot', params: { id: 'shop', x: 10, y: 20, w: 25, h: 30, onclick: 'jump shop', if: 'day > 1' } }])
    expect(serializeProject(p)).toContain('[hotspot shop x=10 y=20 w=25 h=30 onclick="jump shop" if=day > 1]')
  })

  it('[ui] and [trans] use their positionals; the trans kind default drops nothing', () => {
    const p = withNodes([
      { kind: 'command', id: 'a', cmd: 'ui', params: { op: 'toggle', id: 'notes' } },
      { kind: 'command', id: 'b', cmd: 'trans', params: { kind: 'wipe', dir: 'left', duration: 1 } },
      { kind: 'command', id: 'c', cmd: 'trans', params: { kind: 'end' } },
      { kind: 'command', id: 'd', cmd: 'bg', params: { bg: 'bg/room.png', trans: 'slide', dir: 'up' } },
    ])
    const body = serializeProject(p)
    expect(body).toContain('[ui toggle notes]')
    expect(body).toContain('[trans wipe duration=1 dir=left]')
    expect(body).toContain('[trans end]')
    expect(body).toContain('[bg bg/room.png trans=slide dir=up]')
  })

  it('[input] keeps its @key prompt under keepKeys and resolves it otherwise', () => {
    const p = withNodes([{ kind: 'command', id: 'n', cmd: 'input', params: { var: 'player', prompt: '@ask.name', persist: true } }], { 'ask.name': '你叫什么？' })
    expect(serializeChunk(p, { keepKeys: true }).body).toContain('[input player prompt=@ask.name persist=true]')
    expect(serializeProject(p)).toContain('[input player prompt=你叫什么？ persist=true]')
  })
})
