// The in-game system menu (batch G inc 4): the ☰ entry, its panel, and the
// full-stage panels behind it — save / load slots, the backlog, the replay
// gallery, the settings. Engine-owned DOM in the renderer's chrome overlay
// (`Renderer.chrome.overlay`), drawn with the theme tokens, localized through
// `engine.t()` and re-localized on a language switch. Everything it does goes
// through public engine API (slots, auto / skip, settings, replays), so a host
// that draws its own menu (`[menu] enabled = false`) has the same reach.
import type { Engine, SaveState } from './engine.js'
import { AUTOSAVE_KEY, QUICKSAVE_KEY, type SlotPayload } from './save-store.js'
import type { VolumeChannel } from './types.js'

const SPEEDS: { id: string; cps: number }[] = [
  { id: 'ui.settings.speed.slow', cps: 20 },
  { id: 'ui.settings.speed.normal', cps: 40 },
  { id: 'ui.settings.speed.fast', cps: 80 },
]
const CHANNELS: { id: string; key: VolumeChannel }[] = [
  { id: 'ui.settings.vol.music', key: 'bgm' },
  { id: 'ui.settings.vol.ambience', key: 'ambience' },
  { id: 'ui.settings.vol.sfx', key: 'se' },
  { id: 'ui.settings.vol.voice', key: 'voice' },
]
/** Every menu item, in default order. */
export const MENU_ITEMS_DEFAULT: readonly string[] = ['save', 'load', 'quicksave', 'quickload', 'backlog', 'auto', 'skip', 'settings', 'replays', 'title', 'restart']
/** Every settings row, in default order. */
export const SETTINGS_ROWS_DEFAULT: readonly string[] = ['textSpeed', 'autoDelay', 'skipMode', 'volumes', 'language', 'fullscreen', 'dialogOpacity', 'uiScale']

type PanelId = 'saves' | 'backlog' | 'replays' | 'settings'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

export class SystemMenu {
  private wrap!: HTMLElement
  private btn!: HTMLButtonElement
  private panel!: HTMLElement
  private tip!: HTMLElement
  private items = new Map<string, HTMLButtonElement>()
  private verEl: HTMLElement | null = null
  private panels = new Map<PanelId, { wrap: HTMLElement; title: HTMLElement; close: HTMLButtonElement; body: HTMLElement }>()
  private savesMode: 'save' | 'load' = 'save'
  private savesPage = 0
  private replayStash: SaveState | null = null
  private tipTimer: number | undefined
  private offs: (() => void)[] = []
  private settingsBody: { sync: () => void; relabel: () => void } | null = null
  private extras = new Map<string, { btn: HTMLButtonElement; label: () => string; when: 'playing' | 'always' }>()

  constructor(private readonly engine: Engine) {}

  // ---- lifecycle ----

  mount(): void {
    const e = this.engine
    const chrome = e.stage.chrome
    const pos = e.menuConfig.entry ?? 'top-right'
    this.wrap = chrome.overlay(`nilvn-menu nilvn-menu--${pos}`)
    this.wrap.addEventListener('click', (ev) => ev.stopPropagation())
    this.btn = button('nilvn-menu__btn', '☰', () => this.toggle())
    this.panel = el('div', 'nilvn-menu__panel')
    this.tip = el('div', 'nilvn-menu__tip')
    for (const id of e.menuConfig.items ?? MENU_ITEMS_DEFAULT) {
      const b = this.makeItem(id)
      if (b) {
        this.items.set(id, b)
        this.panel.append(b)
      } else e.report({ phase: 'load', message: `[menu] unknown item "${id}" — ignored` }, true)
    }
    if (this.items.has('replays')) {
      const exit = button('nilvn-menu__item nilvn-menu__item--exit', '', () => {
        this.close()
        this.exitReplay()
      })
      this.items.set('replayExit', exit)
      this.panel.append(exit)
    }
    this.panel.append(this.tip)
    if (e.buildInfo) {
      this.verEl = el('div', 'nilvn-menu__ver')
      this.panel.append(this.verEl)
    }
    this.wrap.append(this.btn, this.panel)
    for (const id of ['saves', 'backlog', 'replays', 'settings'] as PanelId[]) this.makePanel(id)

    if (e.menuConfig.wheelBacklog !== false) {
      const onWheel = (ev: WheelEvent): void => {
        if (e.session !== 'playing' || this.panelOpen('backlog')) return
        if (ev.deltaY < 0) {
          ev.preventDefault()
          this.openPanel('backlog')
        }
      }
      e.stage.root.addEventListener('wheel', onWheel, { passive: false })
      this.offs.push(() => e.stage.root.removeEventListener('wheel', onWheel))
    }
    this.offs.push(e.onLanguageChange(() => this.applyLang()))
    this.offs.push(e.onSessionChange((s) => this.onSession(s)))
    this.offs.push(e.onThemeChange(() => this.settingsBody?.sync()))
    this.applyLang()
    this.onSession(e.session)
  }

  destroy(): void {
    for (const off of this.offs) off()
    this.offs = []
    if (this.tipTimer !== undefined) clearTimeout(this.tipTimer)
    this.wrap?.remove()
    for (const p of this.panels.values()) p.wrap.remove()
  }

  /** The panel or the menu is up (keys should not advance the story). */
  isOpen(): boolean {
    return this.wrap.classList.contains('on') || [...this.panels.values()].some((p) => p.wrap.classList.contains('on'))
  }

  /** Esc: close the topmost panel, else toggle the menu (only while playing). */
  onEscape(): void {
    for (const id of ['settings', 'replays', 'backlog', 'saves'] as PanelId[]) {
      if (this.panelOpen(id)) {
        this.closePanel(id)
        return
      }
    }
    if (this.engine.session === 'playing') this.toggle()
  }

  /** Close the menu and every panel (a plugin screen is opening). */
  closeAll(): void {
    this.close()
    for (const id of this.panels.keys()) this.closePanel(id)
  }

  /** A plugin's menu entry (`ctx.screen.menuItem`); returns the remover. */
  addItem(key: string, label: () => string, onSelect: () => void, when: 'playing' | 'always'): () => void {
    const btn = button('nilvn-menu__item nilvn-menu__item--plugin', label(), () => {
      this.close()
      onSelect()
    })
    btn.dataset.id = key
    this.panel.insertBefore(btn, this.tip)
    this.extras.set(key, { btn, label, when })
    return () => {
      btn.remove()
      this.extras.delete(key)
    }
  }

  /** A plugin's settings changed elsewhere — refresh the open panel's rows. */
  pluginRowsChanged(): void {
    if (this.panelOpen('settings')) this.settingsBody?.sync()
  }

  /** Open a full-stage panel (the title page's Load / Settings buttons use this too). */
  open(id: 'saves' | 'load' | 'backlog' | 'replays' | 'settings'): void {
    if (id === 'load' || id === 'saves') {
      this.savesMode = id === 'load' ? 'load' : 'save'
      this.openPanel('saves')
    } else this.openPanel(id)
  }

  // ---- the menu itself ----

  private toggle(): void {
    const open = this.wrap.classList.toggle('on')
    if (open) this.syncItems()
  }
  private close(): void {
    this.wrap.classList.remove('on')
  }

  private makeItem(id: string): HTMLButtonElement | null {
    const e = this.engine
    const item = (fn: () => void): HTMLButtonElement => button('nilvn-menu__item', '', fn)
    switch (id) {
      case 'save':
        return item(() => this.open('saves'))
      case 'load':
        return item(() => this.open('load'))
      case 'quicksave':
        return item(() => {
          this.close()
          void e.quickSave().then((ok) => this.flash(e.t(ok ? 'ui.saves.msg.saved' : 'ui.saves.msg.failed')))
        })
      case 'quickload':
        return item(() => {
          this.close()
          void e.quickLoad().then((ok) => {
            if (!ok) this.flash(e.t('ui.saves.msg.noQuick'))
          })
        })
      case 'backlog':
        return item(() => this.open('backlog'))
      case 'auto':
        return item(() => {
          e.setAuto(!e.auto)
          this.syncItems()
          this.close()
        })
      case 'skip':
        return item(() => {
          e.setSkip(!e.skip)
          this.syncItems()
          this.close()
        })
      case 'settings':
        return item(() => this.open('settings'))
      case 'replays':
        return item(() => this.open('replays'))
      case 'title':
        return item(() => {
          this.close()
          void this.confirm('ui.msg.toTitleConfirm').then((ok) => ok && void e.showTitle())
        })
      case 'restart':
        return item(() => {
          this.close()
          void this.confirm('ui.msg.restartConfirm').then((ok) => ok && void e.restart())
        })
      default:
        return null
    }
  }

  private syncItems(): void {
    const e = this.engine
    const replaying = e.isReplaying() !== null
    for (const x of this.extras.values()) x.btn.style.display = x.when === 'always' || e.session === 'playing' ? '' : 'none'
    const set = (id: string, on: boolean): void => {
      this.items.get(id)?.classList.toggle('on', on)
    }
    set('auto', e.auto)
    set('skip', e.skip)
    for (const id of ['save', 'quicksave']) {
      const b = this.items.get(id)
      if (b) b.disabled = replaying
    }
    const replays = this.items.get('replays')
    if (replays) replays.style.display = e.replays.length ? '' : 'none'
    const exit = this.items.get('replayExit')
    if (exit) exit.style.display = replaying ? '' : 'none'
  }

  private onSession(state: string): void {
    const playing = state === 'playing'
    this.wrap.style.display = playing && (this.engine.menuConfig.entry ?? 'top-right') !== 'hidden' ? '' : 'none'
    if (!playing) {
      this.close()
      for (const id of this.panels.keys()) this.closePanel(id)
    }
  }

  private flash(msg: string): void {
    this.tip.textContent = msg
    if (this.tipTimer !== undefined) clearTimeout(this.tipTimer)
    this.tipTimer = window.setTimeout(() => (this.tip.textContent = ''), 1800)
  }

  private confirm(msgId: string): Promise<boolean> {
    return this.engine.stage.chrome.confirm(this.engine.t(msgId), { ok: this.engine.t('ui.dialog.ok'), cancel: this.engine.t('ui.dialog.cancel') })
  }

  // ---- full-stage panels ----

  private makePanel(id: PanelId): void {
    const wrap = this.engine.stage.chrome.overlay(`nilvn-backlog nilvn-panel--${id}${id === 'saves' ? ' nilvn-saves' : ''}`)
    wrap.addEventListener('click', (ev) => ev.stopPropagation())
    const bar = el('div', 'nilvn-backlog__bar')
    const title = el('span', 'nilvn-saves__title')
    const close = button('nilvn-backlog__close', '', () => this.closePanel(id))
    bar.append(title, close)
    const body = el('div', id === 'saves' ? 'nilvn-saves__body' : 'nilvn-backlog__list')
    wrap.append(bar, body)
    this.panels.set(id, { wrap, title, close, body })
  }
  private panelOpen(id: PanelId): boolean {
    return this.panels.get(id)!.wrap.classList.contains('on')
  }
  private openPanel(id: PanelId): void {
    this.close()
    for (const other of this.panels.keys()) if (other !== id) this.closePanel(other)
    this.render(id)
    this.panels.get(id)!.wrap.classList.add('on')
  }
  private closePanel(id: PanelId): void {
    this.panels.get(id)!.wrap.classList.remove('on')
  }
  private render(id: PanelId): void {
    if (id === 'saves') void this.renderSaves()
    else if (id === 'backlog') this.renderBacklog()
    else if (id === 'replays') this.renderReplays()
    else this.renderSettings()
  }

  // ---- saves ----

  private async renderSaves(): Promise<void> {
    const e = this.engine
    const p = this.panels.get('saves')!
    p.title.textContent = e.t(this.savesMode === 'save' ? 'ui.menu.save' : 'ui.menu.load')
    const pages = e.savesConfig.pages ?? 10
    const perPage = e.savesConfig.slotsPerPage ?? 10
    const tabs = el('div', 'nilvn-saves__pages')
    for (let i = 0; i < pages; i++) {
      const tab = button('nilvn-saves__page' + (i === this.savesPage ? ' on' : ''), String(i + 1), () => {
        this.savesPage = i
        void this.renderSaves()
      })
      tabs.append(tab)
    }
    const grid = el('div', 'nilvn-saves__grid')
    const cells: { key: string; label: string; special: boolean }[] = []
    if (this.savesMode === 'load' && this.savesPage === 0) {
      cells.push({ key: AUTOSAVE_KEY, label: e.t('ui.saves.autoSlot'), special: true })
      cells.push({ key: QUICKSAVE_KEY, label: e.t('ui.saves.quickSlot'), special: true })
    }
    for (let i = 0; i < perPage; i++) {
      const n = this.savesPage * perPage + i
      cells.push({ key: `slot:${n}`, label: `${this.savesPage + 1}-${i + 1}`, special: false })
    }
    const payloads = await Promise.all(cells.map((c) => e.readSave(c.key)))
    if (!this.panelOpen('saves') && p.body.childElementCount) {
      /* closed meanwhile — still fine to paint */
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!
      const data = payloads[i]
      const cell = el('button', 'nilvn-saves__slot' + (data ? ' has-data' : '') + (c.special ? ' nilvn-saves__slot--special' : ''))
      cell.type = 'button'
      const no = el('span', 'nilvn-saves__no', c.label)
      const when = el('span', 'nilvn-saves__when', data ? new Date(data.savedAt).toLocaleString() : e.t('ui.saves.empty'))
      const prev = el('span', 'nilvn-saves__preview', data?.preview ?? '')
      cell.append(no, when, prev)
      const bgRef = data?.state?.stage?.bgRef
      if (data && bgRef && (e.savesConfig.thumbnail ?? 'bg') === 'bg') {
        const thumb = el('span', 'nilvn-saves__thumb')
        thumb.style.backgroundImage = `url("${e.resolve(bgRef)}")`
        cell.prepend(thumb)
      }
      if (data && !c.special) {
        const del = button('nilvn-saves__del', '✕', () => {
          void this.confirm('ui.saves.msg.delete').then(async (ok) => {
            if (!ok) return
            await e.deleteSave(c.key)
            await this.renderSaves()
          })
        })
        del.title = e.t('ui.saves.delete')
        del.addEventListener('click', (ev) => ev.stopPropagation())
        cell.append(del)
      }
      cell.addEventListener('click', () => void this.onSlot(c.key, c.special, data))
      grid.append(cell)
    }
    p.body.replaceChildren(tabs, grid)
  }

  private async onSlot(key: string, special: boolean, data: SlotPayload | undefined): Promise<void> {
    const e = this.engine
    if (this.savesMode === 'save') {
      if (special) return
      if (data && !(await this.confirm('ui.saves.msg.overwrite'))) return
      const ok = await e.writeSave(key)
      if (ok) await this.renderSaves()
      else this.flash(e.t('ui.saves.msg.failed'))
    } else {
      if (!data) return
      const ok = await e.restoreState(data.state)
      if (!ok) {
        this.flash(e.t('ui.saves.msg.mismatch'))
        return
      }
      this.replayStash = null // a load leaves any interrupted replay behind
      this.closePanel('saves')
      this.close()
    }
  }

  // ---- backlog ----

  private renderBacklog(): void {
    const e = this.engine
    const p = this.panels.get('backlog')!
    p.title.textContent = e.t('ui.menu.backlog')
    p.body.replaceChildren()
    const entries = e.getBacklog()
    if (!entries.length) {
      p.body.append(el('div', 'nilvn-backlog__empty', e.t('ui.backlog.empty')))
      return
    }
    for (const entry of entries) {
      const row = el('div', 'nilvn-backlog__row')
      if (entry.voiceRef) {
        const ref = entry.voiceRef
        const off = entry.offset
        const v = button('nilvn-backlog__voice', '▶', () => void e.replayVoice(ref, off))
        v.title = e.t('ui.backlog.playVoice')
        row.append(v)
      }
      const body = el('div', 'nilvn-backlog__body')
      if (entry.speaker) body.append(el('div', 'nilvn-backlog__who', entry.speaker))
      body.append(el('div', 'nilvn-backlog__text', entry.text))
      row.append(body)
      p.body.append(row)
    }
    p.body.scrollTop = p.body.scrollHeight
  }

  // ---- replays ----

  private replayTitle(r: { title: string }, i: number): string {
    const raw = r.title.startsWith('@') ? this.engine.resolveText(r.title.slice(1)) : r.title
    return raw || `${this.engine.t('ui.menu.replays')} ${i + 1}`
  }

  private exitReplay(): void {
    const stash = this.replayStash
    this.replayStash = null
    this.closePanel('replays')
    if (stash) void this.engine.restoreState(stash)
  }

  /** A replay reached its end: restore the stashed story session (true), or
   *  there was none (false — the engine finishes the run). */
  handleReplayEnd(): boolean {
    if (!this.replayStash) return false
    this.exitReplay()
    return true
  }

  private renderReplays(): void {
    const e = this.engine
    const p = this.panels.get('replays')!
    p.title.textContent = e.t('ui.menu.replays')
    p.body.replaceChildren()
    e.replays.forEach((r, i) => {
      const row = el('div', 'nilvn-backlog__row')
      const body = el('div', 'nilvn-backlog__body')
      const title = el('div', 'nilvn-backlog__who')
      if (e.isUnlocked(r.id)) {
        const play = button('nilvn-backlog__voice', '▶', () => {
          // Stash the interrupted session; the replay's end (or backing out)
          // restores it. Replaying FROM a replay keeps the original stash.
          if (!this.replayStash && e.isReplaying() === null) this.replayStash = e.saveState()
          this.closePanel('replays')
          this.close()
          void e.playReplay(r.id)
        })
        play.title = this.replayTitle(r, i)
        row.append(play)
        title.textContent = this.replayTitle(r, i)
      } else title.textContent = `🔒 ${e.t('ui.replays.locked')}`
      body.append(title)
      row.append(body)
      p.body.append(row)
    })
  }

  // ---- settings ----

  private renderSettings(): void {
    const e = this.engine
    const p = this.panels.get('settings')!
    p.title.textContent = e.t('ui.menu.settings')
    const grid = el('div', 'nilvn-menu__grid')
    const syncs: (() => void)[] = []
    const relabels: (() => void)[] = []
    const row = (labelId: string): { row: HTMLElement; label: HTMLElement } => {
      const r = el('div', 'nilvn-menu__row')
      const label = el('span', '', e.t(labelId))
      r.append(label)
      relabels.push(() => (label.textContent = e.t(labelId)))
      return { row: r, label }
    }
    const seg = <T>(opts: { id: string; value: T }[], get: () => T, set: (v: T) => void): HTMLElement => {
      const s = el('div', 'nilvn-menu__seg')
      const btns = opts.map((o) => {
        const b = button('', e.t(o.id), () => {
          set(o.value)
          sync()
        })
        s.append(b)
        return b
      })
      const sync = (): void => btns.forEach((b, i) => b.classList.toggle('on', get() === opts[i]!.value))
      syncs.push(sync)
      relabels.push(() => btns.forEach((b, i) => (b.textContent = e.t(opts[i]!.id))))
      sync()
      return s
    }
    const slider = (min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement[] => {
      const input = el('input', 'nilvn-menu__vol')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      const pct = el('span', 'nilvn-menu__pct')
      const sync = (): void => {
        input.value = String(get())
        pct.textContent = fmt(get())
      }
      input.addEventListener('input', () => {
        set(Number(input.value))
        pct.textContent = fmt(Number(input.value))
      })
      syncs.push(sync)
      sync()
      return [input, pct]
    }
    for (const id of e.settingsConfig.show ?? SETTINGS_ROWS_DEFAULT) {
      switch (id) {
        case 'textSpeed': {
          const r = row('ui.settings.textSpeed')
          r.row.append(seg(SPEEDS.map((s) => ({ id: s.id, value: s.cps })), () => e.textSpeed, (v) => (e.textSpeed = v)))
          grid.append(r.row)
          break
        }
        case 'autoDelay': {
          const r = row('ui.settings.autoDelay')
          r.row.append(...slider(0.5, 5, 0.1, () => e.autoDelay, (v) => e.setAutoDelay(v), (v) => `${v.toFixed(1)}s`))
          grid.append(r.row)
          break
        }
        case 'skipMode': {
          const r = row('ui.settings.skipMode')
          r.row.append(
            seg(
              [
                { id: 'ui.settings.skip.read', value: 'read' as const },
                { id: 'ui.settings.skip.all', value: 'all' as const },
              ],
              () => e.skipMode,
              (v) => e.setSkipMode(v),
            ),
          )
          grid.append(r.row)
          break
        }
        case 'volumes':
          for (const ch of CHANNELS) {
            const r = row(ch.id)
            r.row.append(...slider(0, 100, 1, () => Math.round(e.getVolume(ch.key) * 100), (v) => e.setVolume(ch.key, v / 100), (v) => `${v}%`))
            grid.append(r.row)
          }
          break
        case 'language':
          if (e.languages.length > 1) {
            const r = row('ui.settings.language')
            const s = el('div', 'nilvn-menu__seg')
            const btns = e.languages.map((lang) => {
              const b = button('', e.languageName(lang), () => void e.setLanguage(lang))
              s.append(b)
              return b
            })
            const sync = (): void => btns.forEach((b, i) => b.classList.toggle('on', e.lang === e.languages[i]))
            syncs.push(sync)
            sync()
            r.row.append(s)
            grid.append(r.row)
          }
          break
        case 'fullscreen': {
          const r = row('ui.settings.fullscreen')
          r.row.append(
            seg(
              [
                { id: 'ui.settings.on', value: true },
                { id: 'ui.settings.off', value: false },
              ],
              () => e.isFullscreen(),
              (v) => void e.setFullscreen(v),
            ),
          )
          grid.append(r.row)
          break
        }
        case 'dialogOpacity': {
          const r = row('ui.settings.dialogOpacity')
          r.row.append(...slider(20, 100, 5, () => Math.round(e.dialogOpacity * 100), (v) => e.setDialogOpacity(v / 100), (v) => `${v}%`))
          grid.append(r.row)
          break
        }
        case 'uiScale': {
          const r = row('ui.settings.uiScale')
          r.row.append(...slider(80, 150, 5, () => Math.round(e.uiScale * 100), (v) => e.setUiScale(v / 100), (v) => `${v}%`))
          grid.append(r.row)
          break
        }
        default:
          e.report({ phase: 'load', message: `[settings] unknown row "${id}" — ignored` }, true)
      }
    }
    // Plugin settings (`contributes.config` rows with scope = player), one block per plugin.
    for (const pc of e.activePluginConfigs()) {
      const head = el('div', 'nilvn-menu__head', pc.name())
      relabels.push(() => (head.textContent = pc.name()))
      grid.append(head)
      for (const f of pc.fields) {
        const r = el('div', 'nilvn-menu__row')
        const label = el('span', '', pc.t(f.label))
        r.append(label)
        relabels.push(() => (label.textContent = pc.t(f.label)))
        const set = (v: unknown): void => e.setPluginConfig(pc.id, { [f.key]: v }, { player: true })
        const get = (): unknown => e.pluginConfigValue(pc.id, f.key)
        if (f.type === 'boolean') {
          r.append(
            seg(
              [
                { id: 'ui.settings.on', value: true },
                { id: 'ui.settings.off', value: false },
              ],
              () => get() === true,
              set,
            ),
          )
        } else if (f.type === 'number' && f.min !== undefined && f.max !== undefined) {
          r.append(...slider(f.min, f.max, f.step ?? 1, () => Number(get() ?? f.min), set, (v) => String(v)))
        } else if (f.type === 'enum' && f.options?.length) {
          const s = el('div', 'nilvn-menu__seg')
          const btns = f.options.map((o) => {
            const b = button('', pc.t(o.label), () => {
              set(o.value)
              sync()
            })
            s.append(b)
            return b
          })
          const sync = (): void => btns.forEach((b, i) => b.classList.toggle('on', get() === f.options![i]!.value))
          syncs.push(sync)
          sync()
          r.append(s)
        } else {
          const input = el('input', 'nilvn-menu__text')
          input.type = 'text'
          const sync = (): void => {
            input.value = String(get() ?? '')
          }
          input.addEventListener('change', () => set(input.value))
          syncs.push(sync)
          sync()
          r.append(input)
        }
        grid.append(r)
      }
    }
    p.body.replaceChildren(grid)
    this.settingsBody = { sync: () => syncs.forEach((f) => f()), relabel: () => relabels.forEach((f) => f()) }
  }

  // ---- language ----

  private applyLang(): void {
    const e = this.engine
    this.btn.title = e.t('ui.menu.title')
    const labels: Record<string, string> = {
      save: 'ui.menu.save',
      load: 'ui.menu.load',
      quicksave: 'ui.menu.quicksave',
      quickload: 'ui.menu.quickload',
      backlog: 'ui.menu.backlog',
      auto: 'ui.menu.auto',
      skip: 'ui.menu.skip',
      settings: 'ui.menu.settings',
      replays: 'ui.menu.replays',
      title: 'ui.menu.toTitle',
      restart: 'ui.menu.restart',
      replayExit: 'ui.menu.replayExit',
    }
    for (const [id, b] of this.items) b.textContent = e.t(labels[id] ?? id)
    for (const x of this.extras.values()) x.btn.textContent = x.label()
    if (this.verEl) this.verEl.textContent = e.t('ui.menu.version', { ver: e.buildInfo ?? '' })
    for (const [id, p] of this.panels) {
      p.close.textContent = e.t('ui.menu.close')
      if (p.wrap.classList.contains('on')) this.render(id)
    }
    this.settingsBody?.relabel()
    this.settingsBody?.sync()
  }
}
