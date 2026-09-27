// A local Chrome (or Chromium / Edge) driven over the DevTools protocol — no
// browser download, no dependency: `nilvn playtest` spawns the browser the
// machine already has with a throwaway profile and talks to one page through
// the protocol's WebSocket (Node 22+ has `WebSocket` built in).

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Where Chrome-family browsers live, most likely first. `NILVN_CHROME` wins. */
export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = []
  if (env.NILVN_CHROME) out.push(env.NILVN_CHROME)
  if (env.CHROME_PATH) out.push(env.CHROME_PATH)
  if (platform === 'darwin') {
    for (const app of ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Microsoft Edge', 'Brave Browser'])
      out.push(`/Applications/${app}.app/Contents/MacOS/${app}`)
  } else if (platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[]) {
      out.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
  } else {
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean))
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) out.push(join(dir, name))
  }
  return out
}

/** The first browser on this machine, or undefined. */
export function findChrome(explicit?: string): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined
  return chromeCandidates().find((p) => existsSync(p))
}

type Listener = (params: Record<string, unknown>) => void

/** One page's DevTools session. */
export class CdpPage {
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private listeners = new Map<string, Set<Listener>>()

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      } else if (msg.method) for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params ?? {})
    })
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }))
  }

  on(method: string, fn: Listener): () => void {
    const set = this.listeners.get(method) ?? new Set()
    set.add(fn)
    this.listeners.set(method, set)
    return () => set.delete(fn)
  }

  /** Evaluate an expression in the page (awaiting a promise) and return its JSON value. */
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluation failed')
    return r.result.value as T
  }

  close(): void {
    this.ws.close()
  }
}

export interface Browser {
  page: CdpPage
  close(): void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Start the browser with a fresh profile and attach to its page. */
export async function launchChrome(executable: string, opts: { headful?: boolean; width?: number; height?: number } = {}): Promise<Browser> {
  if (typeof WebSocket === 'undefined') throw new Error('nilvn playtest needs Node 22 or later (a built-in WebSocket)')
  const profile = mkdtempSync(join(tmpdir(), 'nilvn-playtest-'))
  const args = [
    ...(opts.headful ? [] : ['--headless=new']),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width ?? 1280},${opts.height ?? 800}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ]
  const child: ChildProcess = spawn(executable, args, { stdio: 'ignore' })
  const cleanup = (): void => {
    child.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      /* the browser may still hold a file for a moment */
    }
  }
  try {
    // The browser writes the port it picked into the profile.
    let port = 0
    for (let i = 0; i < 100 && !port; i++) {
      const file = join(profile, 'DevToolsActivePort')
      if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
      else await sleep(100)
    }
    if (!port) throw new Error(`the browser did not start (${executable})`)
    let target: { webSocketDebuggerUrl?: string; type?: string } | undefined
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { webSocketDebuggerUrl?: string; type?: string }[]
        target = list.find((t) => t.type === 'page')
      } catch {
        /* not listening yet */
      }
      if (!target) await sleep(100)
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('the browser opened no page')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('could not attach to the page')), { once: true })
    })
    const page = new CdpPage(ws)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    return {
      page,
      close: () => {
        page.close()
        cleanup()
      },
    }
  } catch (err) {
    cleanup()
    throw err
  }
}
