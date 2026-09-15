// Minimal SemVer range matching, zero-dep — for plugin manifests' `engine` /
// `editor` compatibility ranges and `dependencies`. Deliberately a SUBSET of node-semver:
//   `*` / '' / undefined      any version
//   `1.2.3`                   exact; a partial (`1.2`, `1`) is a wildcard tail
//   `^1.2.3` / `~1.2.3`       caret / tilde (partials allowed: `^0.15`)
//   `>=1.2 <2` `>1` `<=2.0.0` comparators, space-separated = AND
//   `a || b`                  alternatives = OR
// Prerelease tags order lexically below the bare triple (`1.0.0-beta < 1.0.0`).
// The engine mirrors this file verbatim (it holds no runtime dependency on
// core); the core↔engine contract test pins the two copies equal.

export interface SemVer {
  major: number
  minor: number
  patch: number
  pre?: string
}

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse `x.y.z[-pre]`; missing minor / patch read as 0. null when malformed. */
export function parseSemVer(v: string): SemVer | null {
  const m = VERSION_RE.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre: m[4] }
}

/** Standard ordering: numeric triple, then a prerelease sorts BELOW its release. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.pre === b.pre) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  return a.pre < b.pre ? -1 : 1
}

type Cmp = { op: '>=' | '>' | '<=' | '<' | '='; v: SemVer }

/** How many parts a partial version spelled out (`1` → 1, `1.2` → 2, `1.2.3` → 3). */
function partsOf(s: string): number {
  const bare = s.replace(/^v/, '').split('-')[0]!
  return bare.split('.').length
}

/** Expand one range token into comparators. null = malformed token. */
function tokenToComparators(tok: string): Cmp[] | null {
  if (tok === '*' || tok === 'x' || tok === 'X') return []
  const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(tok)
  if (!m) return null
  const op = m[1] ?? ''
  const raw = m[2]!
  const v = parseSemVer(raw)
  if (!v) return null
  const n = partsOf(raw)
  const nextMajor: SemVer = { major: v.major + 1, minor: 0, patch: 0 }
  const nextMinor: SemVer = { major: v.major, minor: v.minor + 1, patch: 0 }
  const nextPatch: SemVer = { major: v.major, minor: v.minor, patch: v.patch + 1 }
  switch (op) {
    case '>=':
    case '>':
    case '<=':
    case '<':
      return [{ op, v }]
    case '^':
      if (v.major > 0 || n === 1) return [{ op: '>=', v }, { op: '<', v: nextMajor }]
      if (v.minor > 0 || n === 2) return [{ op: '>=', v }, { op: '<', v: nextMinor }]
      return [{ op: '>=', v }, { op: '<', v: nextPatch }]
    case '~':
      if (n === 1) return [{ op: '>=', v }, { op: '<', v: nextMajor }]
      return [{ op: '>=', v }, { op: '<', v: nextMinor }]
    case '=':
    case '':
      if (n === 1) return [{ op: '>=', v }, { op: '<', v: nextMajor }]
      if (n === 2) return [{ op: '>=', v }, { op: '<', v: nextMinor }]
      return [{ op: '=', v }]
  }
  return null
}

function test(c: Cmp, v: SemVer): boolean {
  const d = compareSemVer(v, c.v)
  switch (c.op) {
    case '>=':
      return d >= 0
    case '>':
      return d > 0
    case '<=':
      return d <= 0
    case '<':
      return d < 0
    case '=':
      return d === 0
  }
}

/** Is `range` well-formed in this subset? (Empty / `*` count as valid.) */
export function isValidRange(range: string | undefined): boolean {
  if (range === undefined || range.trim() === '') return true
  return range.split('||').every((clause) => {
    const toks = clause.trim().split(/\s+/).filter(Boolean)
    if (!toks.length) return false
    return toks.every((t) => tokenToComparators(t) !== null)
  })
}

/** Does `version` satisfy `range`? A malformed version never does; a malformed
 *  range never matches either (callers validate ranges up front and report). */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  if (range === undefined || range.trim() === '' || range.trim() === '*') return parseSemVer(version) !== null
  const v = parseSemVer(version)
  if (!v) return false
  return range.split('||').some((clause) => {
    const toks = clause.trim().split(/\s+/).filter(Boolean)
    if (!toks.length) return false
    const cmps: Cmp[] = []
    for (const t of toks) {
      const c = tokenToComparators(t)
      if (c === null) return false
      cmps.push(...c)
    }
    return cmps.every((c) => test(c, v))
  })
}
