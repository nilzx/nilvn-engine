// Small DOM pieces the built-in chrome shares (the system menu, the [ui]
// panels, the stage's pages):
//
// - icons: hand-drawn-feel line icons on a 24 × 24 grid, round strokes in
//   `currentColor`, so every one follows the text colour of the button it sits
//   in (and a theme's `button-color` / `panel-color`). Inline SVG, no font or
//   image to load; decorative (`aria-hidden`) — the button carries the
//   accessible name;
// - an icon + label button's label;
// - a range slider drawn with the theme (a track, a fill and a thumb) around a
//   native `<input type="range">`, which keeps the keyboard and pointer handling.

const SVG_NS = 'http://www.w3.org/2000/svg'

const ICONS: Record<string, string> = {
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  play: '<path d="M8 5.3l10.5 6.7L8 18.7z" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  save: '<path d="M5 4h11.5L20 7.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v4.5h7V4"/><rect x="7.5" y="13" width="9" height="7" rx="1"/>',
  load: '<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/><path d="M12 11v5.5M9.5 14l2.5 2.5 2.5-2.5"/>',
  quicksave: '<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>',
  quickload: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4h4"/><path d="M12 8v4l2.8 2"/>',
  backlog: '<path d="M7 5.5h12M7 12h12M7 18.5h8"/><circle cx="3.8" cy="5.5" r=".6" fill="currentColor"/><circle cx="3.8" cy="12" r=".6" fill="currentColor"/><circle cx="3.8" cy="18.5" r=".6" fill="currentColor"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.6l5 3.4-5 3.4z" fill="currentColor"/>',
  skip: '<path d="M4 6.5l7 5.5-7 5.5zM12 6.5l7 5.5-7 5.5z"/><path d="M20.5 6v12"/>',
  settings: '<path d="M4 7h8.5M16.5 7H20M4 17h3.5M11.5 17H20"/><circle cx="14.5" cy="7" r="2.2"/><circle cx="9.5" cy="17" r="2.2"/>',
  replays: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  title: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5v4h-4"/>',
  exit: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10.5 16.5L6 12l4.5-4.5M6 12h9.5"/>',
  plugin: '<path d="M11 3.5l1.7 4.8L17.5 10l-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18"/><rect x="6.5" y="12" width="11" height="4.5" rx="1.2"/>',
  voice: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
}

export type IconName = keyof typeof ICONS

/** An icon element (`<svg class="nilvn-icon nilvn-icon--<name>">`); an unknown
 *  name draws nothing. */
export function icon(name: string, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', `nilvn-icon nilvn-icon--${name}${className ? ' ' + className : ''}`)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.innerHTML = ICONS[name] ?? ''
  return svg
}

/** The label span of an icon + label button (created on first use), so the
 *  label can change (a language switch) without dropping the icon. */
export function setLabel(btn: HTMLElement, text: string): void {
  let span = btn.querySelector<HTMLElement>(':scope > .nilvn-label')
  if (!span) {
    span = document.createElement('span')
    span.className = 'nilvn-label'
    btn.append(span)
  }
  span.textContent = text
}

/** Wrap a range input in the themed slider (`.nilvn-range`: track, fill, the
 *  input on top). Returns the wrapper and `sync()`, which repaints the fill
 *  from the input's value — call it after setting the value from code (the
 *  input's own `input` events repaint it already). */
export function rangeShell(input: HTMLInputElement): { wrap: HTMLElement; sync: () => void } {
  const wrap = document.createElement('span')
  wrap.className = 'nilvn-range'
  const track = document.createElement('span')
  track.className = 'nilvn-range__track'
  const fill = document.createElement('span')
  fill.className = 'nilvn-range__fill'
  track.append(fill)
  wrap.append(track, input)
  const sync = (): void => {
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const v = Number(input.value)
    const p = max > min && Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0
    wrap.style.setProperty('--range-p', String(Math.round(p * 1e4) / 1e4))
    wrap.classList.toggle('is-disabled', input.disabled)
  }
  input.addEventListener('input', sync)
  sync()
  return { wrap, sync }
}
