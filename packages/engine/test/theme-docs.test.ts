// The public theme-token docs (docs/api.md) stay in step with THEME_TOKENS: the
// prose table names every token, and the defaults table between the
// `theme-defaults` markers is generated from the token table itself.
// Regenerate after changing a token: NILVN_UPDATE_DOCS=1 pnpm vitest run packages/engine/test/theme-docs.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_TOKENS } from '../src/theme'

const API_MD = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'api.md')
const START = /<!-- theme-defaults:start[^>]*-->\n/
const END = '<!-- theme-defaults:end -->'

function defaultsTable(): string {
  const cell = (v: string): string => '`' + v.replace(/\|/g, '\\|') + '`'
  return ['| Token | Default |', '|---|---|', ...Object.entries(THEME_TOKENS).map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`)].join('\n') + '\n'
}

describe('theme token docs', () => {
  const md = readFileSync(API_MD, 'utf8')
  const start = START.exec(md)
  const end = md.indexOf(END)

  it('the defaults table is generated from THEME_TOKENS', () => {
    expect(start && end > start.index).toBeTruthy()
    const at = start!.index + start![0].length
    const want = md.slice(0, at) + defaultsTable() + md.slice(end)
    if (process.env.NILVN_UPDATE_DOCS === '1') writeFileSync(API_MD, want)
    else expect(md.slice(at, end), 'packages/engine/docs/api.md theme defaults are stale — run NILVN_UPDATE_DOCS=1 pnpm vitest run packages/engine/test/theme-docs.test.ts').toBe(defaultsTable())
  })

  it('the prose table names every token', () => {
    const prose = md.slice(md.indexOf('| Token | Draws |'), start!.index)
    const named = new Set([...prose.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]))
    expect(Object.keys(THEME_TOKENS).filter((k) => !named.has(k))).toEqual([])
  })
})
