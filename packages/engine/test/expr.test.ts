import { describe, it, expect } from 'vitest'
import { evalExpr, truthy } from '../src/expr'

// The sandboxed expression evaluator behind [set] and [if]/choice conditions. Not
// eval()-based, so precedence, coercion and the variable lookup are all hand-rolled
// and worth pinning.
describe('evalExpr', () => {
  it('does arithmetic with correct precedence', () => {
    expect(evalExpr('2 + 3 * 4', {})).toBe(14)
    expect(evalExpr('(2 + 3) * 4', {})).toBe(20)
    expect(evalExpr('7 % 3', {})).toBe(1)
    expect(evalExpr('-5 + 2', {})).toBe(-3)
  })

  it('reads variables, defaulting an undefined one to 0', () => {
    expect(evalExpr('hp', { hp: 42 })).toBe(42)
    expect(evalExpr('hp + 1', {})).toBe(1) // undefined → 0
  })

  it('recognizes the true/false keywords', () => {
    expect(evalExpr('true', {})).toBe(true)
    expect(evalExpr('false', {})).toBe(false)
  })

  it('evaluates comparisons', () => {
    expect(evalExpr('hp > 10', { hp: 20 })).toBe(true)
    expect(evalExpr('hp <= 10', { hp: 20 })).toBe(false)
    expect(evalExpr('a == b', { a: 1, b: 1 })).toBe(true)
    expect(evalExpr('a != b', { a: 1, b: 2 })).toBe(true)
  })

  it('short-circuits logical operators to a boolean', () => {
    expect(evalExpr('1 && 0', {})).toBe(false)
    expect(evalExpr('0 || 5', {})).toBe(true) // truthy-coerced, not 5
    expect(evalExpr('!0', {})).toBe(true)
    expect(evalExpr('!1', {})).toBe(false)
  })

  it('concatenates when either side of + is a string', () => {
    expect(evalExpr('"a" + "b"', {})).toBe('ab')
    expect(evalExpr("'x' + 1", {})).toBe('x1')
  })

  it('throws on malformed input rather than returning garbage', () => {
    expect(() => evalExpr('1 +', {})).toThrow()
    expect(() => evalExpr('1 2', {})).toThrow(/trailing/)
  })
})

describe('functions and dotted names', () => {
  it('reads dotted variable names as one identifier', () => {
    expect(evalExpr('sys.runs + 1', { 'sys.runs': 2 })).toBe(3)
    expect(evalExpr('1.5 + 1', {})).toBe(2.5) // a number's dot is still a number's
  })

  it('has() reads a list or a string, loosely', () => {
    expect(evalExpr("has(sys.endings, 'true')", { 'sys.endings': ['true', 'bad'] })).toBe(true)
    expect(evalExpr("has(sys.endings, 'x')", { 'sys.endings': ['true'] })).toBe(false)
    expect(evalExpr('has(route, "a")', { route: 'a' })).toBe(true)
    expect(evalExpr('has(nothing, "a")', {})).toBe(false)
  })

  it('min / max / floor / len', () => {
    expect(evalExpr('min(3, 1, 2)', {})).toBe(1)
    expect(evalExpr('max(hp, 10)', { hp: 42 })).toBe(42)
    expect(evalExpr('floor(7 / 2)', {})).toBe(3)
    expect(evalExpr('len(name)', { name: 'Rin' })).toBe(3)
    expect(evalExpr('len(list)', { list: [1, 2] })).toBe(2)
    expect(evalExpr('len(n)', { n: 5 })).toBe(0)
  })

  it('rand(n) / rand(a, b) / rand() stay in range', () => {
    for (let i = 0; i < 50; i++) {
      const n = evalExpr('rand(3)', {}) as number
      expect([0, 1, 2]).toContain(n)
      const r = evalExpr('rand(5, 6)', {}) as number
      expect([5, 6]).toContain(r)
      const f = evalExpr('rand()', {}) as number
      expect(f >= 0 && f < 1).toBe(true)
    }
  })

  it('nests calls and rejects anything off the whitelist', () => {
    expect(evalExpr('max(min(5, 9), floor(2.7))', {})).toBe(5)
    expect(() => evalExpr('eval("x")', {})).toThrow(/Unknown function "eval"/)
    expect(() => evalExpr('constructor(1)', {})).toThrow(/Unknown function/)
    expect(() => evalExpr('min(1,', {})).toThrow()
  })
})

describe('truthy', () => {
  it('mirrors JS boolean coercion', () => {
    expect(truthy(0)).toBe(false)
    expect(truthy('')).toBe(false)
    expect(truthy(null)).toBe(false)
    expect(truthy(1)).toBe(true)
    expect(truthy('x')).toBe(true)
  })
})
