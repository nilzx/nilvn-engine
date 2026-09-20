// The config file's schema (batch I inc 6): one JSON-Schema-shaped description
// of `nilvn.config.toml`, and the small checker `applyConfig` runs so a
// misspelled section or key, a wrong type or a value off its list is reported
// instead of silently ignored. The object is plain data (a draft-07 subset) so
// tooling can hand it to an editor or a validator; the checker here understands
// exactly the subset the schema uses.

/** A JSON-Schema (draft-07) subset: `type`, `properties`, `additionalProperties`,
 *  `items`, `enum`, `anyOf`, `required`, `description`. */
export interface ConfigSchema {
  type?: string | string[]
  properties?: Record<string, ConfigSchema>
  /** `false` = no keys beyond `properties`; a schema = every other key matches it. */
  additionalProperties?: boolean | ConfigSchema
  items?: ConfigSchema
  enum?: readonly unknown[]
  anyOf?: ConfigSchema[]
  required?: readonly string[]
  description?: string
}

export interface ConfigProblem {
  /** Dotted path from the root (`choices.layout`, `ui.status.widgets[1].type`). */
  path: string
  message: string
}

const str: ConfigSchema = { type: 'string' }
const num: ConfigSchema = { type: 'number' }
const bool: ConfigSchema = { type: 'boolean' }
const len: ConfigSchema = { type: ['string', 'number'] }
const strList: ConfigSchema = { type: 'array', items: str }
const anyValue: ConfigSchema = {}
const table = (values: ConfigSchema): ConfigSchema => ({ type: 'object', additionalProperties: values })
const obj = (properties: Record<string, ConfigSchema>, additionalProperties: boolean | ConfigSchema = false): ConfigSchema => ({ type: 'object', properties, additionalProperties })
const oneOf = (...values: readonly string[]): ConfigSchema => ({ type: 'string', enum: values })
const skinKeys = { skin: str, slice: len, sliceWidth: len, background: str, border: str, radius: len }
const widget = (type: string, props: Record<string, ConfigSchema>): ConfigSchema => obj({ type: oneOf(type), if: str, ...props })

/** `nilvn.config.toml`, section by section. */
export const CONFIG_SCHEMA: ConfigSchema = obj({
  game: obj({ title: str, textSpeed: num, entry: str, scripts: strList, defaultLang: str }),
  plugins: obj({ use: strList }, { type: 'object' }),
  path: table(str),
  actors: table(
    obj(
      {
        name: str,
        nameKey: str,
        color: str,
        textColor: str,
        sprites: str,
        face: str,
        defaultFace: str,
        canvas: { type: 'array', items: num },
        layers: table(obj({ src: str, default: str, offset: { type: 'array', items: num }, optional: bool })),
        ext: { type: 'object' },
      },
      // a plugin's actor field ([actors.x] voice = 360) rides along
      true,
    ),
  ),
  defaults: table({ type: 'object' }),
  macros: table(str),
  theme: table(len),
  window: obj({
    ...skinKeys,
    opacity: num,
    position: oneOf('bottom', 'top'),
    overflow: oneOf('grow', 'page', 'shrink'),
    offset: len,
    inset: len,
    height: len,
    padding: str,
    font: str,
    textSize: len,
    textColor: str,
    lineHeight: len,
    textShadow: str,
    nameBackground: str,
    nameColor: str,
    nameSize: len,
    indicatorColor: str,
  }),
  title: obj({ enabled: bool, heading: str, subtitle: str, logo: str, logoWidth: len, background: str, bgm: str, bgmVolume: num, buttons: strList, layout: oneOf('center', 'left', 'right', 'bottom'), version: bool }),
  ending: table(obj({ enabled: bool, heading: str, subtitle: str, background: str, bgm: str, bgmVolume: num, credits: { type: ['string', 'array'], items: str }, creditsDuration: num, after: oneOf('title', 'restart', 'none'), buttons: bool })),
  saves: obj({ autosave: { type: ['string', 'boolean'], enum: ['label', 'line', false] }, pages: num, slotsPerPage: num, thumbnail: oneOf('bg', 'none') }),
  menu: obj({ enabled: bool, entry: oneOf('top-right', 'top-left', 'bottom-right', 'bottom-left', 'hidden'), items: strList, wheelBacklog: bool }),
  settings: obj({ autoDelay: num, skipMode: oneOf('read', 'all'), show: strList, textSpeedRange: { type: 'array', items: num } }),
  keys: obj(
    Object.fromEntries(['advance', 'menu', 'skipHold', 'skip', 'auto', 'quicksave', 'quickload', 'backlog', 'save', 'load', 'settings', 'fullscreen'].map((k) => [k, { type: ['string', 'array', 'boolean'], items: str }])),
  ),
  persist: table(anyValue),
  input: obj({ ...skinKeys, fieldBackground: str, fieldColor: str, fieldBorder: str, fieldRadius: len, fieldSize: len, position: oneOf('center', 'top', 'bottom'), ok: str, cancel: str }),
  choices: obj({
    position: oneOf('center', 'top', 'bottom', 'left', 'right'),
    layout: oneOf('column', 'grid'),
    columns: num,
    gap: len,
    width: len,
    ...skinKeys,
    color: str,
    size: len,
    hover: str,
    chosenStyle: oneOf('none', 'dim'),
    chosenBackground: str,
    chosenColor: str,
    disabledBackground: str,
    disabledColor: str,
    timer: num,
    timerDefault: num,
    timerBackground: str,
    timerColor: str,
  }),
  preload: obj({ assets: strList, auto: bool, concurrency: num, screen: bool, heading: str, background: str }),
  ui: table(
    obj({
      kind: oneOf('hud', 'window'),
      anchor: oneOf('top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'),
      show: oneOf('playing', 'always', 'manual'),
      title: str,
      width: len,
      height: len,
      widgets: {
        type: 'array',
        items: {
          anyOf: [
            widget('text', { text: str, var: str }),
            widget('bar', { var: str, max: len, min: len, label: str }),
            widget('image', { src: str, width: len }),
            widget('list', { var: str, empty: str }),
            widget('button', { label: str, onclick: str }),
          ],
        },
      },
    }),
  ),
  strings: table(table(str)),
})

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** Every place `cfg` strays from the schema: an unknown section or key, a
 *  value of the wrong type, a value off its list. `skip` names top-level
 *  sections checked elsewhere (`applyConfig` leaves `window` / `input` /
 *  `choices` to their token mappers, which also judge value combinations). */
export function checkConfig(cfg: unknown, opts: { skip?: readonly string[]; schema?: ConfigSchema } = {}): ConfigProblem[] {
  const out: ConfigProblem[] = []
  const skip = new Set(opts.skip ?? [])
  const walk = (value: unknown, schema: ConfigSchema, path: string): void => {
    if (schema.anyOf) {
      const attempts = schema.anyOf.map((alt) => {
        const sub: ConfigProblem[] = []
        walkInto(value, alt, path, sub)
        return sub
      })
      if (attempts.some((a) => a.length === 0)) return
      // No alternative fits: report the one that got furthest (fewest problems).
      const best = attempts.reduce((a, b) => (b.length < a.length ? b : a))
      out.push(...best)
      return
    }
    walkInto(value, schema, path, out)
  }
  const walkInto = (value: unknown, schema: ConfigSchema, path: string, into: ConfigProblem[]): void => {
    if (schema.type !== undefined) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
      const t = typeOf(value)
      if (!allowed.includes(t) && !(t === 'number' && allowed.includes('integer'))) {
        into.push({ path, message: `expected ${allowed.join(' or ')}, got ${t}` })
        return
      }
    }
    if (schema.enum && !schema.enum.includes(value)) {
      into.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` })
      return
    }
    if (Array.isArray(value) && schema.items) {
      const inner: ConfigProblem[] = []
      value.forEach((v, i) => {
        const before = into.length
        const sub = { ...schema.items! }
        if (sub.anyOf) {
          const saved = out.length
          walk(v, sub, `${path}[${i}]`)
          // route the anyOf outcome into `into` when it is not `out`
          if (into !== out) {
            inner.push(...out.splice(saved))
          }
        } else walkInto(v, sub, `${path}[${i}]`, into)
        void before
      })
      into.push(...inner)
      return
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && (schema.properties || schema.additionalProperties !== undefined)) {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const p = path ? `${path}.${key}` : key
        if (!path && skip.has(key)) continue
        const prop = schema.properties?.[key]
        if (prop) {
          walkInto(v, prop, p, into)
          continue
        }
        const extra = schema.additionalProperties
        if (extra === false || extra === undefined) into.push({ path: p, message: 'unknown key' })
        else if (extra !== true) walkInto(v, extra, p, into)
      }
      for (const r of schema.required ?? []) if (!(r in (value as object))) into.push({ path: path ? `${path}.${r}` : r, message: 'missing' })
    }
  }
  walk(cfg, opts.schema ?? CONFIG_SCHEMA, '')
  return out
}
