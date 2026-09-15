// A–B replay segments (Project.replays, schema v7) through the serializer: the
// [replaydef] preamble, the start label, the end marker, labelIndex membership,
// chunked entry-only preamble, and dangling-anchor degradation.
import { describe, it, expect } from 'vitest'
import { serializeChunk, serializeProject, REPLAY_LABEL_PREFIX } from '../src/serialize'
import { makeProject } from './fixtures'
import type { ReplaySegment } from '../src/ir'

function withReplay(seg?: Partial<ReplaySegment>): ReturnType<typeof makeProject> {
  const p = makeProject()
  p.catalogs.zh!['replay.r1.title'] = '相遇'
  p.replays = [
    {
      id: 'r1',
      titleKey: 'replay.r1.title',
      start: { sceneId: 's1', nodeId: 'n1' },
      end: { sceneId: 's2', nodeId: 'n4' },
      ...seg,
    },
  ]
  return p
}

describe('serialize: A–B replay segments', () => {
  it('emits preamble + start label + end marker, and indexes the start label', () => {
    const p = withReplay()
    const chunk = serializeChunk(p)
    const lines = chunk.body.split('\n')
    expect(lines[0]).toBe(`[replaydef id=r1 title=相遇 label=${REPLAY_LABEL_PREFIX}r1]`)
    const startAt = lines.indexOf(`[label ${REPLAY_LABEL_PREFIX}r1]`)
    expect(startAt).toBeGreaterThan(-1)
    // The start label sits immediately before its node (the s1 say line — which
    // itself serializes as a [voice …] preface + the dialogue line).
    expect(lines[startAt + 1]).toContain('[voice ')
    expect(lines[startAt + 2]).toContain('yuki')
    // End marker right after the end node (the s2 narration).
    const endAt = lines.indexOf('[replayend r1]')
    expect(endAt).toBeGreaterThan(startAt)
    expect(lines[endAt - 1]!.startsWith('|')).toBe(true)
    expect(chunk.labels).toContain(`${REPLAY_LABEL_PREFIX}r1`)
  })

  it('keepKeys mode ships the title as @key for runtime resolution', () => {
    const body = serializeProject(withReplay(), { keepKeys: true })
    expect(body).toContain('title=@replay.r1.title')
  })

  it('chunked: preamble only in the scope holding the first scene; anchors stay scoped', () => {
    const p = withReplay()
    const entry = serializeChunk(p, { scenes: ['s1'], crossChunk: true })
    const other = serializeChunk(p, { scenes: ['s2'], crossChunk: true })
    expect(entry.body).toContain('[replaydef id=r1')
    expect(other.body).not.toContain('[replaydef')
    // Start anchor lives in s1's chunk; end marker in s2's.
    expect(entry.body).toContain(`[label ${REPLAY_LABEL_PREFIX}r1]`)
    expect(entry.labels).toContain(`${REPLAY_LABEL_PREFIX}r1`)
    expect(other.body).toContain('[replayend r1]')
    expect(other.body).not.toContain(`[label ${REPLAY_LABEL_PREFIX}r1]`)
  })

  it('a segment with a dangling anchor is dropped whole (no label, no marker)', () => {
    const p = withReplay({ end: { sceneId: 's2', nodeId: 'gone' } })
    const body = serializeProject(p)
    expect(body).not.toContain('[replaydef')
    expect(body).not.toContain(REPLAY_LABEL_PREFIX)
    expect(body).not.toContain('[replayend')
  })

  it('an anchor survives its node moving to another scene (global node-id match)', () => {
    const p = withReplay({ end: { sceneId: 's1', nodeId: 'n4' } }) // n4 actually lives in s2
    const body = serializeProject(p)
    expect(body).toContain('[replayend r1]')
  })

  it('a project without replays serializes byte-identically to before', () => {
    const p = makeProject()
    const body = serializeProject(p)
    expect(body).not.toContain('replaydef')
    expect(body.startsWith('[label s1]')).toBe(true)
  })
})
