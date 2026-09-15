// The generated plugin-spec — the plugin platform's "single exported contract":
// everything a plugin author (human or AI) must know that is OWNED BY CODE, gathered from its live
// sources in @nilvn/core and emitted as one versioned JSON (`plugin-spec.json`
// at this package's root, shipped with it). Prose-side contracts (this package's
// README, the engine docs) are referenced by path, not duplicated. `pnpm spec:check` regenerates and
// byte-compares the artifact (and the package template derived from the example),
// so neither can drift from the code.

import {
  CURRENT_SCHEMA_VERSION,
  EXTENSION_POINTS,
  FIRST_PARTY_ID_PREFIX,
  PERMISSIONS,
  PLUGIN_API_VERSION,
  PLUGIN_ID_RE,
  PLUGIN_MANIFEST_FILE,
  type ExtensionPointDef,
  type PermissionDef,
  type PluginManifest,
} from '@nilvn/core'

/** Version of the generated-spec FORMAT (bump on breaking shape changes).
 *  v2: the `bundled` inventory left with the first-party plugins (@nilvn/plugins
 *  ships its own catalog); `firstParty` describes the namespace convention only. */
export const PLUGIN_SPEC_VERSION = 2

export interface FieldDoc {
  name: string
  type: string
  desc: string
  required?: boolean
}

export interface PluginSpecJson {
  specVersion: number
  pluginApiVersion: number
  irSchemaVersion: number
  generatedBy: string
  references: Record<string, string>
  manifest: {
    file: string
    idPattern: string
    fields: FieldDoc[]
    contributes: FieldDoc[]
  }
  extensionPoints: ExtensionPointDef[]
  permissions: PermissionDef[]
  runtime: {
    module: FieldDoc[]
    context: FieldDoc[]
    commandContext: FieldDoc[]
    capabilities: Record<string, string[]>
    lifecycle: string[]
    proxyRules: string[]
  }
  editor: {
    module: FieldDoc[]
    context: FieldDoc[]
  }
  firstParty: {
    /** The reserved id namespace (`app.nilvn.`): a plugin under it also answers
     *  to its short name (`[use textfx]`). Third-party ids use their own domain. */
    idPrefix: string
    /** Where the first-party plugins live (manifests, runtime modules, catalog). */
    package: string
    repository: string
  }
  example: {
    manifest: PluginManifest
    engineModule: string
    use: string[]
  }
}

const F = (name: string, type: string, desc: string, required = false): FieldDoc => ({ name, type, desc, required })

const MANIFEST_FIELDS: FieldDoc[] = [
  F('id', 'string', 'Stable reverse-DNS id (app.nilvn.textfx). The enabled-set / [use] / i18n-namespace key.', true),
  F('name', 'string', 'Display name as an i18n id resolved through `messages` (plugin.<slug>.name).', true),
  F('description', 'string', 'An i18n id (plugin.<slug>.desc).'),
  F('version', 'string', "The plugin's own SemVer (x.y.z).", true),
  F('engine', 'string', 'Engine compatibility range — subset: `*`, `1.2.3`, `^1.2`, `~1.2.3`, `>=0.14 <1`, `a || b`. Absent = any.'),
  F('editor', 'string', 'Editor compatibility range (same subset).'),
  F('dependencies', 'Record<id, range>', 'Other plugins this one needs; activated first. Missing / incompatible / cyclic → the plugin is blocked with a diagnostic.'),
  F('contributes', 'PluginContributions', 'Contributions per extension point (see `extensionPoints`). Unknown keys are ignored with a warning.'),
  F('permissions', 'Permission[]', 'Capabilities requested from the `permissions` catalog. Only these (as granted by the host) become context objects.'),
  F('activation', '{ engine?: eager|onCommand|manual; editor?: eager|onPanelOpen }', 'When the runtime half activates: on enable (default), at its first command, or only through enablePlugin / setPlugins.'),
  F('reload', 'hot | restart', 'Hot-plug policy (default hot). `restart` = the host must reload the editor after a toggle.'),
  F('entries', '{ engine?: string; editor?: string }', 'Module entries relative to plugin.json. No engine entry = a pure editor plugin; no editor entry = runtime only.'),
  F('styles', 'string[]', 'Stylesheets relative to plugin.json, injected while active and removed on deactivate.'),
  F('messages', '{ [lang]: { [id]: text } }', 'The plugin’s own UI-chrome strings; `ctx.t(id)` resolves them in the work language.'),
  F('authorUsage', 'string[]', 'Author-facing usage lines (how to trigger the plugin in an AuthoringDoc); tools prefer these over deriving from contributes.'),
  F('apiVersion', 'number', `Plugin contract version this manifest targets (current: ${PLUGIN_API_VERSION}); a newer one is rejected.`),
]

const CONTRIBUTES_FIELDS: FieldDoc[] = [
  F('commands', 'CommandSchema[]', 'Script commands `[name …]` with typed params (drives the editor insert form and the authoring lint).'),
  F('textEffects', '{ name, label? }[]', 'Inline text effects `{name:text}`.'),
  F('objectKinds', 'ObjectKindSchema[]', 'Addressable stage-object kinds the plugin adds.'),
  F('effects', 'EffectSchema[]', 'Retargetable effects bound to kinds via appliesToKinds.'),
  F('hooks', 'string[]', 'Engine hook names the runtime half listens to (introspection).'),
  F('saveSlice', 'boolean', 'The plugin owns a SaveState.ext[id] slice (needs the save.slice permission).'),
  F('panels', '{ id, label, kind? }[]', 'Editor manager panels the host renders a tab + container for.'),
  F('nodeKinds', 'string[]', 'IR node kinds the editor half owns (forms + inert flag while disabled).'),
  F('stageTools', 'string[]', 'Stage overlay tool ids.'),
  F('lineActions', 'string[]', 'Dialogue-line action bar button ids.'),
  F('objectMenu', 'string[]', 'On-stage object context-menu section ids.'),
]

const RUNTIME_MODULE: FieldDoc[] = [
  F('id', 'string', 'Must equal the manifest id.', true),
  F('permissions', 'Permission[]', 'Authoritative only without a manifest; must match the manifest’s engine-side permissions when one exists.'),
  F('version / dependencies / activation / reload', '…', 'Inline fallbacks for module-only plugins ([use ./x.js]); a manifest wins.'),
  F('styles', 'string', 'CSS injected while active.'),
  F('commands', 'Record<name, (ctx: CommandContext) => void | Promise<void>>', 'Script commands.'),
  F('textEffects', 'Record<name, (span: TextSpan, index, ctx: PluginContext) => void>', 'Inline text effects; `span.addClass` is the only verb.'),
  F('objectKinds', 'ObjectKindDecl[]', 'Runtime kind contracts: `transformable` + `recordable` channels — standard channel NAMES (x / y / scale / rotation / opacity / visible / face / band) or custom RecordableProp descriptors.'),
  F('effects', 'Record<name, { appliesToKinds, apply(handle, params, ctx) }>', 'Effects run with the OWNER plugin’s context.'),
  F('hooks', 'EngineHooks', 'onDialogue / onDialogueDone / onReveal / onChoices / onChoose / onCommand / onEnd / onError — each receives the plugin context last.'),
  F('activate(ctx)', 'void | Promise<void>', 'Once per activation. Register listeners / timers / layers through ctx so they are released on deactivate. A throw isolates the plugin.'),
  F('deactivate(ctx)', 'void', 'Before the host disposes everything registered through ctx.'),
  F('saveState(ctx) / restoreState(ctx, data)', '…', 'The SaveState.ext[id] slice (needs save.slice).'),
]

const RUNTIME_CONTEXT: FieldDoc[] = [
  F('id / permissions / lang / actors', 'readonly', 'Identity, granted permissions, the work language, the actor table.'),
  F('resolve(path)', 'string', 'Resource path → URL (aliases / by-ref assets / base URL).'),
  F('t(id, params?)', 'string', 'The plugin’s own `messages`, then the engine chrome catalog, in the work language.'),
  F('report(message, error?)', 'void', 'A `plugin` diagnostic attributed to this plugin (never throw over content).'),
  F('listen(target, type, fn, opts?)', '() => void', 'Event listener removed on dispose.'),
  F('onDispose(fn)', 'void', 'Run on deactivate.'),
  F('registerCommand / registerTextEffect / registerEffect / registerKind / on(hook, fn) / addStyle(css)', '…', 'Dynamic registration; all disposable.'),
  F('stage', 'StageCap?', 'stage.read: hasObject / getProp / getBand / getFace / hasChar / charFace / snapshot. stage.write adds every Renderer write verb + applyEffect / showActor / playFrames / stopFrames / startLoop / stopLoop / runningLoops (write verbs are reporting stubs under stage.read only). playFrames / startLoop / stopLoop accept the keyframe WIRE forms (`obj#t:ch=v;…|…`, `t:ch=v;…`, `ch=v,…`) as well as decoded tracks — the engine owns the codec.'),
  F('audio', 'AudioCap?', 'audio.play: playTrack / stopTrack / stopAllTracks / playSe / volume(channel) / voicePlaying.'),
  F('vars', 'VarsCap?', 'vars.read: get / has / all; vars.write adds set (a stub without it).'),
  F('saves', 'SavesCap?', 'session.save: saveState / restoreState / restart / saveKey / buildInfo.'),
  F('settings', 'SettingsCap?', 'session.settings: textSpeed, getVolume / setVolume, lang / languages / languageName / setLanguage / onLanguageChange, resolveText.'),
  F('backlog', 'BacklogCap?', 'session.backlog: entries / replayVoice.'),
  F('replay', 'ReplayCap?', 'session.replay: list / isReplaying / play / end / fireSeen / onSeen / onEnd.'),
  F('ui', 'UiCap?', 'ui.layer: layer(className) → a host container in the stage root; onStage(type, fn) for stage input. Both released on dispose.'),
  F('timer', 'TimerCap?', 'timer: setTimeout / setInterval / requestAnimationFrame and their clears; all cleared on dispose.'),
]

const COMMAND_CONTEXT: FieldDoc[] = [
  F('name / args / params / raw', '…', 'The parsed tag.'),
  F('str(keyOrIndex, def?) / num(keyOrIndex, def?) / numOpt(keyOrIndex)', '…', 'Argument accessors (positional index or named key); numOpt yields undefined for an absent / non-numeric param instead of a default.'),
  F('resolve(path) / wait(sec)', '…', 'Path resolution and a delay.'),
  F('plugin', 'PluginContext', 'The owning plugin’s capability context — the ONLY way to the stage / audio / vars.'),
]

const CAPABILITIES: Record<string, string[]> = {
  'stage.read': ['hasObject', 'getProp', 'getBand', 'getFace', 'hasChar', 'charFace', 'snapshot'],
  'stage.write': ['setBackground', 'showChar', 'moveChar', 'hideChar', 'clearChars', 'focusChar', 'showSprite', 'hideSprite', 'clearSprites', 'setProp', 'animate', 'setBand', 'setFace', 'setName', 'showDialog', 'showIndicator', 'setWindowSkin', 'fadeScreen', 'transitionScreen', 'flash', 'applyEffect', 'showActor', 'playFrames', 'stopFrames', 'startLoop', 'stopLoop', 'runningLoops'],
  'audio.play': ['playTrack', 'stopTrack', 'stopAllTracks', 'playSe', 'volume', 'voicePlaying'],
  'vars.read': ['get', 'has', 'all'],
  'vars.write': ['set'],
  'save.slice': ['saveState', 'restoreState (module methods are called)'],
  'session.save': ['saveState', 'restoreState', 'restart', 'saveKey', 'buildInfo'],
  'session.settings': ['textSpeed', 'getVolume', 'setVolume', 'lang', 'languages', 'languageName', 'setLanguage', 'onLanguageChange', 'resolveText'],
  'session.backlog': ['entries', 'replayVoice'],
  'session.replay': ['list', 'isReplaying', 'play', 'end', 'fireSeen', 'onSeen', 'onEnd'],
  'ui.layer': ['layer', 'onStage'],
  timer: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
  'project.read': ['state (editor)'],
  'project.commit': ['commit', 'run (editor)'],
  'assets.read': ['assets (editor)'],
  'assets.write': ['assets imports (editor)'],
  'ui.panel': ['refresh (editor)'],
  'ui.window': ['refresh (editor)'],
  'ui.toast': ['toast', 'refresh (editor)'],
}

const LIFECYCLE = [
  'register(manifest / module) → validate (id grammar · apiVersion · engine range · dependencies · permission catalog) → activate(ctx) → running → deactivate(ctx) → dispose',
  'Every contribution and resource registered through ctx is released on deactivate; a plugin must not hold globals.',
  'activate() may be async; a rejection or throw isolates the plugin (its commands become no-ops, one diagnostic).',
  'N consecutive command failures (default 3) isolate the plugin; one success resets the count.',
  'reload = saveState slice → deactivate → (re-import cache-busted for path plugins) → activate → restoreState; any failure rolls back to the previous module.',
  'activation.engine: eager (default) | onCommand (first execution of one of its commands) | manual (enablePlugin / setPlugins only).',
  'A running engine (finished game) never hot-swaps its command set; the editor toggles in edit mode and rebuilds the preview per run.',
]

const PROXY_RULES = [
  'Capability methods are async or pure; return values and parameters must be structured-cloneable.',
  'No DOM handles cross the boundary — TextSpan / ChoiceHandle / StageObjectHandle are proxyable handle objects (index / id + methods).',
  'ui.layer hands a same-realm first-party plugin the element; a sandboxed plugin receives a container id instead.',
  'A denied capability is undefined on the context, never an exception; stage write verbs under stage.read only are reporting stubs.',
  'Third-party plugins default-deny net:* and fs.*; those permissions are reserved until the host mediates them.',
]

const EDITOR_MODULE: FieldDoc[] = [
  F('id', 'string', 'Must equal the manifest id.', true),
  F('panels', 'Record<panelId, (ctx: EditorPluginCtx, host, api) => void>', 'Builders for contributes.panels; the host renders the tab + container.'),
  F('nodeKinds', 'Record<kind, { label(), form?() }>', 'Forms for contributes.nodeKinds (deep integration: receives the full editor context).'),
  F('stageTool / objectMenuSection / lineActions', '…', 'Deep integrations for contributes.stageTools / objectMenu / lineActions (full editor context).'),
]

const EDITOR_CONTEXT: FieldDoc[] = [
  F('id / permissions', 'readonly', 'Identity and the granted editor-side permissions.'),
  F('state', 'EditorState?', 'project.read: the open project and selection.'),
  F('commit(name, mutate, opts?) / run(op)', '?', 'project.commit: change the project through the editor command surface (a named undoable transaction, or a registry op with serializable params); nothing else writes.'),
  F('assets', 'AssetStore?', 'assets.read (imports also need assets.write).'),
  F('refresh()', '?', 'Any ui.*: repaint the editor.'),
  F('toast(message, kind?)', '?', 'ui.toast.'),
]

const EXAMPLE_MANIFEST: PluginManifest = {
  id: 'com.example.neon',
  name: 'plugin.neon.name',
  description: 'plugin.neon.desc',
  version: '1.0.0',
  engine: '>=0.14 <1',
  entries: { engine: './engine.js' },
  permissions: ['stage.write'],
  contributes: {
    textEffects: [{ name: 'neon', label: 'plugin.neon.te.neon.label' }],
    commands: [
      {
        name: 'boom',
        label: 'plugin.neon.cmd.boom.label',
        category: 'fx',
        params: [{ key: 'strength', label: 'plugin.neon.cmd.boom.strength', type: 'number', default: 12 }],
      },
    ],
  },
  styles: ['./main.css'],
  messages: {
    en: { 'plugin.neon.name': 'Neon', 'plugin.neon.desc': 'A glowing text effect and a camera boom.', 'plugin.neon.te.neon.label': 'Neon', 'plugin.neon.cmd.boom.label': 'Boom', 'plugin.neon.cmd.boom.strength': 'Strength' },
    zh: { 'plugin.neon.name': '霓虹', 'plugin.neon.desc': '发光文字特效与镜头震动。', 'plugin.neon.te.neon.label': '霓虹', 'plugin.neon.cmd.boom.label': '震动', 'plugin.neon.cmd.boom.strength': '强度' },
  },
  authorUsage: ['inline {neon:text} — glowing text', '[boom strength=12] — a short camera rumble'],
}

const EXAMPLE_ENGINE_MODULE = `// engine.js — the runtime half named by plugin.json "entries.engine"
export default {
  id: 'com.example.neon',
  permissions: ['stage.write'],
  textEffects: { neon: (span) => span.addClass('fx-neon') },
  commands: {
    async boom({ num, plugin }) {
      const frames = []
      for (let i = 0; i < 8; i++) frames.push({ x: (Math.random() - 0.5) * num('strength', 12), y: 0 })
      frames.push({ x: 0, y: 0 })
      await plugin.stage?.animate('camera', frames, { durationSec: 0.4, easing: 'linear', compose: 'offset' })
    },
  },
  activate(ctx) { ctx.onDispose(() => {/* release anything acquired here */}) },
}
`

export function buildPluginSpec(): PluginSpecJson {
  return {
    specVersion: PLUGIN_SPEC_VERSION,
    pluginApiVersion: PLUGIN_API_VERSION,
    irSchemaVersion: CURRENT_SCHEMA_VERSION,
    generatedBy: '@nilvn/plugin-sdk spec:gen (packages/plugin-sdk/src/spec.ts)',
    references: {
      guide: 'packages/plugin-sdk/README.md',
      commands: 'packages/engine/docs/commands.md',
      engineApi: 'packages/engine/docs/api.md',
      engineTypes: 'packages/engine/src/types.ts',
      coreManifest: 'packages/core/src/plugin-manifest.ts',
      sdk: 'packages/plugin-sdk/src/index.ts',
      template: 'packages/plugin-sdk/template/',
      firstPartyPlugins: 'https://github.com/nilzx/nilvn-plugins',
    },
    manifest: { file: PLUGIN_MANIFEST_FILE, idPattern: PLUGIN_ID_RE.source, fields: MANIFEST_FIELDS, contributes: CONTRIBUTES_FIELDS },
    extensionPoints: [...EXTENSION_POINTS],
    permissions: [...PERMISSIONS],
    runtime: { module: RUNTIME_MODULE, context: RUNTIME_CONTEXT, commandContext: COMMAND_CONTEXT, capabilities: CAPABILITIES, lifecycle: LIFECYCLE, proxyRules: PROXY_RULES },
    editor: { module: EDITOR_MODULE, context: EDITOR_CONTEXT },
    firstParty: { idPrefix: FIRST_PARTY_ID_PREFIX, package: '@nilvn/plugins', repository: 'https://github.com/nilzx/nilvn-plugins' },
    example: { manifest: EXAMPLE_MANIFEST, engineModule: EXAMPLE_ENGINE_MODULE, use: ['[use ./plugins/neon/plugin.json]', '[use com.example.neon]  ; once registered by the host', '[use ./plugins/neon/engine.js]  ; a bare module (inline permissions)'] },
  }
}
