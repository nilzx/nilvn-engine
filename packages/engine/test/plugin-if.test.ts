// @vitest-environment jsdom
// The generic trailing `if=` on plugin commands and macros (plugin platform v3 §2.8b).
// The engine splits it off the tag before dispatch — a plugin never sees the
// condition as stray args / params — and a false condition skips the tag, unless
// the command's manifest declares `ifFalse: 'handle'`: then it runs with
// `ctx.cond === false` and decides what "not present" means.
import { describe, it, expect, beforeAll } from 'vitest'
import { newEngine } from './helpers'
import { splitCondition } from '../src/parser'
import type { CommandContext, EnginePlugin } from '../src/index'
import type { PluginManifest } from '@nilvn/core'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})

type Seen = Pick<CommandContext, 'args' | 'params' | 'raw' | 'cond'>

function recorder(id = 'test.rec'): { plugin: EnginePlugin; calls: Seen[] } {
  const calls: Seen[] = []
  const plugin: EnginePlugin = {
    id,
    commands: {
      mark: ({ args, params, raw, cond }) => void calls.push({ args, params, raw, cond }),
      keep: ({ args, params, raw, cond }) => void calls.push({ args, params, raw, cond }),
    },
  }
  return { plugin, calls }
}

async function run(script: string, opts: Parameters<typeof newEngine>[0]) {
  const e = newEngine({ textSpeed: 0, ...opts })
  e.loadSource(script)
  await e.start()
  return e
}

describe('splitCondition', () => {
  it('reads to the end of the tag and drops one pair of quotes', () => {
    expect(splitCondition('mark a b=1 if=day > 1')).toEqual({ head: 'mark a b=1', cond: 'day > 1' })
    expect(splitCondition('mark if="has(s, \'a b\')"')).toEqual({ head: 'mark', cond: "has(s, 'a b')" })
    expect(splitCondition('mark a')).toEqual({ head: 'mark a' })
  })

  it('does not split inside a quoted value', () => {
    expect(splitCondition('sprite s x.png onclick="set a = 1 if=b"')).toEqual({ head: 'sprite s x.png onclick="set a = 1 if=b"' })
    expect(splitCondition('sprite s x.png onclick="jump x" if=!seen')).toEqual({ head: 'sprite s x.png onclick="jump x"', cond: '!seen' })
  })
})

describe('plugin command if=', () => {
  it('runs the command without the condition in raw / args / params when it holds', async () => {
    const r = recorder()
    const e = await run('[set day = 2]\n[mark a b=1 if=day > 1]', { plugins: [r.plugin] })
    expect(r.calls).toEqual([{ args: ['a'], params: { b: '1' }, raw: 'mark a b=1', cond: true }])
    e.destroy()
  })

  it('skips the command — and its onCommand hook — when false', async () => {
    const r = recorder()
    const seen: string[] = []
    const spy: EnginePlugin = { id: 'test.spy', hooks: { onCommand: (name) => void seen.push(name) } }
    const e = await run('[set day = 0]\n[mark if=day > 1]\n[keep]', { plugins: [r.plugin, spy] })
    expect(r.calls.map((c) => c.raw)).toEqual(['keep'])
    expect(seen).not.toContain('mark')
    e.destroy()
  })

  it('hands a false condition to a command that declares ifFalse: handle', async () => {
    const r = recorder('test.handle')
    const manifest: PluginManifest = {
      id: 'test.handle',
      name: 'plugin.handle.name',
      version: '1.0.0',
      contributes: { commands: [{ name: 'mark', label: 'x', category: 'stage', params: [], ifFalse: 'handle' }] },
    }
    const e = await run('[mark a if=false]\n[keep if=false]', { registry: [r.plugin], manifests: [manifest], use: ['test.handle'] })
    // `mark` handles its false condition; `keep` (no declaration) is skipped.
    expect(r.calls).toEqual([{ args: ['a'], params: {}, raw: 'mark a', cond: false }])
    e.destroy()
  })

  it('treats a broken condition as false and reports it', async () => {
    const r = recorder()
    const e = await run('[mark if=(]', { plugins: [r.plugin] })
    expect(r.calls).toEqual([])
    expect(e.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining('[mark] if=('))
    e.destroy()
  })

  it('guards a macro tag too', async () => {
    const r = recorder()
    const e = await run('[set on = false]\n[go if=on]\n[set on = true]\n[go x=1 if=on]', { plugins: [r.plugin], macros: { go: 'mark' } })
    expect(r.calls).toEqual([{ args: [], params: { x: '1' }, raw: 'mark', cond: true }])
    e.destroy()
  })

  it("leaves a built-in command's own if= alone", async () => {
    const e = await run('[set day = 0]\n[hotspot door x=1 y=1 w=5 h=5 onclick="jump a" if=day > 1]\n[set after = 1]', {})
    expect(e.stage.snapshot().hotspots ?? []).toEqual([])
    expect(e.diagnostics).toEqual([])
    e.destroy()
  })
})
