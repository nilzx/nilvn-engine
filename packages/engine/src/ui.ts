// Declarative UI (batch I inc 5): panels a work declares in its config file —
// `[ui.<id>]` — drawn by the engine from a handful of data-bound widgets, no
// code. Two shapes (a HUD pinned to an anchor, a window in the middle), six
// widgets (text / bar / image / list / button / slider), bindings to script
// variables (`var`, `{$var}` in text, `if` / `disabled` conditions) and events
// that are script commands (`onclick`). The plugin `contributes.hud` seam stays
// the coded alternative.
//
// 0.20: each panel is also the screen-space stage object `ui:<id>` (recordable
// like `window:dialog`), a window may place its widgets by coordinates, carry a
// close button, a backdrop and an open / close animation, and the editor can
// preview any set of panels regardless of their show policy (`preview`).
import type { Engine } from './engine.js'
import { skinLayers } from './config.js'
import { icon, rangeShell } from './chrome-dom.js'
import { evalExpr, truthy } from './expr.js'
import { chordsOf, formatBinding, matchKey } from './keys.js'
import { displayValue } from './text.js'
import type { UiPanelConfig, UiWidget } from './types.js'

/** A slider's DOM, kept across renders so a drag is never interrupted by the
 *  redraw its own write causes. */
interface SliderEl {
  wrap: HTMLElement
  label: HTMLElement
  input: HTMLInputElement
  /** Repaints the themed track's fill from the input's value. */
  sync: () => void
}

interface Panel {
  id: string
  cfg: UiPanelConfig
  el: HTMLElement
  body: HTMLElement
  title?: HTMLElement
  close?: HTMLButtonElement
  dim?: HTMLElement
  /** Whether the panel counts as shown (it may still be fading out). */
  visible: boolean
  /** Widgets placed by `x` / `y` (a window's free layout). */
  free: boolean
  /** The `open` animation, or null. */
  fx: string | null
  closeTimer?: number
  sliders: Map<number, SliderEl>
  /** Buttons with a `key`, from the last render. */
  keys: { key: string; el: HTMLButtonElement }[]
  /** Its text reads `sys.playTime`: redrawn every second while shown. */
  ticks: boolean
}

const ANCHORS = new Set(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'])
/** The translate each anchor centres with — the pose model's base (see `attachUiPanel`). */
const ANCHOR_BASE: Record<string, string> = { top: 'translateX(-50%)', bottom: 'translateX(-50%)', left: 'translateY(-50%)', right: 'translateY(-50%)', center: 'translate(-50%,-50%)' }
const OPEN_FX = new Set(['none', 'fade', 'slide', 'pop'])
/** How long the open / close animations run (the stylesheet's `.2s`). */
const UI_FX_MS = 200

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  return e
}

/** A placement value: a number is a percent of the window body, a string a CSS length. */
const pct = (v: number | string): string => (typeof v === 'number' ? `${v}%` : v)

/** Make `body`'s children exactly `nodes`, in order, without detaching a node
 *  that is already in place — a slider being dragged keeps its pointer. */
function reconcile(body: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set<Element>(nodes)
  for (const c of [...body.children]) if (!keep.has(c)) c.remove()
  nodes.forEach((n, i) => {
    const at = body.children[i]
    if (at !== n) body.insertBefore(n, at ?? null)
  })
}

export class UiPanels {
  private panels = new Map<string, Panel>()
  /** `[ui show|hide]` decisions on top of each panel's `show` policy. */
  private overrides = new Map<string, boolean>()
  /** The editor's preview: exactly these panels are drawn, whatever their policy. */
  private previewIds: Set<string> | null = null
  private ticker: number | undefined

  constructor(private readonly engine: Engine) {}

  /** (Re)build every panel from the config table. The show / hide decisions of
   *  panels that still exist are kept, and so is each one's pose on the stage. */
  define(table: Record<string, UiPanelConfig>): void {
    const e = this.engine
    for (const id of this.panels.keys()) if (!Object.hasOwn(table, id)) e.stage.detachUiPanel(`ui:${id}`, true)
    for (const id of [...this.overrides.keys()]) if (!Object.hasOwn(table, id)) this.overrides.delete(id)
    this.clear()
    for (const [id, cfg] of Object.entries(table)) {
      if (!cfg || typeof cfg !== 'object') continue
      const kind = cfg.kind === 'window' ? 'window' : 'hud'
      const anchor = cfg.anchor && ANCHORS.has(cfg.anchor) ? cfg.anchor : kind === 'window' ? 'center' : 'top-left'
      const warn = (message: string): void => e.report({ phase: 'load', message: `[ui.${id}] ${message}` }, true)
      if (cfg.anchor && !ANCHORS.has(cfg.anchor)) warn(`unknown anchor "${cfg.anchor}" — using ${anchor}`)
      if (cfg.show && !['playing', 'always', 'manual'].includes(cfg.show)) warn(`unknown show "${cfg.show}" — using playing`)
      if (cfg.dir !== undefined && cfg.dir !== 'row' && cfg.dir !== 'column') warn(`unknown dir "${String(cfg.dir)}" — using column`)
      if (cfg.open !== undefined && !OPEN_FX.has(cfg.open)) warn(`unknown open "${String(cfg.open)}" — using none`)
      const widgets = Array.isArray(cfg.widgets) ? cfg.widgets : []
      const free = kind === 'window' && widgets.some((w) => w && typeof w === 'object' && (w.x !== undefined || w.y !== undefined))
      const fx = cfg.open && cfg.open !== 'none' && OPEN_FX.has(cfg.open) ? cfg.open : null
      let dim: HTMLElement | undefined
      if (cfg.dim && kind === 'window') {
        dim = e.stage.chrome.overlay('nilvn-ui-dim')
        dim.dataset.id = id
        dim.style.display = 'none'
        dim.addEventListener('click', (ev) => ev.stopPropagation()) // a backdrop takes the click, nothing behind it does
      }
      const cls = ['nilvn-ui', `nilvn-ui--${kind}`, `nilvn-ui--${anchor}`]
      if (free) cls.push('nilvn-ui--free')
      if (fx) cls.push(`nilvn-ui--fx-${fx}`)
      if (cfg.close && kind === 'window') cls.push('nilvn-ui--closable')
      const wrap = e.stage.chrome.overlay(cls.join(' '))
      wrap.dataset.id = id
      wrap.style.display = 'none'
      wrap.addEventListener('click', (ev) => ev.stopPropagation()) // never click-to-advance through a panel
      // A window placing its widgets by coordinates needs a box to place them in.
      const width = cfg.width ?? (free ? '40cqw' : undefined)
      const height = cfg.height ?? (free ? '36cqh' : undefined)
      if (width !== undefined) wrap.style.width = String(width)
      if (height !== undefined) wrap.style.height = String(height)
      this.panelLook(kind, wrap, cfg, warn)
      const bodyCls = ['nilvn-ui__body']
      if (cfg.dir === 'row') bodyCls.push('nilvn-ui__body--row')
      if (free) bodyCls.push('nilvn-ui__body--free')
      const panel: Panel = { id, cfg, el: wrap, body: el('div', bodyCls.join(' ')), visible: false, free, fx, dim, sliders: new Map(), keys: [], ticks: false }
      if (kind === 'window' && cfg.title !== undefined) {
        panel.title = el('div', 'nilvn-ui__title')
        wrap.append(panel.title)
      }
      if (cfg.close && kind === 'window') {
        const x = el('button', 'nilvn-ui__close')
        x.type = 'button'
        x.append(icon('close'))
        x.addEventListener('click', () => {
          if (!this.previewIds) this.hide(id)
        })
        panel.close = x
        wrap.append(x)
      }
      wrap.append(panel.body)
      if (this.previewIds) wrap.classList.add('nilvn-ui--preview')
      this.panels.set(id, panel)
      e.stage.attachUiPanel(`ui:${id}`, wrap, ANCHOR_BASE[anchor] ?? '')
      this.checkKeys(widgets, warn)
    }
    this.refresh()
  }

  /** A button `key` an engine action already holds: the action wins. */
  private checkKeys(widgets: UiWidget[], warn: (message: string) => void): void {
    widgets.forEach((w, i) => {
      if (!w || w.type !== 'button' || w.key === undefined) return
      if (typeof w.key !== 'string' || !chordsOf(w.key).length) {
        warn(`widgets[${i}]: key "${String(w.key)}" is not a key name — ignored`)
        return
      }
      const holder = this.engine.keyTable.holder(w.key)
      if (holder) warn(`widgets[${i}]: key ${formatBinding(w.key)} is already bound to "${holder}" — that binding wins (pick another key, or rebind it in [keys])`)
    })
  }

  /** A panel's own `skin` / `background` / `border` / `radius`: custom properties
   *  on the panel, so they override the `hud-*` / `window-*` tokens for it alone. */
  private panelLook(kind: 'hud' | 'window', wrap: HTMLElement, cfg: UiPanelConfig, warn: (message: string) => void): void {
    const tok = (name: string): string => `--nilvn-${kind}-${name}`
    const skinned = this.skin(wrap, '--ui-panel-skin', cfg.skin, cfg.slice, cfg.sliceWidth, warn)
    if (cfg.background !== undefined) wrap.style.setProperty(tok('bg'), String(cfg.background))
    else if (skinned) wrap.style.setProperty(tok('bg'), 'transparent')
    if (cfg.border !== undefined) wrap.style.setProperty(tok('border'), String(cfg.border))
    else if (skinned) wrap.style.setProperty(tok('border'), 'none')
    if (cfg.radius !== undefined) wrap.style.setProperty(tok('radius'), String(cfg.radius))
  }

  /** Put a skin on `target` as `<prop>` / `<prop>-slice` (see `skinLayers`);
   *  true when there is one. A slice without a skin is reported. */
  private skin(target: HTMLElement, prop: string, skin: unknown, slice: number | string | undefined, sliceWidth: string | number | undefined, warn: (message: string) => void): boolean {
    if (typeof skin !== 'string' || !skin || skin === 'none') {
      if (slice !== undefined || sliceWidth !== undefined) warn('slice / sliceWidth need a skin — ignored')
      return false
    }
    const s = skinLayers(`url("${this.engine.resolve(skin)}")`, slice, sliceWidth)
    target.style.setProperty(prop, s.skin)
    if (s.slice) target.style.setProperty(`${prop}-slice`, s.slice)
    return true
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
    return !!this.panels.get(id)?.visible
  }

  /** A `dim` window is up: it holds the story like a dialog does — its
   *  backdrop takes the clicks, and the engine's advance key waits too. */
  modalShown(): boolean {
    if (this.previewIds) return false
    for (const p of this.panels.values()) if (p.visible && p.dim) return true
    return false
  }

  /** The editor's preview. With a list, exactly those panels are drawn —
   *  whatever their `show` policy and the session — and a widget whose `if`
   *  fails is drawn with the class `is-off` instead of left out; buttons,
   *  sliders, keys and the close button do nothing. `null` brings the normal
   *  rules back. Every widget element carries `data-widget` (its index in
   *  `widgets`) either way, every panel `data-id`. */
  preview(ids: string[] | null): void {
    this.previewIds = ids ? new Set(ids) : null
    for (const p of this.panels.values()) p.el.classList.toggle('nilvn-ui--preview', !!this.previewIds)
    this.refresh()
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
    const preview = this.previewIds
    let ticking = false
    for (const [id, p] of this.panels) {
      let visible: boolean
      if (preview) visible = preview.has(id)
      else {
        const policy = p.cfg.show ?? 'playing'
        const over = this.overrides.get(id)
        if (policy === 'always') visible = over ?? true
        else if (policy === 'manual') visible = over === true
        else visible = playing && (over ?? true)
      }
      if (visible) {
        if (p.title) p.title.textContent = e.chromeString(p.cfg.title, true) ?? ''
        if (p.close) {
          p.close.title = e.t('ui.menu.close')
          p.close.setAttribute('aria-label', p.close.title)
        }
        this.render(p, scope)
        // A HUD whose widgets are all hidden by their `if` draws no empty frame.
        if (!preview && !p.title && !p.body.childElementCount) visible = false
      }
      this.display(p, visible)
      if (visible && p.ticks && !preview) ticking = true
    }
    // A panel showing the play time redraws once a second while it is up.
    if (ticking && this.ticker === undefined) this.ticker = window.setInterval(() => this.refresh(), 1000)
    else if (!ticking && this.ticker !== undefined) {
      clearInterval(this.ticker)
      this.ticker = undefined
    }
  }

  /** Show or hide a panel (and its backdrop), with its `open` animation when it
   *  changes state — none in the preview or for a player who asked for reduced motion. */
  private display(p: Panel, on: boolean): void {
    const was = p.visible
    p.visible = on
    if (p.dim) p.dim.style.display = on ? '' : 'none'
    if (p.closeTimer !== undefined) {
      clearTimeout(p.closeTimer)
      p.closeTimer = undefined
    }
    const animate = was !== on && p.fx !== null && !this.previewIds && !reducedMotion()
    if (on) {
      p.el.style.display = ''
      p.el.classList.remove('nilvn-ui--closing')
      if (animate) {
        p.el.classList.remove('nilvn-ui--opening')
        void p.el.offsetWidth // restart the animation
        p.el.classList.add('nilvn-ui--opening')
      }
    } else if (animate && p.el.style.display !== 'none') {
      p.el.classList.remove('nilvn-ui--opening')
      p.el.classList.add('nilvn-ui--closing')
      p.closeTimer = window.setTimeout(() => {
        p.closeTimer = undefined
        p.el.classList.remove('nilvn-ui--closing')
        if (!p.visible) p.el.style.display = 'none'
      }, UI_FX_MS)
    } else {
      p.el.classList.remove('nilvn-ui--opening', 'nilvn-ui--closing')
      p.el.style.display = 'none'
    }
  }

  /** A key press for a shown panel's button `key`: clicks the first enabled
   *  button it hits. The engine asks only when no menu, prompt or choice is up
   *  and no engine binding took the key. True when a button took it. */
  pressKey(ev: KeyboardEvent): boolean {
    if (this.previewIds) return false
    for (const p of this.panels.values()) {
      if (!p.visible) continue
      for (const k of p.keys) {
        if (k.el.disabled || !k.el.isConnected || !matchKey(k.key, ev)) continue
        if (!ev.repeat) k.el.click()
        return true
      }
    }
    return false
  }

  private render(p: Panel, scope: Record<string, unknown>): void {
    const preview = !!this.previewIds
    const nodes: HTMLElement[] = []
    p.keys = []
    const widgets = Array.isArray(p.cfg.widgets) ? p.cfg.widgets : []
    p.ticks = this.readsPlayTime(p.cfg.title)
    widgets.forEach((w, i) => {
      if (!w || typeof w !== 'object') return
      if (!p.ticks) p.ticks = [w.if, (w as { text?: string }).text, (w as { label?: string }).label, (w as { disabled?: string }).disabled, (w as { var?: string }).var].some((v) => this.readsPlayTime(v))
      const off = !!w.if && !this.cond(w.if, scope)
      if (off && !preview) return
      const node = this.widget(p, w, i, scope)
      if (!node) return
      node.dataset.widget = String(i)
      node.classList.toggle('is-off', off)
      this.place(p, node, w)
      nodes.push(node)
    })
    reconcile(p.body, nodes)
  }

  /** Whether a config string (an `@key` read through the catalogs) or an
   *  expression reads `sys.playTime` — its panel then redraws every second. */
  private readsPlayTime(v: unknown): boolean {
    if (typeof v !== 'string') return false
    const raw = v.startsWith('@') && v.length > 1 ? this.engine.resolveText(v.slice(1)) || v : v
    return raw.includes('sys.playTime')
  }

  /** A widget's `x` / `y` / `w` / `h`: absolute in a free-layout window's body. */
  private place(p: Panel, node: HTMLElement, w: UiWidget): void {
    const s = node.style
    if (p.free && (w.x !== undefined || w.y !== undefined)) {
      s.position = 'absolute'
      s.left = pct(w.x ?? 0)
      s.top = pct(w.y ?? 0)
    }
    if (w.w !== undefined) s.width = pct(w.w)
    if (w.h !== undefined) s.height = pct(w.h)
  }

  /** One widget's element (a new one, except a slider's, which is kept). */
  private widget(p: Panel, w: UiWidget, i: number, scope: Record<string, unknown>): HTMLElement | null {
    const e = this.engine
    switch (w.type) {
      case 'text': {
        const t = el('div', 'nilvn-ui__text')
        const text = e.chromeString(w.text, true)
        t.textContent = text !== undefined ? text : w.var ? displayValue(e.getVar(w.var)) : ''
        return t
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
        return box
      }
      case 'image': {
        if (!w.src) return null
        const img = el('img', 'nilvn-ui__image')
        img.src = e.resolve(e.fill(w.src, true))
        img.alt = ''
        img.draggable = false
        if (w.width !== undefined) img.style.width = String(w.width)
        return img
      }
      case 'list': {
        const v = w.var !== undefined ? e.getVar(w.var) : undefined
        // A comma-separated string drops its empty entries (`"key,tea,"` built by [set x = x + "tea,"]).
        const items = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : []
        if (!items.length) {
          const t = el('div', 'nilvn-ui__text nilvn-ui__empty')
          t.textContent = e.chromeString(w.empty, true) ?? ''
          return t
        }
        const ul = el('ul', 'nilvn-ui__list')
        for (const it of items) {
          const li = document.createElement('li')
          // a string item is a config string: `@key` / `{$var}` resolve
          li.textContent = typeof it === 'string' ? (e.chromeString(it, true) ?? '') : displayValue(it)
          ul.append(li)
        }
        return ul
      }
      case 'button': {
        const b = el('button', 'nilvn-screen__button nilvn-ui__button')
        b.type = 'button'
        b.textContent = e.chromeString(w.label, true) ?? ''
        const warn = (message: string): void => e.report({ phase: 'load', message: `[ui.${p.id}] widgets[${i}]: ${message}` }, true)
        const skinned = this.skin(b, '--ui-button-skin', w.skin, w.slice, w.sliceWidth, warn)
        if (w.background !== undefined) b.style.setProperty('--nilvn-button-bg', String(w.background))
        else if (skinned) {
          b.style.setProperty('--nilvn-button-bg', 'transparent')
          b.style.setProperty('--nilvn-button-hover', 'transparent')
        }
        if (skinned) b.style.setProperty('--nilvn-button-border', 'none')
        if (w.color !== undefined) b.style.setProperty('--nilvn-button-color', String(w.color))
        b.disabled = !!w.disabled && this.cond(w.disabled, scope)
        if (typeof w.key === 'string' && chordsOf(w.key).length) {
          p.keys.push({ key: w.key, el: b })
          b.setAttribute('aria-keyshortcuts', formatBinding(w.key))
        }
        const cmd = w.onclick
        b.addEventListener('click', () => {
          if (this.previewIds || b.disabled) return
          if (cmd) void e.runInline(cmd)
        })
        return b
      }
      case 'slider':
        return this.slider(p, w, i, scope)
      default:
        e.report({ phase: 'load', message: `[ui] unknown widget type "${String((w as { type?: unknown }).type)}" — ignored` }, true)
        return null
    }
  }

  /** A slider bound to a numeric variable. Its element survives redraws (only
   *  its value, range and label follow), so dragging it — which writes the
   *  variable, which redraws the panel — never loses the pointer. */
  private slider(p: Panel, w: Extract<UiWidget, { type: 'slider' }>, i: number, scope: Record<string, unknown>): HTMLElement {
    const e = this.engine
    let s = p.sliders.get(i)
    if (!s) {
      const wrap = el('div', 'nilvn-ui__slider')
      const label = el('div', 'nilvn-ui__slider-label')
      const input = el('input', 'nilvn-ui__slider-input')
      input.type = 'range'
      // Round to the step's decimals: `0.05` steps write 0.15, not 0.15000000000000002.
      const decimals = (String(w.step ?? 1).split('.')[1] ?? '').length
      input.addEventListener('input', () => {
        if (this.previewIds || input.disabled || !w.var) return
        const n = Number(input.value)
        if (Number.isFinite(n)) e.setVar(w.var, Number(n.toFixed(decimals)))
      })
      const shell = rangeShell(input)
      wrap.append(label, shell.wrap)
      s = { wrap, label, input, sync: shell.sync }
      p.sliders.set(i, s)
    }
    const min = this.num(w.min, scope, 0)
    const max = this.num(w.max, scope, 100)
    const step = typeof w.step === 'number' && w.step > 0 ? w.step : 1
    s.label.textContent = w.label !== undefined ? (e.chromeString(w.label, true) ?? '') : ''
    s.label.hidden = w.label === undefined
    s.input.min = String(min)
    s.input.max = String(max)
    s.input.step = String(step)
    const v = this.num(w.var !== undefined ? e.getVar(w.var) : min, scope, min)
    const value = String(Math.max(min, Math.min(max, v)))
    if (s.input.value !== value) s.input.value = value
    s.input.disabled = !!w.disabled && this.cond(w.disabled, scope)
    s.wrap.classList.toggle('is-disabled', s.input.disabled)
    s.sync()
    return s.wrap
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
    for (const p of this.panels.values()) {
      if (p.closeTimer !== undefined) clearTimeout(p.closeTimer)
      this.engine.stage.detachUiPanel(`ui:${p.id}`)
      p.el.remove()
      p.dim?.remove()
    }
    this.panels.clear()
    if (this.ticker !== undefined) {
      clearInterval(this.ticker)
      this.ticker = undefined
    }
  }

  destroy(): void {
    this.clear()
    this.overrides.clear()
  }
}

/** The player asked the system for less motion. */
function reducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export type { UiWidget }
