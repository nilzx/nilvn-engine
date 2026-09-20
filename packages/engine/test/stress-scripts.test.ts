// @vitest-environment jsdom
// Large-content stress at the unit level: a 300-file work (100 chained
// episodes of three files each, an [include]d library per episode) loads,
// indexes every label, jumps far, saves and restores, and evicts under a
// residency ceiling. Timings are logged, not asserted (machines differ).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createEngine, MemorySaveStore, type Engine } from '../src/index'

beforeAll(() => {
  ;(Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
    finished: Promise.resolve(),
    finish() {},
  })
})
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
const text = (e: Engine): string => e.stage.textEl.textContent ?? ''
/** The engine's private residency / manifest, as the chunk tests read them. */
const view = (e: Engine): { residency: { residentChunks: Set<string> }; manifest: { labelIndex: Record<string, string> } } => e as unknown as { residency: { residentChunks: Set<string> }; manifest: { labelIndex: Record<string, string> } }

const N = 100
const tag = (i: number): string => `e${String(i).padStart(3, '0')}`
function work(): Record<string, string> {
  const files: Record<string, string> = {}
  for (let i = 1; i <= N; i++) {
    const t = tag(i)
    const next = i < N ? `[jump ${tag(i + 1)}-intro]` : '[end]'
    files[`http://g.test/scripts/${t}/${t}-intro.nvn`] = `[set ep = ${i}]\n[label office_${t}]\nnarr: Office ${i}.\n[call sub_${t}]\n[jump club_${t}]\n[include lib/shared.nvn]\n`
    files[`http://g.test/scripts/${t}/lib/shared.nvn`] = `[label sub_${t}]\n[set calls = calls + 1]\n[return]\n`
    files[`http://g.test/scripts/${t}/${t}-club.nvn`] = `[label club_${t}]\nnarr: Club ${i}.\n[jump dock_${t}]\n`
    files[`http://g.test/scripts/${t}/${t}-finale.nvn`] = `[label dock_${t}]\nnarr: Dock ${i}.\n${next}\n`
  }
  return files
}
const scripts = (): string[] => Array.from({ length: N }, (_, k) => tag(k + 1)).flatMap((t) => [`scripts/${t}/${t}-intro.nvn`, `scripts/${t}/${t}-club.nvn`, `scripts/${t}/${t}-finale.nvn`])

function engineWith(opts: Record<string, unknown> = {}, store = new MemorySaveStore()): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: store, saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}

describe('a 300-file work', () => {
  it('loads and indexes every label, plays across episodes, jumps far, saves and restores', async () => {
    const files = work()
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const body = files[String(input)]
      return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 })
    })
    const store = new MemorySaveStore()
    const e = engineWith({}, store)
    const t0 = performance.now()
    await e.loadScripts(scripts())
    const loadMs = performance.now() - t0
    expect(e.diagnostics).toEqual([])
    expect(Object.keys(view(e).manifest.labelIndex).length).toBe(N * 4 + N * 3) // labels + one chunk id per file
    void e.start()
    await until(() => text(e) === 'Office 1.')
    e.stage.root.click()
    await until(() => text(e) === 'Club 1.')
    expect(e.vars.calls).toBe(1) // the [include]d sub-routine ran and returned
    e.stage.root.click()
    await until(() => text(e) === 'Dock 1.')
    e.stage.root.click()
    await until(() => text(e) === 'Office 2.')
    const t1 = performance.now()
    await e.runInline('[jump e087-intro]')
    await until(() => text(e) === 'Office 87.')
    const jumpMs = performance.now() - t1
    expect(e.vars.ep).toBe(87)
    await e.saveSlot(1)
    e.destroy()

    const e2 = engineWith({}, store)
    await e2.loadScripts(scripts())
    const t2 = performance.now()
    await e2.loadSlot(1)
    await until(() => text(e2) === 'Office 87.')
    const restoreMs = performance.now() - t2
    expect(e2.vars.ep).toBe(87)
    expect([...view(e2).residency.residentChunks]).toContain('e087-intro')
    e2.stage.root.click()
    await until(() => text(e2) === 'Club 87.')
    console.info(`stress: load ${loadMs.toFixed(0)} ms, far jump ${jumpMs.toFixed(0)} ms, restore ${restoreMs.toFixed(0)} ms`)
    e2.destroy()
    vi.unstubAllGlobals()
  })

  it('keeps the resident set under maxResidentChunks and reloads an evicted episode on a jump back', async () => {
    const files = work()
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const body = files[String(input)]
      return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 })
    })
    const e = engineWith({ maxResidentChunks: 6 })
    await e.loadScripts(scripts())
    void e.start()
    await until(() => text(e) === 'Office 1.')
    for (let i = 1; i <= 8; i++) {
      for (const stop of ['Club', 'Dock', 'Office']) {
        e.stage.root.click()
        const want = stop === 'Office' ? `Office ${i + 1}.` : `${stop} ${i}.`
        await until(() => text(e) === want)
      }
    }
    expect(e.vars.ep).toBe(9)
    expect(view(e).residency.residentChunks.size).toBeLessThanOrEqual(6)
    expect(view(e).residency.residentChunks.has('e001-intro')).toBe(false)
    await e.runInline('[jump e002-intro]')
    await until(() => text(e) === 'Office 2.')
    expect(e.vars.ep).toBe(2)
    expect(e.diagnostics).toEqual([])
    e.destroy()
    vi.unstubAllGlobals()
  })
})
