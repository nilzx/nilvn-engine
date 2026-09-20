// Tiny expression evaluator for [set] and [if] / choice conditions.
// Supports numbers, 'strings', variables (dotted names allowed: `sys.endings`),
// ! - + * / % comparisons && || ( ), and a whitelist of functions (`EXPR_FUNCTIONS`).
// Deliberately not eval()-based so scripts stay sandboxed.

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const TOKEN_RE =
  /(\d+(?:\.\d+)?)|"([^"]*)"|'([^']*)'|([A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*(?:\.[\w$\u0080-\uffff]+)*)|(\|\||&&|==|!=|<=|>=|[-+*/%<>!(),])/y

/** The functions an expression may call — a fixed whitelist, never a lookup on
 *  the variable table or the page. `has(set, x)` reads a persistent set such as
 *  `sys.endings`; `rand(n)` is an integer in `[0, n)`, `rand(a, b)` in `[a, b]`,
 *  `rand()` a float in `[0, 1)`; `len` is a string's or a list's length. */
export const EXPR_FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  has: (set, x) => {
    if (Array.isArray(set)) return set.some((v) => v == x)
    if (typeof set === 'string') return set === String(x)
    return false
  },
  rand: (a, b) => {
    if (a === undefined) return Math.random()
    if (b === undefined) return Math.floor(Math.random() * Math.max(0, toNum(a)))
    const lo = Math.ceil(toNum(a))
    const hi = Math.floor(toNum(b))
    return lo + Math.floor(Math.random() * Math.max(0, hi - lo + 1))
  },
  min: (...xs) => Math.min(...xs.map(toNum)),
  max: (...xs) => Math.max(...xs.map(toNum)),
  floor: (x) => Math.floor(toNum(x)),
  len: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : 0),
}

const toNum = (v: unknown): number =>
  typeof v === 'number' ? v : v === true ? 1 : v == null || v === false ? 0 : parseFloat(String(v)) || 0

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    if (/\s/.test(src[i]!)) {
      i++
      continue
    }
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(src)
    if (!m) throw new Error(`Bad expression near "${src.slice(i, i + 12)}"`)
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) })
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2] })
    else if (m[3] !== undefined) out.push({ t: 'str', v: m[3] })
    else if (m[4] !== undefined) out.push({ t: 'id', v: m[4] })
    else out.push({ t: 'op', v: m[5]! })
    i = TOKEN_RE.lastIndex
  }
  return out
}

export function truthy(v: unknown): boolean {
  return !!v
}

export function evalExpr(src: string, vars: Record<string, unknown>): unknown {
  const toks = lex(src)
  let i = 0

  const isOp = (v: string) => {
    const t = toks[i]
    return t?.t === 'op' && t.v === v
  }
  const eatOp = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" in "${src}"`)
    i++
  }
  const num = toNum

  function primary(): unknown {
    const t = toks[i]
    if (!t) throw new Error(`Unexpected end of expression "${src}"`)
    if (t.t === 'num' || t.t === 'str') {
      i++
      return t.v
    }
    if (t.t === 'id') {
      i++
      if (t.v === 'true') return true
      if (t.v === 'false') return false
      if (isOp('(')) {
        const fn = Object.prototype.hasOwnProperty.call(EXPR_FUNCTIONS, t.v) ? EXPR_FUNCTIONS[t.v] : undefined
        if (!fn) throw new Error(`Unknown function "${t.v}" in "${src}"`)
        i++
        const args: unknown[] = []
        if (!isOp(')')) {
          args.push(or())
          while (isOp(',')) {
            i++
            args.push(or())
          }
        }
        eatOp(')')
        return fn(...args)
      }
      return vars[t.v] ?? 0
    }
    if (t.v === '(') {
      i++
      const v = or()
      eatOp(')')
      return v
    }
    if (t.v === '!') {
      i++
      return !truthy(primary())
    }
    if (t.v === '-') {
      i++
      return -num(primary())
    }
    throw new Error(`Unexpected "${t.v}" in "${src}"`)
  }

  function mul(): unknown {
    let l = primary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (toks[i] as { v: string }).v
      i++
      const r = primary()
      l = op === '*' ? num(l) * num(r) : op === '/' ? num(l) / num(r) : num(l) % num(r)
    }
    return l
  }

  function add(): unknown {
    let l = mul()
    while (isOp('+') || isOp('-')) {
      const op = (toks[i] as { v: string }).v
      i++
      const r = mul()
      if (op === '+') l = typeof l === 'string' || typeof r === 'string' ? String(l) + String(r) : num(l) + num(r)
      else l = num(l) - num(r)
    }
    return l
  }

  function cmp(): unknown {
    let l = add()
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=') || isOp('==') || isOp('!=')) {
      const op = (toks[i] as { v: string }).v
      i++
      const r = add()
      switch (op) {
        case '<':
          l = num(l) < num(r)
          break
        case '>':
          l = num(l) > num(r)
          break
        case '<=':
          l = num(l) <= num(r)
          break
        case '>=':
          l = num(l) >= num(r)
          break
        case '==':
          l = l == r
          break
        case '!=':
          l = l != r
          break
      }
    }
    return l
  }

  function and(): unknown {
    let l = cmp()
    while (isOp('&&')) {
      i++
      const r = cmp()
      l = truthy(l) && truthy(r)
    }
    return l
  }

  function or(): unknown {
    let l = and()
    while (isOp('||')) {
      i++
      const r = and()
      l = truthy(l) || truthy(r)
    }
    return l
  }

  const v = or()
  if (i < toks.length) throw new Error(`Unexpected trailing tokens in "${src}"`)
  return v
}
