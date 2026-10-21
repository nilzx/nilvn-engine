import { describe, it, expect } from 'vitest'
import { serializeChunk, serializeProject } from '../src/index'
import { makeProject } from './fixtures'

// IR → `.nvn` DSL. The full export and the chunked/preview scopes all flow through
// serializeChunk; the crossChunk flag is the batch-5 inc-6b fix (a chunked build must
// KEEP cross-scene jumps the runtime resolves via labelIndex, where a scoped preview
// redirects them to the graceful unset landing).
describe('serializeChunk', () => {
  it('resolves catalog text in the default language', () => {
    const body = serializeProject(makeProject())
    expect(body).toContain('[label s1]')
    expect(body).toContain('yuki(happy): 你好') // zh catalog, resolved literal
    expect(body).toContain('|这是一段旁白。') // narration
  })

  it('emits @key references under keepKeys (runtime-resolved text)', () => {
    const body = serializeProject(makeProject(), { keepKeys: true })
    expect(body).toContain('yuki(happy): @s1.hello')
    expect(body).not.toContain('你好')
  })

  it('emits a per-line voice tag with its start offset', () => {
    const body = serializeProject(makeProject())
    expect(body).toContain('[voice voice/hi.webm offset=0.2]')
  })

  it('[theme reset] and the 0.20 [menu] command have their positional words', () => {
    const p = makeProject()
    p.scenes[0]!.nodes.push(
      { kind: 'command', id: 'th1', cmd: 'theme', params: { 'name-bg': '#000000' } },
      { kind: 'command', id: 'th2', cmd: 'theme', params: { op: 'reset' } },
      { kind: 'command', id: 'mn1', cmd: 'menu', params: { op: 'open', page: 'settings' } },
      { kind: 'command', id: 'mn2', cmd: 'menu', params: { op: 'close' } },
    )
    const body = serializeProject(p)
    expect(body).toContain('[theme name-bg=#000000]')
    expect(body).toContain('[theme reset]')
    expect(body).toContain('[menu open settings]')
    expect(body).toContain('[menu close]')
  })

  it('reports the labels it defines (scene ids)', () => {
    const { labels } = serializeChunk(makeProject())
    expect(labels).toEqual(['s1', 's2'])
  })

  it('collects scene-scoped asset refs (command param + voice)', () => {
    const { assetRefs } = serializeChunk(makeProject())
    expect(new Set(assetRefs)).toEqual(new Set(['voice/hi.webm', 'bg/room.png']))
  })

  it('a scoped PREVIEW redirects an out-of-scope jump to the unset landing', () => {
    // Scope to s1 only, no crossChunk: the choice → s2 can't play, so it degrades.
    const { body } = serializeChunk(makeProject(), { scenes: ['s1'] })
    expect(body).toContain('-> __nilvn_unset__')
    expect(body).not.toContain('-> s2')
  })

  it('a CHUNKED scope keeps the cross-scene jump (runtime resolves via labelIndex)', () => {
    const { body } = serializeChunk(makeProject(), { scenes: ['s1'], crossChunk: true })
    expect(body).toContain('-> s2')
    // The dangling option (empty target) still degrades to unset in both modes.
    expect(body).toContain('-> __nilvn_unset__')
  })

  it('a truly-dangling target degrades to unset even under crossChunk', () => {
    const { body } = serializeChunk(makeProject(), { scenes: ['s1', 's2'], crossChunk: true })
    // The empty-target choice option has no scene/label anywhere → unset.
    expect(body).toContain('-> __nilvn_unset__')
  })
})
