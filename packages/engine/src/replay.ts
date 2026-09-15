// ReplayRegistry — the A–B replay segment table (Project.replays), split
// out of engine.ts. Registration happens at PARSE time: the
// gallery must know every segment even though normal play may never pass the
// preamble (a load can start at any label, and the preamble only ships in the
// entry chunk). The session orchestration (playReplay / endReplay) stays on the
// engine; this owns the table, the "segment seen" unlock signal and the
// currently-replaying id.

import type { ScriptNode } from './types.js'

export interface ReplayDef {
  id: string
  /** Raw wire token — possibly a keepKeys `@key` the gallery resolves at render. */
  title: string
  label: string
}

export class ReplayRegistry {
  readonly replays: ReplayDef[] = []
  /** Segment id currently playing as an isolated replay; null in normal play. */
  segment: string | null = null
  private listeners = new Set<(segId: string) => void>()

  /** Register the `[replaydef]` declarations found in a parsed script/chunk.
   *  `enabled` = the abreplay handlers are installed: without them the unlock
   *  signal can never fire, so registering would fill the gallery with
   *  permanently-locked entries. Idempotent per id. */
  scan(nodes: ScriptNode[], enabled: boolean): void {
    if (!enabled) return
    for (const n of nodes) {
      if (n.type !== 'command' || n.name !== 'replaydef') continue
      const id = n.params.id
      const label = n.params.label
      if (!id || !label || this.replays.some((r) => r.id === id)) continue
      this.replays.push({ id, title: n.params.title ?? '', label })
    }
  }

  find(segId: string): ReplayDef | undefined {
    return this.replays.find((r) => r.id === segId)
  }

  /** Subscribe to "normal play passed a segment's end marker" — the unlock
   *  signal a persistence layer (the menu plugin) listens for. */
  onSegmentSeen(fn: (segId: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  fireSegmentSeen(segId: string): void {
    for (const fn of this.listeners) fn(segId)
  }

  destroy(): void {
    this.listeners.clear()
  }
}
