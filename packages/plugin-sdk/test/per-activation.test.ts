// @vitest-environment jsdom
// perActivation: one state object per activation, shared by activate, commands
// and hooks, and a fresh one after the plugin is disabled and enabled again.
import { describe, it, expect } from 'vitest'
import { createEngine } from '@nilvn/engine'
import { definePlugin, perActivation } from '../src/index'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('perActivation', () => {
  it('shares one state per activation and starts over after a re-enable', async () => {
    let made = 0
    const state = perActivation(() => ({ n: ++made, hits: 0 }))
    const seen: number[] = []
    const plugin = definePlugin({
      id: 'com.example.counter',
      activate(ctx) {
        state(ctx).hits++
      },
      commands: {
        hit({ plugin: ctx }) {
          state(ctx).hits++
          seen.push(state(ctx).n * 100 + state(ctx).hits)
        },
      },
    })
    const e = createEngine({ container: document.createElement('div'), textSpeed: 0, registry: [plugin], use: ['com.example.counter'] })
    e.loadSource('[hit]\n[hit]\nline\n')
    void e.start()
    await tick()
    expect(seen).toEqual([102, 103])
    e.disablePlugin('com.example.counter')
    await e.enablePlugin('com.example.counter')
    e.loadSource('[hit]\nline\n')
    void e.start()
    await tick()
    expect(seen).toEqual([102, 103, 202])
    expect(made).toBe(2)
    e.destroy()
  })
})
