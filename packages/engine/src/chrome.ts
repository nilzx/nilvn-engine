// The built-in screens' MODELS (batch G inc 3): what a title page and an
// ending page show, built from the work's config + chrome strings + the
// session's facts, handed to `Renderer.chrome.showScreen`. Pure: the renderer
// draws, the engine supplies the actions. Keeping the model renderer-agnostic
// is what lets a non-DOM backend draw its own screens later.
import type { ScreenModel, ScreenButton } from './renderer/types.js'
import type { TitleConfig, EndingConfig } from './types.js'

/** What the model builders need from the engine. */
export interface ChromeHost {
  /** A chrome string by id (`ui.title.new` …), in the work's language. */
  t(id: string): string
  /** A config string: `@key` resolves through the content catalogs, anything
   *  else is literal. */
  text(s: string | undefined): string | undefined
  /** A resource path → URL (aliases, the asset table, the base URL). */
  resolve(path: string): string
  /** The work's title (`[game] title`), the default heading. */
  workTitle: string | undefined
  /** The tool version label, shown on the title page unless configured off. */
  buildInfo: string | undefined
  /** Whether an autosave exists (the Continue button). */
  hasContinue: boolean
  /** Buttons plugins contributed (`titleItems`), appended after the configured ones. */
  extraButtons?: ScreenButton[]
  /** A button for an id the model does not know (`ui:<panel>`), or undefined. */
  customButton?(id: string): ScreenButton | undefined
  actions: {
    newGame(): void
    continueGame(): void
    toTitle(): void
    restart(): void
    /** Screens a later increment / a plugin provides; absent = button omitted. */
    open?(screen: string): void
  }
}

/** Default title buttons (ids). `load` / `settings` join once those screens exist. */
export const TITLE_BUTTONS_DEFAULT: readonly string[] = ['new', 'continue']

/** A `[title] background` / `[ending.x] background` value → a CSS background:
 *  a colour / gradient literal stays as is, anything else is an image path. */
export function screenBackground(value: string | undefined, resolve: (p: string) => string): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^(#|rgb|hsl|linear-gradient|radial-gradient|transparent$|none$)/i.test(v)) return v
  return `url("${resolve(v)}")`
}

export function titleModel(cfg: TitleConfig, host: ChromeHost): { model: ScreenModel; unknownButtons: string[] } {
  const unknownButtons: string[] = []
  const buttons: ScreenButton[] = []
  for (const id of cfg.buttons ?? TITLE_BUTTONS_DEFAULT) {
    switch (id) {
      case 'new':
        buttons.push({ id, label: host.t('ui.title.new'), primary: true, onSelect: () => host.actions.newGame() })
        break
      case 'continue':
        if (host.hasContinue) buttons.push({ id, label: host.t('ui.title.continue'), onSelect: () => host.actions.continueGame() })
        break
      case 'load':
      case 'settings':
        if (host.actions.open) {
          const open = host.actions.open
          buttons.push({ id, label: host.t(`ui.title.${id}`), onSelect: () => open(id === 'load' ? 'saves' : 'settings') })
        }
        break
      default: {
        const custom = host.customButton?.(id)
        if (custom) buttons.push(custom)
        else unknownButtons.push(id)
      }
    }
  }
  for (const b of host.extraButtons ?? []) buttons.push(b)
  const model: ScreenModel = {
    heading: host.text(cfg.heading) ?? host.workTitle,
    subtitle: host.text(cfg.subtitle),
    logo: cfg.logo ? host.resolve(cfg.logo) : undefined,
    logoWidth: typeof cfg.logoWidth === 'number' ? `${cfg.logoWidth}px` : cfg.logoWidth,
    background: screenBackground(cfg.background, host.resolve),
    layout: cfg.layout ?? 'center',
    buttons,
    version: cfg.version === false ? undefined : host.buildInfo,
  }
  return { model, unknownButtons }
}

export function endingModel(id: string, cfg: EndingConfig | undefined, host: ChromeHost): ScreenModel {
  const c = cfg ?? {}
  const creditsRaw = c.credits === undefined ? [] : Array.isArray(c.credits) ? c.credits : c.credits.split('\n')
  const credits = creditsRaw.map((line) => host.text(line) ?? line)
  const buttons: ScreenButton[] = []
  if (c.buttons !== false) {
    buttons.push({ id: 'title', label: host.t('ui.ending.toTitle'), primary: true, onSelect: () => host.actions.toTitle() })
    buttons.push({ id: 'restart', label: host.t('ui.ending.restart'), onSelect: () => host.actions.restart() })
  }
  const after = c.after ?? 'none'
  return {
    heading: host.text(c.heading) ?? host.t('ui.ending.title'),
    subtitle: host.text(c.subtitle),
    background: screenBackground(c.background, host.resolve),
    layout: 'center',
    buttons,
    credits: credits.length ? credits : undefined,
    creditsDuration: c.creditsDuration ?? (credits.length ? Math.max(6, credits.length * 1.6) : undefined),
    onCreditsEnd: after === 'title' ? () => host.actions.toTitle() : after === 'restart' ? () => host.actions.restart() : undefined,
    endingId: id,
  }
}
