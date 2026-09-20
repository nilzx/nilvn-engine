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
  accent: '#7c5cff',
  text: '#f4f5fa',
  // dialogue box
  'dialog-bg': 'linear-gradient(180deg,rgba(22,26,42,.82),rgba(10,12,22,.92))',
  'dialog-skin': 'none',
  // nine-slice skin: a full `border-image` value (`[window] slice` builds it); `none` = stretch `dialog-skin`
  'dialog-skin-slice': 'none',
  'dialog-border': '1px solid rgba(255,255,255,.14)',
  'dialog-radius': '1.8cqh',
  'dialog-opacity': '1',
  'dialog-inset': '3.5%',
  'dialog-bottom': '3.5cqh',
  'dialog-top': 'auto',
  'dialog-height': '24cqh',
  'dialog-padding': '3.6cqh 3cqw 2cqh',
  'text-size': '3.4cqh',
  'text-line-height': '1.75',
  'text-color': 'var(--nilvn-text)',
  'text-shadow': '0 1px 2px rgba(0,0,0,.5)',
  // name tag
  'name-bg': 'var(--nilvn-accent)',
  'name-color': '#ffffff',
  'name-size': '2.7cqh',
  'name-offset': '2.4cqw',
  // click-to-continue indicator
  'indicator-color': 'rgba(255,255,255,.85)',
  'indicator-size': '1.4cqh',
  // choices
  'choices-backdrop': 'rgba(5,6,12,.35)',
  'choice-bg': 'linear-gradient(180deg,rgba(40,46,74,.92),rgba(24,28,48,.92))',
  'choice-color': '#ffffff',
  'choice-border': '1px solid rgba(255,255,255,.2)',
  'choice-hover': 'rgba(140,160,255,.9)',
  'choice-radius': '99px',
  'choice-size': '3cqh',
  'choice-width': '38cqw',
  'choices-gap': '2.6cqh',
  'choice-skin': 'none',
  'choice-skin-slice': 'none',
  // an option taken in an earlier run ([choices] chosenStyle = "dim"), a disabled one, the timer bar
  'choice-chosen-bg': 'linear-gradient(180deg,rgba(40,46,74,.6),rgba(24,28,48,.6))',
  'choice-chosen-color': 'rgba(255,255,255,.6)',
  'choice-disabled-bg': 'rgba(30,33,46,.7)',
  'choice-disabled-color': 'rgba(255,255,255,.35)',
  'choice-timer-bg': 'rgba(255,255,255,.15)',
  'choice-timer-color': 'var(--nilvn-accent)',
  // the loading page's progress bar
  'progress-bg': 'rgba(255,255,255,.15)',
  'progress-color': 'var(--nilvn-accent)',
  // declarative panels ([ui.<id>]): a HUD, a window, and the bar widget
  'hud-bg': 'rgba(10,12,22,.62)',
  'hud-border': '1px solid rgba(255,255,255,.14)',
  'hud-color': 'var(--nilvn-panel-color)',
  'hud-radius': '1.2cqh',
  'hud-padding': '1.2cqh 1.6cqw',
  'hud-size': '2.2cqh',
  'window-bg': 'var(--nilvn-panel-bg)',
  'window-border': 'var(--nilvn-panel-border)',
  'window-color': 'var(--nilvn-panel-color)',
  'window-radius': '1.4cqh',
  'window-padding': '2.4cqh 2.4cqw',
  'window-width': '40cqw',
  'bar-bg': 'rgba(255,255,255,.15)',
  'bar-color': 'var(--nilvn-accent)',
  'bar-height': '1.4cqh',
  // panels and buttons (menus, screens, plugin overlays)
  'panel-bg': 'rgba(16,18,28,.96)',
  'panel-border': '1px solid rgba(255,255,255,.16)',
  'panel-color': '#f4f5fa',
  'button-bg': 'rgba(255,255,255,.08)',
  'button-color': '#ffffff',
  'button-border': '1px solid rgba(255,255,255,.18)',
  'button-hover': 'rgba(255,255,255,.16)',
  // the selected state (an active menu mode, the chosen option in a settings row, the current slot page)
  'button-on-bg': 'var(--nilvn-accent)',
  'button-on-color': 'var(--nilvn-button-color)',
  // the [input] box: its dialog (defaults to the panel look; `[input] skin` reskins it) and the text field
  'input-box-bg': 'var(--nilvn-panel-bg)',
  'input-box-border': 'var(--nilvn-panel-border)',
  'input-box-radius': '1.4cqh',
  'input-box-skin': 'none',
  'input-box-skin-slice': 'none',
  'input-bg': 'rgba(255,255,255,.08)',
  'input-color': 'var(--nilvn-panel-color)',
  'input-border': '1px solid rgba(255,255,255,.25)',
  'input-radius': '0.8cqh',
  'input-size': '3cqh',
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
