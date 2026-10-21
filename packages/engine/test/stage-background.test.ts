// @vitest-environment jsdom
// Backgrounds land in the order they were asked for: one still loading its
// image when a newer one is set (a scene switch in the editor, a skip through
// several [bg] lines) must not land over it afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DomRenderer } from '../src/stage'

const pending = new Map<string, () => void>()
const decode = HTMLImageElement.prototype.decode
beforeAll(() => {
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    return new Promise<void>((r) => pending.set(this.src, r))
  }
})
afterAll(() => {
  HTMLImageElement.prototype.decode = decode
})

const items = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.nilvn-bg-item')]

describe('setBackground', () => {
  it('a slow image set first does not cover the one set after it', async () => {
    const root = document.createElement('div'), stage = new DomRenderer(root)
    const slow = stage.setBackground({ url: 'http://g.test/slow.png' })
    await stage.setBackground({ color: '#123456' })
    pending.get('http://g.test/slow.png')!()
    await slow
    expect(items(root).map((e) => e.style.background)).toEqual(['rgb(18, 52, 86)'])
  })

  it('a restored picture is not covered by a load from before it', async () => {
    const root = document.createElement('div'), stage = new DomRenderer(root)
    const slow = stage.setBackground({ url: 'http://g.test/late.png' })
    await stage.restore({ ...stage.snapshot(), bgCss: 'background: rgb(1, 2, 3);', bgRef: undefined })
    pending.get('http://g.test/late.png')!()
    await slow
    expect(items(root).map((e) => e.style.background)).toEqual(['rgb(1, 2, 3)'])
  })
})
