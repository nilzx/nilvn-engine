import { describe, it, expect } from 'vitest'
import { mergeDefaults } from '../src/config'

// mergeDefaults folds per-command default params into the engine's default table,
// stringifying every value (the DSL is string-typed). applyConfig/fetchConfig touch
// `document` / `fetch` and belong to the DOM-integration tests, not here.
describe('mergeDefaults', () => {
  it('stringifies and merges source params into the target table', () => {
    const target: Record<string, Record<string, string>> = {}
    mergeDefaults(target, { bg: { fade: 300, cover: true } })
    expect(target).toEqual({ bg: { fade: '300', cover: 'true' } })
  })

  it('extends an existing command table without dropping prior keys', () => {
    const target: Record<string, Record<string, string>> = { bg: { a: '1' } }
    mergeDefaults(target, { bg: { b: 2 } })
    expect(target).toEqual({ bg: { a: '1', b: '2' } })
  })

  it('is a no-op when the source is undefined', () => {
    const target: Record<string, Record<string, string>> = { bg: { a: '1' } }
    mergeDefaults(target, undefined)
    expect(target).toEqual({ bg: { a: '1' } })
  })
})
