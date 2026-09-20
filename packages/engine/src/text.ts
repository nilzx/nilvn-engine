// Display-time interpolation (batch I inc 1). Dialogue, choice labels, actor
// names and config strings may carry two placeholders: `{$var}` — a script or
// persistent variable — and `{@key}` — a content-catalog entry. Both are filled
// when the text is shown, never at parse time, so a language switch re-resolves
// keys and a variable shows its current value. An inline effect whose whole
// content is a bare `@key` (`{pop:@route.name}`) resolves the key too, matching
// the whole-field `@key` rule of dialogue lines and choices.
import type { Segment } from './types.js'

export interface InterpolateHost {
  /** A variable's value; `undefined` when it does not exist (shown as empty). */
  getVar(name: string): unknown
  /** A catalog key's text in the current language (empty when missing). */
  resolveKey(key: string): string
  /** Called once per missing variable name so the engine can report it. */
  missing?(name: string): void
}

const VAR_RE = /\{\$([A-Za-z_$-￿][\w$-￿]*(?:\.[\w$-￿]+)*)\}/g
const KEY_RE = /\{@([\w.-]+)\}/g
const WHOLE_KEY_RE = /^@([\w.-]+)$/

/** Render a variable for display: `null` / `undefined` are empty, lists are
 *  comma-joined, everything else is its string form. */
export function displayValue(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(displayValue).join(', ')
  return String(v)
}

/** Whether a string carries a placeholder at all (a cheap pre-check). */
export function hasPlaceholder(text: string): boolean {
  return text.includes('{$') || text.includes('{@')
}

/** Fill `{@key}` then `{$var}` in a string. Keys resolve first so a catalog
 *  entry may itself contain `{$var}` ("Hello {$player}" per language). */
export function interpolateText(text: string, host: InterpolateHost): string {
  if (!hasPlaceholder(text)) return text
  const withKeys = text.replace(KEY_RE, (_, key: string) => host.resolveKey(key))
  return withKeys.replace(VAR_RE, (_, name: string) => {
    const v = host.getVar(name)
    if (v === undefined) host.missing?.(name)
    return displayValue(v)
  })
}

/** Interpolate every text segment. Returns the same array when nothing needed
 *  filling, so callers can keep parsed segments as the identity for a line. */
export function interpolateSegments(segments: Segment[], host: InterpolateHost): Segment[] {
  let out: Segment[] | undefined
  segments.forEach((seg, i) => {
    if (seg.kind !== 'text') return
    let text = seg.text
    const whole = seg.effect ? WHOLE_KEY_RE.exec(text) : null
    if (whole) text = host.resolveKey(whole[1]!)
    text = interpolateText(text, host)
    if (text === seg.text) return
    out ??= segments.slice()
    out[i] = { ...seg, text }
  })
  return out ?? segments
}
