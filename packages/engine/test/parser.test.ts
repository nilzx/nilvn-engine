import { describe, it, expect } from 'vitest'
import { parseScript, parseTag, parseSegments } from '../src/parser'

// The `.nvn` DSL parser: lines → ScriptNodes, `[tag]` → command/label/choices,
// dialogue text → inline-markup Segments. The grammar the whole engine runs on.
describe('parseScript', () => {
  it('parses labels, dialogue and narration; indexes labels', () => {
    const { nodes, labels } = parseScript('[label start]\nyuki(happy): hello\n|a narration line')
    expect(nodes[0]).toMatchObject({ type: 'label', name: 'start' })
    expect(nodes[1]).toMatchObject({ type: 'dialogue', speaker: 'yuki', face: 'happy' })
    expect(nodes[1]).toMatchObject({ segments: [{ kind: 'text', text: 'hello' }] })
    // Narration has no speaker.
    expect(nodes[2]).toMatchObject({ type: 'dialogue', segments: [{ kind: 'text', text: 'a narration line' }] })
    expect(nodes[2]!).not.toHaveProperty('speaker')
    expect(labels).toEqual({ start: 0 })
  })

  it('skips blank and comment lines', () => {
    const { nodes } = parseScript('; a comment\n// another\n\nyuki: hi')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'dialogue', speaker: 'yuki' })
  })

  it('resolves an @key dialogue into a textKey with no segments', () => {
    const { nodes } = parseScript('yuki: @greeting')
    expect(nodes[0]).toMatchObject({ type: 'dialogue', speaker: 'yuki', textKey: 'greeting', segments: [] })
  })

  it('merges consecutive [choice] tags into one choices node', () => {
    const { nodes } = parseScript('[choice A -> s1]\n[choice B -> s2]')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.type).toBe('choices')
    expect((nodes[0] as { items: unknown[] }).items).toHaveLength(2)
  })
})

describe('parseTag', () => {
  it('reads a choice condition from the raw text, so it may hold spaces, commas and quotes', () => {
    const node = parseTag('choice Secret path -> secret if=has(sys.endings, "true") && trust >= 1', 1)
    expect(node.type === 'choices' && node.items[0]).toEqual({ text: 'Secret path', textKey: undefined, target: 'secret', cond: 'has(sys.endings, "true") && trust >= 1' })
    const bare = parseTag('choice Go -> go if=trust>=1', 1)
    expect(bare.type === 'choices' && bare.items[0]!.cond).toBe('trust>=1')
    const none = parseTag('choice Go -> go', 1)
    expect(none.type === 'choices' && none.items[0]!.cond).toBeUndefined()
  })

  it('splits a command into name / positional args / named params', () => {
    expect(parseTag('bg room fade=300', 1)).toMatchObject({
      type: 'command',
      name: 'bg',
      args: ['room'],
      params: { fade: '300' },
    })
  })

  it('honors quoted values with spaces', () => {
    const node = parseTag('say "hello world" x=1', 1) as { args: string[]; params: Record<string, string> }
    expect(node.args).toEqual(['hello world'])
    expect(node.params).toEqual({ x: '1' })
  })

  it('parses a choice tag with target and condition', () => {
    const node = parseTag('choice Go -> s2 if=flag', 1) as { items: { target: string; cond?: string; text: string }[] }
    expect(node.items[0]).toMatchObject({ text: 'Go', target: 's2', cond: 'flag' })
  })

  it('throws on a choice missing its target', () => {
    expect(() => parseTag('choice Go', 1)).toThrow(/choice syntax/)
  })
})

describe('parseSegments', () => {
  it('splits text, {br} and {w:sec} pause markers', () => {
    expect(parseSegments('a{br}b')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'br' },
      { kind: 'text', text: 'b' },
    ])
    expect(parseSegments('{w:1.5}')).toEqual([{ kind: 'pause', sec: 1.5 }])
    expect(parseSegments('{w}')).toEqual([{ kind: 'pause', sec: 0.5 }]) // default
  })

  it('captures an inline effect as an effect-tagged text segment', () => {
    expect(parseSegments('{shake:boom}')).toEqual([{ kind: 'text', text: 'boom', effect: 'shake' }])
  })

  it('leaves {$var} / {@key} placeholders as text, whole, even inside an effect', () => {
    expect(parseSegments('Hi {$player}!')).toEqual([{ kind: 'text', text: 'Hi {$player}!' }])
    expect(parseSegments('{wave:{$player}} and {pop:@k.x}')).toEqual([
      { kind: 'text', text: '{$player}', effect: 'wave' },
      { kind: 'text', text: ' and ' },
      { kind: 'text', text: '@k.x', effect: 'pop' },
    ])
    expect(parseSegments('{wave:a {@k} b}')).toEqual([{ kind: 'text', text: 'a {@k} b', effect: 'wave' }])
  })

  it('unescapes a backslashed brace to a literal', () => {
    expect(parseSegments('a\\{b')).toEqual([{ kind: 'text', text: 'a{b' }])
  })
})
