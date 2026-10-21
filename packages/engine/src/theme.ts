// Theme tokens — the engine's one styling contract. Every colour, size and font
// the built-in chrome (dialogue box, name tag, indicator, choices, and the
// screens batch G adds) draws with is a CSS custom property `--nilvn-<token>` on
// the stage root. The table below is the closed set with its defaults: the base
// stylesheet declares them on `.nilvn-root`, so a host, a config file's
// `[theme]` / `[window]`, `engine.setTheme()` or the script's `[theme …]`
// command only ever overrides — never redefines the rules. Token names are a
// public contract (renames go through a deprecation period).
//
// Two layers: the BASE layer (host / config — survives restart and loads) and
// the SCRIPT layer (`[theme …]`, part of the stage snapshot, reset by a
// restart). The renderer paints base then script.

export const THEME_PREFIX = '--nilvn-'

/** Token → default value. Values may reference other tokens (`var(--nilvn-…)`). */
export const THEME_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  // stage
  font: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif',
  'ui-scale': '1',
  accent: '#a35cf0',
  text: '#f6f3fb',
  // secondary text (hints, captions, a locked entry) and a disabled control, derived from `text`
  muted: 'color-mix(in srgb, var(--nilvn-text) 62%, transparent)',
  disabled: 'color-mix(in srgb, var(--nilvn-text) 36%, transparent)',
  // the shared scale every part of the chrome is drawn with: corner radii, spacing,
  // the height of a control (a tap target), three UI text sizes, the keyboard focus
  // ring, three shadow depths and the motion of a state change. Lengths follow the
  // stage (cqh) with a px floor, so a small stage stays readable and tappable.
  'radius-s': 'max(6px, 1.1cqh)',
  'radius-m': 'max(10px, 1.9cqh)',
  'radius-l': 'max(14px, 2.8cqh)',
  'radius-pill': '999px',
  'space-xs': 'max(4px, .6cqh)',
  'space-s': 'max(6px, 1.2cqh)',
  'space-m': 'max(10px, 2.2cqh)',
  'space-l': 'max(16px, 3.6cqh)',
  'control-height': 'max(34px, 6.2cqh)',
  'font-size-s': 'max(11px, 1.9cqh)',
  'font-size-m': 'max(12px, 2.4cqh)',
  'font-size-l': 'max(14px, 3cqh)',
  'focus-ring': '2px solid color-mix(in srgb, var(--nilvn-accent) 55%, white)',
  'shadow-s': '0 2px 6px rgba(8,4,20,.22)',
  'shadow-m': '0 8px 24px rgba(8,4,20,.32)',
  'shadow-l': '0 18px 48px rgba(8,4,20,.46)',
  duration: '.18s',
  easing: 'cubic-bezier(.2,.8,.2,1)',
  // a raised fill inside a panel (a save slot, a backlog row, a settings track) and its hover
  surface: 'var(--nilvn-button-bg)',
  'surface-hover': 'var(--nilvn-button-hover)',
  // a slider's thumb (the settings page and the [ui] slider widget)
  'slider-thumb': '#ffffff',
  // a [hotspot] under the pointer
  'hotspot-hover': 'color-mix(in srgb, var(--nilvn-accent) 14%, transparent)',
  // dialogue box
  'dialog-bg': 'rgba(27,23,40,.86)',
  'dialog-skin': 'none',
  // nine-slice skin: a full `border-image` value (`[window] slice` builds it); `none` = stretch `dialog-skin`
  'dialog-skin-slice': 'none',
  'dialog-border': '1px solid color-mix(in srgb, var(--nilvn-text) 12%, transparent)',
  'dialog-radius': 'var(--nilvn-radius-l)',
  'dialog-shadow': 'var(--nilvn-shadow-m)',
  'dialog-opacity': '1',
  'dialog-inset': '3.5%',
  'dialog-bottom': '3.5cqh',
  'dialog-top': 'auto',
  'dialog-height': '24cqh',
  'dialog-padding': 'max(16px, 4cqh) max(18px, 3.4cqw) max(12px, 2.4cqh)',
  // how far a bottom-anchored HUD, the toast and bottom choices stay above the box
  'dialog-clearance': 'calc(var(--nilvn-dialog-bottom) + var(--nilvn-dialog-height) + var(--nilvn-space-m))',
  'text-size': 'max(13px, 3.4cqh)',
  'text-line-height': '1.75',
  'text-color': 'var(--nilvn-text)',
  'text-shadow': '0 1px 2px rgba(8,4,20,.45)',
  // name tag
  'name-bg': 'var(--nilvn-accent)',
  'name-color': '#ffffff',
  'name-size': 'max(12px, 2.6cqh)',
  'name-offset': 'max(14px, 2.6cqw)',
  'name-shadow': 'var(--nilvn-shadow-s)',
  'name-radius': 'var(--nilvn-radius-pill)',
  // the name tag's skin ([window] nameSkin): a stretched image, or a nine-slice `border-image` value
  'name-skin': 'none',
  'name-skin-slice': 'none',
  // click-to-continue indicator
  'indicator-color': 'color-mix(in srgb, var(--nilvn-text) 85%, transparent)',
  'indicator-size': 'max(9px, 1.6cqh)',
  // choices
  'choices-backdrop': 'rgba(12,8,24,.32)',
  'choice-bg': 'rgba(31,26,46,.9)',
  'choice-color': '#ffffff',
  'choice-border': '1px solid color-mix(in srgb, var(--nilvn-choice-color) 16%, transparent)',
  'choice-hover': 'color-mix(in srgb, var(--nilvn-accent) 65%, white)',
  // the glow under a hovered option, derived from `choice-hover`
  'choice-glow': '0 6px 24px color-mix(in srgb, var(--nilvn-choice-hover) 30%, transparent)',
  'choice-radius': 'var(--nilvn-radius-pill)',
  'choice-size': 'max(13px, 2.9cqh)',
  'choice-width': 'max(200px, 38cqw)',
  'choices-gap': 'max(8px, 2cqh)',
  'choice-skin': 'none',
  'choice-skin-slice': 'none',
  // an option taken in an earlier run ([choices] chosenStyle = "dim"), a disabled one, the timer bar
  'choice-chosen-bg': 'rgba(31,26,46,.66)',
  'choice-chosen-color': 'color-mix(in srgb, var(--nilvn-choice-color) 62%, transparent)',
  // the badge after an option taken in an earlier run ([choices] chosenStyle = "mark"): a CSS `content` value
  'choice-chosen-mark': '"\\2713"',
  'choice-disabled-bg': 'rgba(31,26,46,.55)',
  'choice-disabled-color': 'var(--nilvn-disabled)',
  'choice-timer-bg': 'color-mix(in srgb, var(--nilvn-choice-color) 16%, transparent)',
  'choice-timer-color': 'var(--nilvn-accent)',
  // a command-window list (one frame around all options, text-aligned, a cursor
  // beside the hovered or focused one instead of a lift)
  'choice-align': 'center',
  'choice-lift': '-2px',
  // a CSS `content` value (`"\25B6"`), `none` for no cursor
  'choice-cursor': 'none',
  'choice-cursor-color': 'var(--nilvn-choice-hover)',
  // the keyboard-focus outline on an option (a cursor may mark focus instead)
  'choice-focus-ring': 'var(--nilvn-focus-ring)',
  'choices-list-bg': 'none',
  'choices-list-border': 'none',
  'choices-list-radius': '0',
  'choices-list-padding': '0',
  'choices-list-shadow': 'none',
  // the loading page's progress bar
  'progress-bg': 'color-mix(in srgb, var(--nilvn-screen-color) 16%, transparent)',
  'progress-color': 'var(--nilvn-accent)',
  // declarative panels ([ui.<id>]): a HUD, a window, and the bar widget
  'hud-bg': 'rgba(27,23,40,.74)',
  'hud-border': '1px solid color-mix(in srgb, var(--nilvn-hud-color) 12%, transparent)',
  'hud-color': 'var(--nilvn-panel-color)',
  'hud-radius': 'var(--nilvn-radius-m)',
  'hud-padding': 'var(--nilvn-space-s) var(--nilvn-space-m)',
  'hud-size': 'max(11px, 2.2cqh)',
  'window-bg': 'var(--nilvn-panel-bg)',
  'window-border': 'var(--nilvn-panel-border)',
  'window-color': 'var(--nilvn-panel-color)',
  'window-radius': 'var(--nilvn-radius-l)',
  'window-padding': 'var(--nilvn-space-l)',
  'window-width': 'max(240px, 40cqw)',
  'bar-bg': 'color-mix(in srgb, var(--nilvn-hud-color) 16%, transparent)',
  'bar-color': 'var(--nilvn-accent)',
  'bar-height': 'max(6px, 1.2cqh)',
  // the title / ending / loading pages: the veil behind them when the page has no
  // background, their text, and the heading's shadow ([title] / [ending.<id>]
  // `color` and `shadow` set the last two per page)
  'screen-bg': 'radial-gradient(90% 70% at 15% 0%, color-mix(in srgb, var(--nilvn-accent) 26%, transparent), transparent 70%), radial-gradient(80% 70% at 100% 100%, rgba(255,110,170,.16), transparent 70%), #16121f',
  'screen-color': 'var(--nilvn-panel-color)',
  'screen-heading-shadow': '0 2px 16px rgba(8,4,20,.45)',
  // panels and buttons (menus, screens, plugin overlays)
  'panel-bg': 'rgba(33,28,48,.98)',
  'panel-border': '1px solid color-mix(in srgb, var(--nilvn-panel-color) 10%, transparent)',
  'panel-color': '#f6f3fb',
  'button-bg': 'color-mix(in srgb, var(--nilvn-button-color) 8%, transparent)',
  'button-color': 'var(--nilvn-panel-color)',
  'button-border': '1px solid color-mix(in srgb, var(--nilvn-button-color) 10%, transparent)',
  'button-hover': 'color-mix(in srgb, var(--nilvn-button-color) 15%, transparent)',
  // the in-game menu's ☰ entry button ([menu] skin / background / color); a floating chip like a HUD by default
  'menu-button-bg': 'var(--nilvn-hud-bg)',
  'menu-button-color': 'var(--nilvn-hud-color)',
  'menu-button-border': 'var(--nilvn-hud-border)',
  'menu-button-radius': '50%',
  'menu-button-size': 'max(34px, 5.6cqh)',
  'menu-button-skin': 'none',
  'menu-button-skin-slice': 'none',
  // an image behind the system pages — save / load, settings, backlog, replays ([menu] panelSkin)
  'panel-skin': 'none',
  'panel-skin-slice': 'none',
  // a rule between groups of a panel, the dim layer under a dialog, a floating
  // panel's shadow, and a warning (an invalid entry)
  divider: 'color-mix(in srgb, var(--nilvn-panel-color) 14%, transparent)',
  backdrop: 'rgba(12,8,24,.58)',
  'panel-shadow': 'var(--nilvn-shadow-l)',
  danger: '#ff6b81',
  // the selected state (an active menu mode, the chosen option in a settings row, the current slot page)
  'button-on-bg': 'var(--nilvn-accent)',
  'button-on-color': '#ffffff',
  // the [input] box: its dialog (defaults to the panel look; `[input] skin` reskins it) and the text field
  'input-box-bg': 'var(--nilvn-panel-bg)',
  'input-box-border': 'var(--nilvn-panel-border)',
  'input-box-radius': 'var(--nilvn-radius-l)',
  'input-box-skin': 'none',
  'input-box-skin-slice': 'none',
  'input-bg': 'color-mix(in srgb, var(--nilvn-input-color) 8%, transparent)',
  'input-color': 'var(--nilvn-panel-color)',
  'input-border': '1px solid color-mix(in srgb, var(--nilvn-input-color) 22%, transparent)',
  'input-radius': 'var(--nilvn-radius-m)',
  'input-size': 'max(14px, 3cqh)',
  // the [input] box's prompt text and its Cancel button (OK keeps the button-on look)
  'input-prompt-color': 'var(--nilvn-panel-color)',
  'input-button-bg': 'var(--nilvn-button-bg)',
  'input-button-color': 'var(--nilvn-button-color)',
})

/** A partial token map. `undefined` / `''` removes the token from its layer. */
export type ThemeTokens = Record<string, string | undefined>

/** Token grammar: lower-case words joined by dashes. */
export const THEME_TOKEN_RE = /^[a-z][a-z0-9-]*$/

export function isThemeToken(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEME_TOKENS, key)
}

/** The custom-property name of a token. */
export function themeVar(key: string): string {
  return THEME_PREFIX + key
}

/** The `.nilvn-root { --nilvn-…: … }` declaration block the base stylesheet
 *  carries — the defaults, from the table, one source of truth. */
export function themeDefaultsCss(): string {
  return Object.entries(THEME_TOKENS)
    .map(([k, v]) => `${themeVar(k)}:${v}`)
    .join(';')
}

/** Drop empty / undefined entries and stringify the rest. */
export function cleanTheme(tokens: ThemeTokens | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tokens ?? {})) {
    if (v === undefined || v === null || v === '') continue
    out[k] = String(v)
  }
  return out
}
