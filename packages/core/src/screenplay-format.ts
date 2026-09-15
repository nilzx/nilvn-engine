// Screenplay contract, formatter half (see screenplay.ts for the contract
// overview). formatScreenplay pulls human-written deviations back to the strict
// grammar-v1 form — lenient parsing is format→parse, one parser code path.
//
// Normalization comes in two tiers:
//   1. Control characters (unconditional, STRUCTURAL positions only): speaker
//      colon `：`→`:` + mood parens `（）`→`()` (guarded by the ≤4-char
//      no-punctuation prefix heuristic so prose with a full-width colon is left
//      alone), `->`→`→` before link targets on `>`/`-` lines, and legacy
//      pandoc `{#id}` heading anchors → trailing code spans.
//   2. Body punctuation style (per-project configurable): quote pairs and
//      ellipses unified to ONE form so short-label matching, cross-paragraph
//      references and translation catalogs never break on mixed styles.
//      (Dash normalization is deliberately left out: `---` collides with
//      markdown thematic breaks / frontmatter fences.)
//
// Invariants (each is a test): idempotent; meaning-preserving (glyphs change,
// the play does not); code spans, link targets and fenced blocks are never
// touched; lines are never merged or split.

export interface ScreenplayFormatOptions {
  /** Target quote style for body text. Default `"` (owner call 2026-07-21);
   *  `“”` / `「」` cater to Simplified-Chinese / Japanese typesetting habits. */
  quoteStyle?: '"' | '“”' | '「」'
  /** Target ellipsis form for body text. Default `……` (CJK convention). */
  ellipsis?: '……' | '...'
}

// Speaker-colon disambiguation: a prefix of at most 4 letter/number characters
// (no punctuation, no spaces) followed by a colon reads as a speaker; anything
// longer or punctuated is prose. The rewrite only fires when a FULL-WIDTH
// structural char (：（）) is present — an all-half-width line is either
// already strict or intentional prose (`12:30 kickoff` must not gain a space).
const SPEAKER_RE = /^([\p{L}\p{N}]{1,4})(?:([（(])([^()（）]{0,16})([)）]))?([：:])\s?(.*)$/u
const INNER_SPEAKER_RE = /^(\*\()([\p{L}\p{N}]{1,4})：\s?(.*\)\*)$/u
const LEGACY_ANCHOR_RE = /^(#{1,6} .*?)\s*\{#([^}]+)\}\s*$/
const ARROW_BEFORE_LINK_RE = /\s*->\s*(?=\[)/g

export function formatScreenplay(text: string, opts: ScreenplayFormatOptions = {}): string {
  const quoteStyle = opts.quoteStyle ?? '"'
  const ellipsis = opts.ellipsis ?? '……'
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r\n?|\n/)
  let inFence = false

  const out = lines.map((raw) => {
    if (/^```/.test(raw.trimStart())) {
      inFence = !inFence
      return raw
    }
    if (inFence) return raw

    let line = raw.trimEnd()

    // Tier 1 — structural control characters.
    line = line.replace(LEGACY_ANCHOR_RE, (_, head: string, id: string) => `${head} \`${id}\``)
    if (line.startsWith('>') || line.startsWith('- ')) {
      line = line.replace(ARROW_BEFORE_LINK_RE, ' → ')
    }
    const speaker = line.match(SPEAKER_RE)
    if (speaker && (speaker[5] === '：' || speaker[2] === '（' || speaker[4] === '）')) {
      line = `${speaker[1]}${speaker[3] ? `(${speaker[3]})` : ''}: ${speaker[6]}`
    } else {
      const inner = line.match(INNER_SPEAKER_RE)
      if (inner) line = `${inner[1]}${inner[2]}: ${inner[3]}`
    }

    // Tier 2 — body punctuation, skipping code spans and link targets.
    return mapUnprotected(line, (seg) => {
      // ASCII `...` and doubled-up `…` runs unify; a lone `…` is a legitimate
      // short pause and stays.
      let s = ellipsis === '……' ? seg.replace(/\.{3,}/g, '……').replace(/…{2,}/g, '……') : seg.replace(/…+|\.{3,}/g, '...')
      if (quoteStyle === '"') {
        s = s.replace(/[“”「」]/g, '"')
      } else {
        s = s.replace(/「/g, quoteStyle[0]!).replace(/」/g, quoteStyle[1]!)
        s = s.replace(/“/g, quoteStyle[0]!).replace(/”/g, quoteStyle[1]!)
      }
      return s
    }, quoteStyle)
  })
  return out.join(newline)
}

// Split a line into protected (code spans, `](target)` link tails) and open
// segments, apply fn to the open ones. Straight-quote → directional conversion
// needs pairing state, carried across the open segments of one line (opening
// and closing quotes are assumed to sit in the same line — catalog values are
// single-line by construction, see catalog.ts).
function mapUnprotected(line: string, fn: (seg: string) => string, quoteStyle: string): string {
  const parts = line.split(/(`[^`]*`|\]\([^)]*\))/)
  let quoteOpen = false
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // protected: code span or link target
      let s = fn(part)
      if (quoteStyle !== '"') {
        s = s.replace(/"/g, () => {
          quoteOpen = !quoteOpen
          return quoteOpen ? quoteStyle[0]! : quoteStyle[1]!
        })
      }
      return s
    })
    .join('')
}
