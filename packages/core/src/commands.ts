import type { CommandSchema } from './schema.js'

// Schemas for the engine's built-in CommandNode commands, grounded in
// packages/engine/src/builtins.ts. These drive the editor's command palette and forms.
//
// Excluded on purpose:
//  - use / alias / actor  -> project setup (Project.plugins / alias / actors), not nodes
//  - jump / if / set      -> first-class node kinds (JumpNode / JumpNode+condition / SetNode)
export const BUILTIN_COMMANDS: CommandSchema[] = [
  {
    name: 'bg',
    label: 'cmd.bg.label',
    category: 'stage',
    icon: '🖼',
    hint: 'cmd.bg.hint',
    params: [
      { key: 'bg', label: 'cmd.bg.bg', type: 'asset:bg', positional: 0 },
      { key: 'color', label: 'cmd.bg.color', type: 'color' },
      { key: 'fade', label: 'cmd.bg.fade', type: 'number', default: 0 },
    ],
  },
  {
    name: 'char',
    label: 'cmd.char.label',
    category: 'stage',
    icon: '🧍',
    hint: 'cmd.char.hint',
    params: [
      { key: 'id', label: 'cmd.char.id', type: 'actor', required: true, positional: 0 },
      { key: 'face', label: 'cmd.char.face', type: 'face', positional: 1 },
      {
        key: 'at',
        label: 'cmd.char.at',
        type: 'enum',
        options: [
          { value: 'left', label: 'cmd.char.at.left' },
          { value: 'center', label: 'cmd.char.at.center' },
          { value: 'right', label: 'cmd.char.at.right' },
        ],
      },
      // Birth transform — written by the stage drag / scale / rotate handles (4c-4).
      // NO schema default: these channels carry forward (an absent param means "keep
      // the previous value", not "identity"), so the serializer must never drop an
      // explicit identity that overrides an inherited non-identity value.
      { key: 'y', label: 'cmd.char.y', type: 'number', advanced: true },
      { key: 'scale', label: 'cmd.char.scale', type: 'number', advanced: true },
      { key: 'rotation', label: 'cmd.char.rotation', type: 'number', advanced: true },
      { key: 'fade', label: 'cmd.char.fade', type: 'number', default: 0.3 },
      { key: 'src', label: 'cmd.char.src', type: 'string', advanced: true },
    ],
  },
  {
    name: 'hide',
    label: 'cmd.hide.label',
    category: 'stage',
    icon: '🚪',
    params: [
      { key: 'id', label: 'cmd.hide.id', type: 'actor', required: true, positional: 0 },
      { key: 'fade', label: 'cmd.hide.fade', type: 'number', default: 0.3 },
    ],
  },
  {
    name: 'clear',
    label: 'cmd.clear.label',
    category: 'stage',
    icon: '🧹',
    hint: 'cmd.clear.hint',
    params: [{ key: 'fade', label: 'cmd.clear.fade', type: 'number', default: 0.3 }],
  },
  {
    name: 'wait',
    label: 'cmd.wait.label',
    category: 'flow',
    icon: '⏱',
    hint: 'cmd.wait.hint',
    params: [{ key: 'sec', label: 'cmd.wait.sec', type: 'number', required: true, default: 0.5, positional: 0 }],
  },
  {
    name: 'fadeout',
    label: 'cmd.fadeout.label',
    category: 'fx',
    icon: '🌑',
    params: [
      { key: 'sec', label: 'cmd.fadeout.sec', type: 'number', default: 0.6, positional: 0 },
      { key: 'color', label: 'cmd.fadeout.color', type: 'color', default: '#000' },
    ],
  },
  {
    name: 'fadein',
    label: 'cmd.fadein.label',
    category: 'fx',
    icon: '🌗',
    params: [{ key: 'sec', label: 'cmd.fadein.sec', type: 'number', default: 0.6, positional: 0 }],
  },
  {
    name: 'dialog',
    label: 'cmd.dialog.label',
    category: 'stage',
    icon: '💬',
    hint: 'cmd.dialog.hint',
    params: [
      {
        key: 'mode',
        label: 'cmd.dialog.mode',
        type: 'enum',
        default: 'show',
        positional: 0,
        options: [
          { value: 'show', label: 'cmd.dialog.mode.show' },
          { value: 'hide', label: 'cmd.dialog.mode.hide' },
        ],
      },
    ],
  },
  {
    name: 'window',
    label: 'cmd.window.label',
    category: 'stage',
    icon: '🪟',
    hint: 'cmd.window.hint',
    params: [
      // The skin picker reuses the background asset pool (a window texture is a
      // flat image like a bg); type `skin=none` by hand to restore the default.
      { key: 'skin', label: 'cmd.window.skin', type: 'asset:bg', required: true, positional: 0 },
      { key: 'target', label: 'cmd.window.target', type: 'string', default: 'dialog', advanced: true },
    ],
  },
  {
    name: 'theme',
    label: 'cmd.theme.label',
    category: 'stage',
    icon: '🎨',
    hint: 'cmd.theme.hint',
    // The engine accepts ANY token the theme contract names (`--nilvn-<token>`);
    // the form offers the everyday ones. `[theme reset]` clears the script layer.
    params: [
      { key: 'dialog-bg', label: 'cmd.theme.dialogBg', type: 'string' },
      { key: 'dialog-opacity', label: 'cmd.theme.dialogOpacity', type: 'number' },
      { key: 'text-color', label: 'cmd.theme.textColor', type: 'string' },
      { key: 'text-size', label: 'cmd.theme.textSize', type: 'string', advanced: true },
      { key: 'name-bg', label: 'cmd.theme.nameBg', type: 'string', advanced: true },
      { key: 'name-color', label: 'cmd.theme.nameColor', type: 'string', advanced: true },
      { key: 'font', label: 'cmd.theme.font', type: 'string', advanced: true },
      { key: 'accent', label: 'cmd.theme.accent', type: 'string', advanced: true },
      { key: 'ui-scale', label: 'cmd.theme.uiScale', type: 'number', advanced: true },
    ],
  },
  {
    name: 'textspeed',
    label: 'cmd.textspeed.label',
    category: 'text',
    icon: '⏩',
    hint: 'cmd.textspeed.hint',
    params: [{ key: 'cps', label: 'cmd.textspeed.cps', type: 'number', default: 40, positional: 0 }],
  },
  {
    name: 'bgm',
    label: 'cmd.bgm.label',
    category: 'audio',
    icon: '🎵',
    params: [
      { key: 'bgm', label: 'cmd.bgm.bgm', type: 'asset:bgm', required: true, positional: 0 },
      { key: 'loop', label: 'cmd.bgm.loop', type: 'boolean', default: true },
      { key: 'volume', label: 'cmd.bgm.volume', type: 'number', default: 1 },
      // Multi-track: 'music' = the classic BGM slot; any other name is an
      // ambience bed layered alongside (its own loop channel + master volume).
      { key: 'track', label: 'cmd.bgm.track', type: 'string', default: 'music', advanced: true },
      { key: 'fade', label: 'cmd.bgm.fade', type: 'number', default: 0, advanced: true },
    ],
  },
  {
    name: 'stopbgm',
    label: 'cmd.stopbgm.label',
    category: 'audio',
    icon: '🔇',
    params: [
      { key: 'fade', label: 'cmd.stopbgm.fade', type: 'number', default: 0 },
      { key: 'track', label: 'cmd.stopbgm.track', type: 'string', default: 'music', advanced: true },
    ],
  },
  {
    name: 'se',
    label: 'cmd.se.label',
    category: 'audio',
    icon: '🔔',
    params: [
      { key: 'se', label: 'cmd.se.se', type: 'asset:se', required: true, positional: 0 },
      { key: 'volume', label: 'cmd.se.volume', type: 'number', default: 1 },
    ],
  },
  {
    name: 'end',
    label: 'cmd.end.label',
    category: 'flow',
    icon: '🏁',
    hint: 'cmd.end.hint',
    params: [{ key: 'sec', label: 'cmd.end.sec', type: 'number', default: 1, positional: 0 }],
  },
  {
    name: 'ending',
    label: 'cmd.ending.label',
    category: 'flow',
    icon: '🎬',
    hint: 'cmd.ending.hint',
    params: [
      { key: 'id', label: 'cmd.ending.id', type: 'string', default: 'default', positional: 0 },
      { key: 'sec', label: 'cmd.ending.sec', type: 'number', default: 1, advanced: true },
    ],
  },
  {
    name: 'title',
    label: 'cmd.title.label',
    category: 'flow',
    icon: '🏠',
    hint: 'cmd.title.hint',
    params: [],
  },
]

export const BUILTIN_COMMAND_MAP: Record<string, CommandSchema> = Object.fromEntries(
  BUILTIN_COMMANDS.map((c) => [c.name, c]),
)

export function getCommandSchema(name: string): CommandSchema | undefined {
  return BUILTIN_COMMAND_MAP[name]
}
