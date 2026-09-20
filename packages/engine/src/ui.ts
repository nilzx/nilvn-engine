// Declarative UI (batch I inc 5): panels a work declares in its config file —
// `[ui.<id>]` — drawn by the engine from a handful of data-bound widgets, no
// code. Two shapes (a HUD pinned to an anchor, a window in the middle), five
// widgets (text / bar / image / list / button), bindings to script variables
// (`var`, `{$var}` in text, `if` conditions) and events that are script commands
// (`onclick`). The plugin `contributes.hud` seam stays the coded alternative.
import type { Engine } from './engine.js'
import { evalExpr, truthy } from './expr.js'
import { displayValue } from './text.js'
import type { UiPanelConfig, UiWidget } from './types.js'

interface Panel {
  cfg: UiPanelConfig
  el: HTMLElement
  body: HTMLElement
  title?: HTMLElement
}

const ANCHORS = new Set(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'])

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  return e
}

export class UiPanels {
  private panels = new Map<string, Panel>()
  /** `[ui show|hide]` decisions on top of each panel's `show` policy. */
  private overrides = new Map<string, boolean>()

  constructor(private readonly engine: Engine) {}

  /** (Re)build every panel from the config table. */
  define(table: Record<string, UiPanelConfig>): void {
    this.clear()
    for (const [id, cfg] of Object.entries(table)) {
      const kind = cfg.kind === 'window' ? 'window' : 'hud'
      const anchor = cfg.anchor && ANCHORS.has(cfg.anchor) ? cfg.anchor : kind === 'window' ? 'center' : 'top-left'
      if (cfg.anchor && !ANCHORS.has(cfg.anchor)) this.engine.report({ phase: 'load', message: `[ui.${id}] unknown anchor "${cfg.anchor}" — using ${anchor}` }, true)
      if (cfg.show && !['playing', 'always', 'manual'].includes(cfg.show)) this.engine.report({ phase: 'load', message: `[ui.${id}] unknown show "${cfg.show}" — using playing` }, true)
      const wrap = this.engine.stage.chrome.overlay(`nilvn-ui nilvn-ui--${kind} nilvn-ui--${anchor}`)
      wrap.dataset.id = id
      wrap.addEventListener('click', (ev) => ev.stopPropagation()) // never click-to-advance through a panel
      if (cfg.width !== undefined) wrap.style.width = String(cfg.width)
      if (cfg.height !== undefined) wrap.style.height = String(cfg.height)
      const panel: Panel = { cfg, el: wrap, body: el('div', 'nilvn-ui__body') }
      if (kind === 'window' && cfg.title !== undefined) {
        panel.title = el('div', 'nilvn-ui__title')
        wrap.append(panel.title)
      }
      wrap.append(panel.body)
      this.panels.set(id, panel)
    }
    this.refresh()
  }

  has(id: string): boolean {
    return this.panels.has(id)
  }

  ids(): string[] {
    return [...this.panels.keys()]
  }

  /** A panel's display name for a menu / title entry: its title, else its id. */
  label(id: string): string {
    const p = this.panels.get(id)
    return (p && this.engine.chromeString(p.cfg.title, true)) || id
  }

  show(id: string): void {
    this.setOverride(id, true)
  }
  hide(id: string): void {
    this.setOverride(id, false)
  }
  toggle(id: string): void {
    this.setOverride(id, !this.isShown(id))
  }
  private setOverride(id: string, on: boolean): void {
    if (!this.panels.has(id)) {
      this.engine.report({ phase: 'exec', message: `[ui] unknown panel "${id}" — declare it as [ui.${id}] in the config` }, true)
      return
    }
    this.overrides.set(id, on)
    this.refresh()
  }

  isShown(id: string): boolean {
    const p = this.panels.get(id)
    return !!p && p.el.style.display !== 'none'
  }

  /** What a save carries: the explicit show / hide decisions (absent when none). */
  state(): Record<string, boolean> | undefined {
    return this.overrides.size ? Object.fromEntries(this.overrides) : undefined
  }
  restore(state: Record<string, boolean> | undefined): void {
    this.overrides.clear()
    for (const [id, on] of Object.entries(state ?? {})) if (this.panels.has(id) && typeof on === 'boolean') this.overrides.set(id, on)
    this.refresh()
  }
  /** A fresh session (start / restart / title) forgets the decisions. */
  reset(): void {
    this.overrides.clear()
    this.refresh()
  }

  /** Re-evaluate visibility and every binding (a variable, the language or the
   *  session changed). Cheap enough to run on every `[set]`. */
  refresh(): void {
    const e = this.engine
    const playing = e.session === 'playing'
    const scope = e.scope()
    for (const [id, p] of this.panels) {
      const policy = p.cfg.show ?? 'playing'
      const over = this.overrides.get(id)
      let visible: boolean
      if (policy === 'always') visible = over ?? true
      else if (policy === 'manual') visible = over === true
      else visible = playing && (over ?? true)
      p.el.style.display = visible ? '' : 'none'
      if (!visible) continue
      if (p.title) p.title.textContent = e.chromeString(p.cfg.title, true) ?? ''
      this.render(p, scope)
    }
  }

  private render(p: Panel, scope: Record<string, unknown>): void {
    const e = this.engine
    p.body.replaceChildren()
    for (const w of p.cfg.widgets ?? []) {
      if (!w || typeof w !== 'object') continue
      if (w.if && !this.cond(w.if, scope)) continue
      switch (w.type) {
        case 'text': {
          const t = el('div', 'nilvn-ui__text')
          const text = e.chromeString(w.text, true)
          t.textContent = text !== undefined ? text : w.var ? displayValue(e.getVar(w.var)) : ''
          p.body.append(t)
          break
        }
        case 'bar': {
          const box = el('div', 'nilvn-ui__bar')
          if (w.label !== undefined) {
            const l = el('div', 'nilvn-ui__bar-label')
            l.textContent = e.chromeString(w.label, true) ?? ''
            box.append(l)
          }
          const track = el('div', 'nilvn-ui__bar-track')
          const fill = el('div', 'nilvn-ui__bar-fill')
          const min = this.num(w.min, scope, 0)
          const max = this.num(w.max, scope, 100)
          const v = this.num(w.var !== undefined ? e.getVar(w.var) : 0, scope, 0)
          const ratio = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0
          fill.style.width = `${ratio * 100}%`
          track.append(fill)
          box.append(track)
          p.body.append(box)
          break
        }
        case 'image': {
          if (!w.src) break
          const img = el('img', 'nilvn-ui__image')
          img.src = e.resolve(e.fill(w.src, true))
          img.alt = ''
          img.draggable = false
          if (w.width !== undefined) img.style.width = String(w.width)
          p.body.append(img)
          break
        }
        case 'list': {
          const v = w.var !== undefined ? e.getVar(w.var) : undefined
          const items = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : []
          if (!items.length) {
            const t = el('div', 'nilvn-ui__text nilvn-ui__empty')
            t.textContent = e.chromeString(w.empty, true) ?? ''
            p.body.append(t)
            break
          }
          const ul = el('ul', 'nilvn-ui__list')
          for (const it of items) {
            const li = document.createElement('li')
            // a string item is a config string: `@key` / `{$var}` resolve
            li.textContent = typeof it === 'string' ? (e.chromeString(it, true) ?? '') : displayValue(it)
            ul.append(li)
          }
          p.body.append(ul)
          break
        }
        case 'button': {
          const b = el('button', 'nilvn-screen__button nilvn-ui__button')
          b.type = 'button'
          b.textContent = e.chromeString(w.label, true) ?? ''
          const cmd = w.onclick
          b.addEventListener('click', () => {
            if (cmd) void e.runInline(cmd)
          })
          p.body.append(b)
          break
        }
        default:
          e.report({ phase: 'load', message: `[ui] unknown widget type "${String((w as { type?: unknown }).type)}" — ignored` }, true)
      }
    }
  }

  private cond(expr: string, scope: Record<string, unknown>): boolean {
    try {
      return truthy(evalExpr(expr, scope))
    } catch (err) {
      this.engine.report({ phase: 'exec', message: `[ui] bad condition "${expr}": ${err instanceof Error ? err.message : String(err)}` }, true)
      return false
    }
  }

  /** A number from a literal, a variable's value or an expression string. */
  private num(v: unknown, scope: Record<string, unknown>, def: number): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : def
    if (typeof v === 'string') {
      try {
        const r = evalExpr(v, scope)
        const n = typeof r === 'number' ? r : parseFloat(String(r))
        return Number.isFinite(n) ? n : def
      } catch {
        return def
      }
    }
    if (typeof v === 'boolean') return v ? 1 : 0
    return def
  }

  private clear(): void {
    for (const p of this.panels.values()) p.el.remove()
    this.panels.clear()
  }

  destroy(): void {
    this.clear()
    this.overrides.clear()
  }
}

export type { UiWidget }
