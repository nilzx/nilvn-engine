// Screenplay contract, parser half. Grammar v1 ("render-first markdown") is
// specified by the grammar table the writing tools ship; the three artifacts
// (grammar table, this parser, screenplay-format.ts) must stay in lockstep, and
// the tools' sample screenplay doubles as the round-trip test corpus.
//
// parseScreenplay is STRICT and line-based: it only recognizes the canonical
// half-width forms and never guesses. Human-written
// deviations (full-width colons, `->` arrows, legacy `{#id}` anchors) are the
// formatter's job — lenient parsing is `parseScreenplay(formatScreenplay(x))`,
// a single parser code path.
//
// The output is a flat event stream, NOT IR: mapping events onto scenes/nodes
// (actor resolution, mood→face, wiring) is a downstream editorial decision
// (editor paste-import, nilvn-director, M6 validators).

/** A `[label](target)` markdown link as used by jumps and branch options.
 *  `target` splits into `file` (cross-file: `ch02.md#open`) and/or `anchor`
 *  (in-file: `#relief`); both stay undefined when the target has neither shape. */
export interface ScreenplayLink {
  label: string
  /** `ch02.md` in `ch02.md#open`; undefined for in-file targets. */
  file?: string
  /** `open` in `ch02.md#open` or `#open`; undefined when the link has no `#` part. */
  anchor?: string
  /** The raw target text between the parentheses, verbatim. */
  raw: string
}

/** One `- **label** → [target](#id)：consequence` list item. Everything past
 *  the bold label is optional: an option with no target imports as unwired. */
export interface ScreenplayOption {
  label: string
  /** Natural-language condition from a `*(if …)*` prefix, parens content verbatim. */
  condition?: string
  target?: ScreenplayLink
  /** Prose consequence after the (full- or half-width) colon following the target. */
  consequence?: string
  line: number
}

export type ScreenplayEvent =
  /** `# Chapter 1 · Rooftop` — chapter heading (file-tree level concept downstream). */
  | { kind: 'chapter'; title: string; line: number }
  /** `` ## Scene · Classroom `dusk` `` — the trailing code span is the anchor id. */
  | { kind: 'sceneHeading'; title: string; id?: string; line: number }
  /** `name(mood): text` — half-width colon + space is the anchor; mood optional. */
  | { kind: 'say'; name: string; mood?: string; text: string; line: number }
  /** Bare prose line (the fallback for story text). Inline `**…**` / `` `…` ``
   *  markers are kept verbatim; strip with stripScreenplayMarkup at import. */
  | { kind: 'narrate'; text: string; line: number }
  /** Whole-line `*(……)*` first-person inner monologue; `*(name: ……)*` named. */
  | { kind: 'inner'; name?: string; text: string; line: number }
  /** Whole-line `**……**` action/emotion beat. */
  | { kind: 'beat'; text: string; line: number }
  /** `>` prose block that is neither a jump nor a branch prompt — a director
   *  note. Consecutive `>` lines merge (joined with newlines). */
  | { kind: 'note'; text: string; line: number }
  /** A run of option list items, with the immediately preceding `>` prose block
   *  (if any) attached as the prompt ("player chooses here" marker — its absence
   *  means the branch is state-driven). */
  | { kind: 'branch'; prompt?: string; options: ScreenplayOption[]; line: number }
  /** `> → [label](#anchor)` — unconditional jump. */
  | { kind: 'jump'; target: ScreenplayLink; line: number }
  /** Anything the grammar does not define (tables, plain list items, deep
   *  headings, fenced code…). Kept verbatim so importers can count and report. */
  | { kind: 'unknown'; raw: string; line: number }

// Speaker anchor: 1–12 chars with no whitespace/colon/paren, optional
// half-width (mood), then ": " (half-width colon + space). Kept deliberately
// permissive on the name charset — the ≤4-char heuristic belongs to the
// FORMATTER's full-width disambiguation, not to the strict form.
const SAY_RE = /^([^\s:：()（）]{1,12})(?:\(([^()]*)\))?: (.*)$/
const HEADING_SCENE_RE = /^## (.*?)(?:\s+`([^`]+)`)?\s*$/
const INNER_RE = /^\*\((.+)\)\*$/
const BEAT_RE = /^\*\*(.+)\*\*$/
const JUMP_RE = /^>\s*→\s*\[(.+?)\]\(([^)]*)\)\s*$/
const OPTION_RE = /^- (?:\*\(([^)]*)\)\*\s+)?\*\*(.+?)\*\*(?:\s*→\s*\[(.+?)\]\(([^)]*)\))?\s*(?:[：:]\s*(.*))?$/
const LINK_TARGET_RE = /^(?:([^#\s)]+\.md))?(?:#([^\s)]+))?$/
// Lines the grammar deliberately does not define: tables, non-option list
// items, thematic breaks, deep/malformed headings, raw HTML.
const UNDEFINED_LINE_RE = /^(\||[-*+] |\d+[.)] |#{3,}|#[^ ]|---\s*$|<)/

export function parseScreenplayLink(label: string, rawTarget: string): ScreenplayLink {
  const m = rawTarget.match(LINK_TARGET_RE)
  const link: ScreenplayLink = { label, raw: rawTarget }
  if (m && (m[1] || m[2])) {
    if (m[1]) link.file = m[1]
    if (m[2]) link.anchor = m[2]
  }
  return link
}

export function parseScreenplay(text: string): ScreenplayEvent[] {
  const events: ScreenplayEvent[] = []
  const lines = text.split(/\r\n?|\n/)

  // A trailing `>` prose block waiting to become either a branch prompt (if an
  // option list follows across at most blank lines) or a standalone note.
  let pendingNote: { text: string[]; line: number } | null = null
  let branch: { prompt?: string; options: ScreenplayOption[]; line: number } | null = null
  let inFence = false

  const flushNote = (): void => {
    if (!pendingNote) return
    events.push({ kind: 'note', text: pendingNote.text.join('\n'), line: pendingNote.line })
    pendingNote = null
  }
  const flushBranch = (): void => {
    if (!branch) return
    events.push({ kind: 'branch', prompt: branch.prompt, options: branch.options, line: branch.line })
    branch = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const lineNo = i + 1
    const line = raw.trimEnd()

    if (/^```/.test(line.trimStart())) {
      flushNote()
      flushBranch()
      inFence = !inFence
      events.push({ kind: 'unknown', raw, line: lineNo })
      continue
    }
    if (inFence) {
      events.push({ kind: 'unknown', raw, line: lineNo })
      continue
    }

    if (line === '') continue // blank lines keep pendingNote/branch open

    const option = line.match(OPTION_RE)
    if (option) {
      if (!branch) {
        branch = { options: [], line: pendingNote ? pendingNote.line : lineNo }
        if (pendingNote) {
          branch.prompt = pendingNote.text.join('\n')
          pendingNote = null
        }
      }
      const opt: ScreenplayOption = { label: option[2]!, line: lineNo }
      if (option[1] !== undefined) opt.condition = option[1]
      if (option[3] !== undefined) opt.target = parseScreenplayLink(option[3], option[4] ?? '')
      if (option[5]) opt.consequence = option[5]
      branch.options.push(opt)
      continue
    }
    // Any non-blank, non-option line closes an open branch.
    flushBranch()

    if (line.startsWith('>')) {
      const jump = line.match(JUMP_RE)
      if (jump) {
        flushNote()
        events.push({ kind: 'jump', target: parseScreenplayLink(jump[1]!, jump[2] ?? ''), line: lineNo })
        continue
      }
      const text = line.replace(/^>\s?/, '')
      if (pendingNote) pendingNote.text.push(text)
      else pendingNote = { text: [text], line: lineNo }
      continue
    }
    flushNote()

    if (line.startsWith('# ')) {
      events.push({ kind: 'chapter', title: line.slice(2).trim(), line: lineNo })
      continue
    }
    const scene = line.startsWith('## ') ? line.match(HEADING_SCENE_RE) : null
    if (scene) {
      const ev: ScreenplayEvent = { kind: 'sceneHeading', title: scene[1]!.trim(), line: lineNo }
      if (scene[2]) ev.id = scene[2]
      events.push(ev)
      continue
    }
    if (UNDEFINED_LINE_RE.test(line)) {
      events.push({ kind: 'unknown', raw, line: lineNo })
      continue
    }
    const inner = line.match(INNER_RE)
    if (inner) {
      const named = inner[1]!.match(/^([^\s:：()（）]{1,12}): (.*)$/)
      if (named) events.push({ kind: 'inner', name: named[1]!, text: named[2]!, line: lineNo })
      else events.push({ kind: 'inner', text: inner[1]!, line: lineNo })
      continue
    }
    const beat = line.match(BEAT_RE)
    if (beat) {
      events.push({ kind: 'beat', text: beat[1]!, line: lineNo })
      continue
    }
    const say = line.match(SAY_RE)
    if (say) {
      const ev: ScreenplayEvent = { kind: 'say', name: say[1]!, text: say[3]!, line: lineNo }
      if (say[2]) ev.mood = say[2]
      events.push(ev)
      continue
    }
    events.push({ kind: 'narrate', text: line, line: lineNo })
  }
  flushBranch()
  flushNote()
  return events
}

/** Strip the inline markers grammar v1 allows inside prose — bold emphasis and
 *  machine-word code spans — keeping the text (what an import keeps). */
export function stripScreenplayMarkup(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}
