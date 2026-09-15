import { describe, it, expect } from 'vitest'
import { compareSemVer, isValidRange, parseSemVer, satisfiesRange } from '../src/index'

// The zero-dep range subset plugin manifests use for engine / editor / dependency
// compatibility.
describe('semver subset', () => {
  it('parses full, partial and prerelease versions', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: undefined })
    expect(parseSemVer('0.15')).toMatchObject({ major: 0, minor: 15, patch: 0 })
    expect(parseSemVer('v2')).toMatchObject({ major: 2, minor: 0, patch: 0 })
    expect(parseSemVer('1.0.0-beta.1')).toMatchObject({ pre: 'beta.1' })
    expect(parseSemVer('nope')).toBeNull()
  })

  it('orders versions with prereleases below their release', () => {
    const v = (s: string) => parseSemVer(s)!
    expect(compareSemVer(v('1.0.0-beta'), v('1.0.0'))).toBeLessThan(0)
    expect(compareSemVer(v('1.10.0'), v('1.9.9'))).toBeGreaterThan(0)
    expect(compareSemVer(v('2.0.0'), v('2.0.0'))).toBe(0)
  })

  it('matches the documented forms', () => {
    expect(satisfiesRange('0.13.1', '>=0.13 <1')).toBe(true)
    expect(satisfiesRange('1.0.0', '>=0.13 <1')).toBe(false)
    expect(satisfiesRange('0.15.4', '^0.15')).toBe(true)
    expect(satisfiesRange('0.16.0', '^0.15')).toBe(false)
    expect(satisfiesRange('1.9.0', '^1.2.3')).toBe(true)
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false)
    expect(satisfiesRange('0.0.5', '^0.0.4')).toBe(false)
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false)
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false)
    expect(satisfiesRange('1.2.4', '1.2')).toBe(true) // partial = wildcard tail
    expect(satisfiesRange('1.5.0', '1')).toBe(true)
    expect(satisfiesRange('3.0.0', '^1 || ^3')).toBe(true)
    expect(satisfiesRange('2.0.0', '^1 || ^3')).toBe(false)
    expect(satisfiesRange('9.9.9', '*')).toBe(true)
    expect(satisfiesRange('9.9.9', undefined)).toBe(true)
    expect(satisfiesRange('1.0.0-rc.1', '>=1.0.0')).toBe(false) // prerelease sorts below
  })

  it('rejects malformed ranges and versions', () => {
    expect(isValidRange('>=1 <2')).toBe(true)
    expect(isValidRange('^x')).toBe(false)
    expect(isValidRange('>=1 || junk')).toBe(false)
    expect(satisfiesRange('junk', '*')).toBe(false)
    expect(satisfiesRange('1.0.0', '>>1')).toBe(false)
  })
})
