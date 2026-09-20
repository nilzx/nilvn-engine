// Keyboard bindings for the finished game's shell (`[keys]` in the config /
// `createEngine({ keys })`): the binding format, the defaults, and the matcher
// the engine's key handler runs. A binding names a `KeyboardEvent.key`
// (`a`, `F5`, `Escape`, `Space`, `Enter`, `Tab`, `Control`), optionally with
// `Ctrl+` / `Shift+` / `Alt+` / `Meta+` in front (`Ctrl+S`); several keys as an
// array; `false` unbinds. Key names compare case-insensitively.
import type { KeyAction, KeyBinding, KeysConfig } from './types.js'

/** The engine's default bindings; an action missing here is unbound. */
export const KEYS_DEFAULT: Readonly<KeysConfig> = Object.freeze({
  advance: ['Space', 'Enter'],
  menu: 'Escape',
  skipHold: 'Control',
  skip: 'Tab',
  auto: 'a',
  quicksave: 'F5',
  quickload: 'F9',
})

const KEY_ALIASES: Record<string, string> = {
  space: ' ',
  spacebar: ' ',
  esc: 'escape',
  ctrl: 'control',
  return: 'enter',
  del: 'delete',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  option: 'alt',
}
const MODIFIERS = new Set(['control', 'shift', 'alt', 'meta'])

interface ParsedKey {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

function parseOne(spec: string): ParsedKey | null {
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return null
  const out: ParsedKey = { key: '', ctrl: false, shift: false, alt: false, meta: false }
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!.toLowerCase()
    const name = KEY_ALIASES[raw] ?? raw
    const last = i === parts.length - 1
    if (!last && MODIFIERS.has(name)) {
      if (name === 'control') out.ctrl = true
      else if (name === 'shift') out.shift = true
      else if (name === 'alt') out.alt = true
      else out.meta = true
    } else if (last) out.key = name
    else return null
  }
  return out.key ? out : null
}

/** Normalize a binding to its parsed keys (an unbound / invalid binding → []). */
export function parseBinding(binding: KeyBinding | undefined): ParsedKey[] {
  if (!binding) return []
  const specs = Array.isArray(binding) ? binding : [binding]
  return specs.map(parseOne).filter((k): k is ParsedKey => k !== null)
}

/** Does this key event hit the binding? Modifiers named in the binding must be
 *  held; Ctrl / Alt / Meta not named must not be (Shift is only checked when
 *  named, so `a` also fires on a shifted `A`). A modifier bound as the key
 *  itself (`skipHold = "Control"`) ignores its own state. */
export function matchKey(binding: KeyBinding | undefined, ev: KeyboardEvent): boolean {
  const key = (KEY_ALIASES[ev.key.toLowerCase()] ?? ev.key.toLowerCase()) || ''
  for (const k of parseBinding(binding)) {
    if (k.key !== key) continue
    const selfCtrl = key === 'control'
    const selfAlt = key === 'alt'
    const selfMeta = key === 'meta'
    if (!selfCtrl && ev.ctrlKey !== k.ctrl) continue
    if (!selfAlt && ev.altKey !== k.alt) continue
    if (!selfMeta && ev.metaKey !== k.meta) continue
    if (k.shift && !ev.shiftKey) continue
    return true
  }
  return false
}

/** The effective binding for an action: the config's when set (`false` unbinds),
 *  else the default. */
export function bindingOf(cfg: KeysConfig, action: KeyAction): KeyBinding | undefined {
  return action in cfg ? cfg[action] : KEYS_DEFAULT[action]
}

/** Key events from a focused text field belong to that field, not the game. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
