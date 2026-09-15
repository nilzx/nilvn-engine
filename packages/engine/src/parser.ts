import type { ChoicesNode, ScriptNode, Segment } from './types.js'

// Dialogue line: `name: text` / `name(face): text` (Chinese colon & parens OK).
// Anything that doesn't match is narration; a leading `|` forces narration.
const DIALOGUE_RE = /^([^\s:：(（[\]{}|]+?)\s*(?:[(（]([^)）]*)[)）])?\s*[:：]\s*(.*)$/

const PARAM_KEY_RE = /^[A-Za-z_][\w-]*$/

// A text field is either a literal (parsed for inline markup) or a catalog
// reference `@key`. The editor emits `@key` so the engine can re-resolve the
// text when the player switches language; anything that isn't a bare `@key`
// token stays literal, so hand-written DSL and pre-i18n exports still work.
const KEY_REF_RE = /^@([\w.-]+)$/
function textField(raw: string): { segments: Segment[]; textKey?: string } {
  const m = KEY_REF_RE.exec(raw.trim())
  if (m) return { segments: [], textKey: m[1] }
  return { segments: parseSegments(raw) }
}

/** A line the parser could not turn into a node. The line is skipped and the
 *  rest of the script parses normally (lenient by contract — the engine reports
 *  these through its diagnostics; it never refuses a script over one bad line). */
export interface ParseDiagnostic {
  line: number
  message: string
}

export interface ParsedScript {
  nodes: ScriptNode[]
  labels: Record<string, number>
  diagnostics: ParseDiagnostic[]
}

export function parseScript(source: string): ParsedScript {
  const nodes: ScriptNode[] = []
  const diagnostics: ParseDiagnostic[] = []
  const lines = source.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const ln = i + 1
    if (!line || line.startsWith(';') || line.startsWith('//')) continue

    if (line.startsWith('[') && line.endsWith(']')) {
      let node: ScriptNode
      try {
        node = parseTag(line.slice(1, -1).trim(), ln)
      } catch (err) {
        diagnostics.push({ line: ln, message: err instanceof Error ? err.message : String(err) })
        continue
      }
      const prev = nodes[nodes.length - 1]
      // Consecutive [choice ...] tags merge into a single choices node
      if (node.type === 'choices' && prev?.type === 'choices') {
        prev.items.push(...node.items)
        continue
      }
      nodes.push(node)
      continue
    }

    if (line.startsWith('|')) {
      nodes.push({ type: 'dialogue', ...textField(line.slice(1).trim()), line: ln })
      continue
    }

    const m = DIALOGUE_RE.exec(line)
    if (m) {
      nodes.push({ type: 'dialogue', speaker: m[1], face: m[2] || undefined, ...textField(m[3]!), line: ln })
    } else {
      nodes.push({ type: 'dialogue', ...textField(line), line: ln })
    }
  }

  const labels: Record<string, number> = {}
  nodes.forEach((n, idx) => {
    if (n.type === 'label') labels[n.name] = idx
  })
  return { nodes, labels, diagnostics }
}

/** Parse the inner text of one [tag] — also used by the engine to expand macros */
export function parseTag(inner: string, line: number): ScriptNode {
  const tokens = tokenize(inner)
  const name = tokens.shift() ?? ''

  if (name === 'label') {
    return { type: 'label', name: tokens[0] ?? `label@${line}`, line }
  }

  if (name === 'choice') {
    return { type: 'choices', items: [parseChoice(tokens, line)], line } satisfies ChoicesNode
  }

  const args: string[] = []
  const params: Record<string, string> = {}
  for (const t of tokens) {
    const eq = t.indexOf('=')
    if (eq > 0 && PARAM_KEY_RE.test(t.slice(0, eq))) params[t.slice(0, eq)] = t.slice(eq + 1)
    else args.push(t)
  }
  return { type: 'command', name, args, params, raw: inner, line }
}

function parseChoice(tokens: string[], line: number) {
  const arrow = tokens.indexOf('->')
  if (arrow === -1 || arrow === tokens.length - 1) {
    // The line number rides on the diagnostic (parseScript) or the node (macros).
    void line
    throw new Error('choice syntax is [choice text -> label]')
  }
  const rawText = tokens.slice(0, arrow).join(' ')
  const keyM = KEY_REF_RE.exec(rawText.trim())
  const text = keyM ? '' : rawText
  const textKey = keyM ? keyM[1] : undefined
  const target = tokens[arrow + 1]!
  let cond: string | undefined
  for (const t of tokens.slice(arrow + 2)) {
    if (t.startsWith('if=')) cond = t.slice(3)
  }
  return { text, textKey, target, cond }
}

/** Split a tag's inner text into tokens, honoring "quoted values" */
function tokenize(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

// Inline markup inside dialogue text: {effect:text} {w:sec} {br}. A backslash
// escapes the next character, so a literal brace is written `\{` / `\}` (and a
// literal backslash as `\\`). This lets authors type `{` in dialogue without it
// being swallowed as markup — the editor escapes on write, we unescape here.
export function parseSegments(text: string): Segment[] {
  const segs: Segment[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) segs.push({ kind: 'text', text: buf })
    buf = ''
  }
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < n) {
      buf += text[i + 1]
      i += 2
      continue
    }
    if (ch === '{') {
      const tagM = /^\{(\w+)/.exec(text.slice(i))
      if (tagM) {
        const tag = tagM[1]!
        let j = i + tagM[0].length
        let val: string | undefined
        if (text[j] === ':') {
          j++
          let v = ''
          while (j < n && text[j] !== '}') {
            if (text[j] === '\\' && j + 1 < n) {
              v += text[j + 1]
              j += 2
              continue
            }
            v += text[j]
            j++
          }
          val = v
        }
        if (text[j] === '}') {
          flush()
          if (tag === 'w') segs.push({ kind: 'pause', sec: parseFloat(val ?? '') || 0.5 })
          else if (tag === 'br') segs.push({ kind: 'br' })
          else segs.push({ kind: 'text', text: val ?? '', effect: tag })
          i = j + 1
          continue
        }
      }
    }
    buf += ch
    i++
  }
  flush()
  return segs
}
