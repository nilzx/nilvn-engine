// @vitest-environment jsdom
// Feedback round four (2026-09-28, the author of 《潮汐钟》 closing the work's
// open points with the current engine), fixed at the design level:
//   - the title / ending pages' primary button kept `button-on-color` over the
//     generic hover background under :hover / :focus-visible;
//   - every colour the chrome draws is a token (see theme.test.ts), and a page's
//     heading shadow is one (`screen-heading-shadow`, `[title|ending] shadow`);
//   - `animate` has a lifecycle: `key` replaces, `commit` keeps the end pose,
//     `stopAnimations` ends it;
//   - `[bgm]` states the music: the file already playing carries on;
//   - `sys.replaying` / `sys.session` / `sys.lang` read what the engine is doing;
//   - a replay starts from its scene and leaves the persistent variables as they
//     were; the replay list is a gallery;
//   - `[menu] items` / `[title] buttons` place plugins' entries.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PluginManifest } from '@nilvn/core'
import { DomRenderer } from '../src/stage'
import { createEngine, MemorySaveStore, applyConfig, type Engine } from '../src/index'
import type { EnginePlugin } from '../src/types'

// A WAAPI stand-in that keeps ids, cancels and reports running animations.
let running: FakeAnim[] = []
class FakeAnim {
  id = ''
  private settle!: (ok: boolean) => void
  readonly finished: Promise<void>
  constructor(
    readonly el: Element,
    readonly iterations: number,
  ) {
    this.finished = new Promise<boolean>((r) => (this.settle = r)).then((ok) => {
      if (!ok) throw new DOMException('cancelled', 'AbortError')
    })
  }
  finish(): void {
    running = running.filter((a) => a !== this)
    this.settle(true)
  }
  cancel(): void {
    running = running.filter((a) => a !== this)
    this.settle(false)
  }
}
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.animate = function (this: Element, _k: unknown, o?: KeyframeAnimationOptions | number) {
    const opts = typeof o === 'object' ? o : {}
    const a = new FakeAnim(this, opts.iterations ?? 1)
    a.id = opts.id ?? ''
    running.push(a)
    if (a.iterations !== Infinity) queueMicrotask(() => a.finish())
    return a
  }
  proto.getAnimations = function (this: Element) {
    return running.filter((a) => a.el === this)
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
  ;(HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve()
})
beforeEach(() => {
  running = []
})

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await tick(5)
  if (!cond()) throw new Error('condition never held')
}
function engineWith(opts: Record<string, unknown> = {}): Engine {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return createEngine({ container, textSpeed: 0, saveStore: new MemorySaveStore(), saves: { autosave: false }, baseUrl: 'http://g.test/', ...opts })
}
const click = (e: Engine): void => void e.stage.root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const messages = (e: Engine): string[] => e.diagnostics.map((d) => d.message)

describe('the title and ending pages', () => {
  it('the primary button keeps its own background when hovered or focused', () => {
    new DomRenderer(document.createElement('div'))
    const css = document.getElementById('nilvn-base-style')!.textContent!
    const rule = css.split('\n').find((l) => l.startsWith('.nilvn-screen__button--primary:hover'))
    expect(rule).toContain('.nilvn-screen__button--primary:focus-visible')
    expect(rule).toContain('background:var(--nilvn-button-on-bg)')
    // it follows the generic hover rule, so it wins at equal specificity
    const generic = css.indexOf('.nilvn-screen__button:hover:not(:disabled),.nilvn-screen__button:focus-visible')
    expect(generic).toBeGreaterThan(-1)
    expect(css.indexOf(rule!)).toBeGreaterThan(generic)
  })

  it('a page sets its heading shadow ([ending.<id>] shadow), over the screen-heading-shadow token', async () => {
    const e = engineWith()
    applyConfig(e, { ending: { dawn: { color: '#1b140c', shadow: 'none' } } })
    e.loadSource('[ending dawn]\n')
    await e.start()
    await until(() => e.session === 'ending')
    const page = e.stage.root.querySelector<HTMLElement>('.nilvn-screen--ending')!
    expect(page.style.getPropertyValue('--nilvn-screen-heading-shadow')).toBe('none')
    expect(page.style.color).toBe('rgb(27, 20, 12)')
    e.destroy()
  })
})

describe('animations', () => {
  it('a keyed animation replaces its namesake, stopAnimations ends one, commit keeps the end pose', async () => {
    const stage = new DomRenderer(document.createElement('div'))
    await stage.showChar('yu', 'yu.png', {})
    const sway = stage.animate('character:yu', [{ x: 0 }, { x: 2 }], { durationSec: 4, iterations: Infinity, key: 'sway' })
    void stage.animate('character:yu', [{ x: 0 }, { x: 3 }], { durationSec: 4, iterations: Infinity, key: 'sway' })
    await sway // the first resolved when the second replaced it
    expect(running.filter((a) => a.id === 'nilvn-anim:sway')).toHaveLength(1)
    const other = stage.animate('character:yu', [{ y: 0 }, { y: 1 }], { durationSec: 4, iterations: Infinity })
    stage.stopAnimations('character:yu', 'sway')
    expect(running.map((a) => a.id)).toEqual(['nilvn-anim:'])
    stage.stopAnimations('character:yu')
    await other
    expect(running).toEqual([])
    // no commit: the resting value is untouched; commit: the last frame stays
    await stage.animate('character:yu', [{ opacity: 1 }, { opacity: 0.5 }], { durationSec: 0.1 })
    expect(stage.getProp('character:yu', 'opacity')).toBe(1)
    await stage.animate('character:yu', [{ opacity: 1 }, { opacity: 0.55 }], { durationSec: 0.1, commit: true })
    expect(stage.getProp('character:yu', 'opacity')).toBe(0.55)
  })
})

describe('[bgm]', () => {
  it('the file already playing carries on; restart=true starts it over; a load keeps it', async () => {
    const e = engineWith()
    e.loadSource('[bgm sea.mp3 volume=0.5]\n[bgm sea.mp3 volume=0.8]\n[set a = 1]\n[bgm sea.mp3 restart=true]\n[set b = 1]\n')
    const audios: HTMLAudioElement[] = []
    const Real = window.Audio
    window.Audio = function (url?: string) {
      const a = new Real(url)
      audios.push(a)
      return a
    } as unknown as typeof Audio
    try {
      await e.start()
      expect(audios).toHaveLength(2) // the first [bgm] and the restart — the second one only moved the volume
      const s = e.saveState()
      expect(s.bgm).toEqual({ src: 'http://g.test/sea.mp3', loop: true, volume: 1 })
      e.playBgm('http://g.test/sea.mp3', { volume: 0.3 })
      expect(audios).toHaveLength(2)
    } finally {
      window.Audio = Real
    }
    e.destroy()
  })
})

describe('sys state variables', () => {
  it('sys.session / sys.lang / sys.replaying read what the engine is doing, and are read-only', async () => {
    const e = engineWith({ lang: 'zh', defaultLang: 'zh' })
    e.loadSource('[set s = sys.session]\n[set l = sys.lang]\n[set r = sys.replaying]\n[set sys.replaying = true]\n')
    await e.start()
    expect([e.getVar('s'), e.getVar('l'), e.getVar('r')]).toEqual(['playing', 'zh', false])
    expect(e.getVar('sys.replaying')).toBe(false)
    expect(messages(e)).toContain('sys.replaying is read-only — it reports what the engine is doing')
    e.destroy()
  })
})

/** The two replay commands, as the first-party abreplay plugin has them. */
const replayFixture: EnginePlugin = {
  id: 'com.x.replay',
  permissions: ['session.replay'],
  commands: {
    replaydef() {},
    replayend(ctx) {
      const id = ctx.str(0)
      const replay = ctx.plugin.replay!
      if (replay.isReplaying() === id) replay.end()
      else if (replay.isReplaying() === null) replay.fireSeen(id!)
    },
  },
}

describe('replays', () => {
  const SCRIPT = `[replaydef id=r1 title=Dawn label=dawn]
[persist letter = ""]
[bg sea.png]
[set trust = 3]
[label dawn]
[set seen = seen + 1]
[if sys.replaying -> in_replay]
[set letter = "first"]
[label in_replay]
[set letter = "rewritten"]
xi: Morning.
[replayend r1]
xi: After.
`
  it('start from the scene normal play reached, and leave the persistent variables as they were', async () => {
    const e = engineWith({ plugins: [replayFixture] })
    e.loadSource(SCRIPT)
    void e.start()
    await until(() => e.stage.textEl.textContent === 'Morning.')
    click(e)
    await until(() => e.isUnlocked('r1'))
    expect(e.getVar('letter')).toBe('rewritten')
    // a later run somewhere else
    await e.stage.restore({ chars: [], text: '', dialog: false })
    e.setVar('trust', 0)
    let ended = 0
    e.onReplayEnd = () => void ended++
    expect(await e.playReplay('r1')).toBe(true)
    expect(e.isReplaying()).toBe('r1')
    await until(() => e.stage.textEl.textContent === 'Morning.')
    expect(e.stage.snapshot().bgRef).toBe('sea.png') // the scene's stage
    expect(e.getVar('trust')).toBe(3) // the scene's variables
    expect(e.getVar('sys.replaying')).toBe(true)
    click(e)
    await until(() => ended === 1)
    expect(e.isReplaying()).toBeNull()
    expect(e.getVar('letter')).toBe('rewritten') // the replay's write was rolled back
    expect(e.replayThumbnail('r1')).toBe('http://g.test/sea.png')
    e.destroy()
  })

  it('a replay stops at its end marker, even when whoever takes over is not ready yet', async () => {
    const e = engineWith({ plugins: [replayFixture] })
    e.loadSource('[replaydef id=r1 title=A label=a]\n[label a]\nxi: One.\n[replayend r1]\n[set after = 1]\n[ending good]\n')
    let ended = 0
    e.onReplayEnd = () => void ended++ // takes its time: restores nothing yet
    await e.prepare()
    expect(await e.playReplay('r1')).toBe(true)
    await until(() => e.stage.textEl.textContent === 'One.')
    for (let i = 0; i < 20 && ended === 0; i++) {
      click(e)
      await tick(20)
    }
    expect(ended).toBe(1)
    await tick(50)
    expect(e.getVar('after')).toBeUndefined()
    expect(e.session).not.toBe('ending')
    e.destroy()
  })

  it('the menu lists them as a gallery: a picture and a title once unlocked, a locked card before', async () => {
    const e = engineWith({ plugins: [replayFixture] })
    e.loadSource(SCRIPT + '[replaydef id=r2 title=Dusk label=dawn]\n')
    void e.start()
    await until(() => e.stage.textEl.textContent === 'Morning.')
    click(e)
    await until(() => e.isUnlocked('r1'))
    e.openMenu('replays')
    const cards = [...e.stage.root.querySelectorAll<HTMLElement>('.nilvn-replays__grid .nilvn-replays__card')]
    expect(cards.map((c) => c.textContent)).toEqual(['Dawn', 'Locked'])
    // line icons, not glyphs: a play badge on the unlocked card, a lock on the locked one
    expect(cards[0]!.querySelector('.nilvn-replays__play svg.nilvn-icon--play')).not.toBeNull()
    expect(cards[1]!.querySelector('svg.nilvn-icon--lock')).not.toBeNull()
    expect(cards[0]!.querySelector<HTMLElement>('.nilvn-replays__thumb')!.style.backgroundImage).toBe('url("http://g.test/sea.png")')
    expect(cards[1]!.classList.contains('nilvn-replays__card--locked')).toBe(true)
    e.destroy()
  })
})

describe('placing plugins entries', () => {
  const ID = 'com.x.journal'
  const manifest: PluginManifest = {
    id: ID,
    name: ID,
    version: '1.0.0',
    entries: { engine: 'bundled' },
    permissions: ['ui.screen'],
    contributes: {
      menuItems: [
        { id: 'open', label: 'Journal' },
        { id: 'album', label: 'Album' },
      ],
      titleItems: [{ id: 'album', label: 'Album' }],
    },
  }
  const journal: EnginePlugin = {
    id: ID,
    activate: (ctx) => {
      ctx.screen!.menuItem('open', () => {})
      ctx.screen!.menuItem('album', () => {})
      ctx.screen!.titleItem('album', () => {})
    },
  }
  const order = (e: Engine): string[] =>
    [...e.stage.root.querySelectorAll<HTMLElement>('.nilvn-menu__panel > .nilvn-menu__item')].map((b) => b.dataset.id ?? b.textContent ?? '')

  it('by name (short or full id) where [menu] items lists them, the rest at the plugins slot', async () => {
    const e = engineWith({ registry: [journal], manifests: [manifest], use: [ID] })
    applyConfig(e, { menu: { items: ['journal:open', 'save', 'plugins', 'settings', 'nobody:thing'] } })
    e.loadSource('narr: x\n')
    await e.prepare()
    expect(order(e)).toEqual([`${ID}:open`, 'Save', `${ID}:album`, 'Settings'])
    expect(messages(e)).toContain('[menu] item "nobody:thing" — no active plugin contributes it')
    e.destroy()
  })

  it('the default menu has the plugins slot after the backlog', async () => {
    const e = engineWith({ registry: [journal], manifests: [manifest], use: [ID] })
    e.loadSource('narr: x\n')
    await e.prepare()
    const ids = order(e)
    expect(ids.indexOf(`${ID}:open`)).toBe(ids.indexOf('Backlog') + 1)
    e.destroy()
  })

  it('[title] buttons places a plugin button by name', async () => {
    const e = engineWith({ registry: [journal], manifests: [manifest], use: [ID] })
    applyConfig(e, { title: { buttons: [`${ID}:album`, 'new'] } })
    e.loadSource('narr: x\n')
    await e.showTitle()
    await until(() => e.stage.root.querySelectorAll('.nilvn-screen--title .nilvn-screen__button').length === 2)
    const labels = [...e.stage.root.querySelectorAll('.nilvn-screen--title .nilvn-screen__button')].map((b) => b.textContent)
    expect(labels[0]).toBe('Album')
    e.destroy()
  })
})

describe('a clickable under a choices prompt', () => {
  const run = async (script: string): Promise<string[]> => {
    const e = engineWith()
    e.loadSource(script + '[choice A -> a]\n[choice B -> a]\n[label a]\n')
    void e.start()
    for (let i = 0; i < 100 && !e.stage.choicesEl.querySelector('.nilvn-choice'); i++) {
      click(e)
      await tick(10)
    }
    const out = messages(e).filter((m) => m.includes('can never be clicked'))
    e.destroy()
    return out
  }
  const SPOT = '[hotspot shell x=10 y=10 w=10 h=10 onclick="set got = true"'

  it('is reported when it became clickable after the last line', async () => {
    expect(await run(`narr: The pier.\n${SPOT}]\n`)).toEqual([
      'hotspot "shell" can never be clicked: it became clickable after the last line, and the choices prompt covers the stage — give it a line to be clicked on first',
    ])
  })

  it('is fine with a line to be clicked on first', async () => {
    expect(await run(`${SPOT}]\nnarr: Something glints in the pool.\n`)).toEqual([])
  })

  it('counts from when its if= turns true, not from when it was declared', async () => {
    expect(await run(`${SPOT} if=lit]\nnarr: Dark.\n[set lit = true]\n`)).toHaveLength(1)
  })
})

describe('waitingForPlayer', () => {
  it('is true only while a shown line waits for the player', async () => {
    const e = engineWith({ textSpeed: 5 })
    e.loadSource('narr: A slow line.\n[set done = 1]\n')
    void e.start()
    await until(() => (e.stage.textEl.textContent ?? '').length > 0)
    expect(e.waitingForPlayer).toBe(false) // still typing
    click(e) // completes the line
    await until(() => e.waitingForPlayer)
    click(e)
    await until(() => e.getVar('done') === 1)
    expect(e.waitingForPlayer).toBe(false)
    e.destroy()
  })
})
