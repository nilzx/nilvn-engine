// The generated plugin-spec — the plugin platform's "single exported contract":
// everything a plugin author (human or AI) must know that is OWNED BY CODE, gathered from its live
// sources in @nilvn/core and emitted as one versioned JSON (`plugin-spec.json`
// at this package's root, shipped with it). Prose-side contracts (this package's
// README, the engine docs) are referenced by path, not duplicated. `pnpm spec:check` regenerates and
// byte-compares the artifact (and the package template derived from the example),
// so neither can drift from the code.

import {
  COMMAND_CATEGORIES,
  CURRENT_SCHEMA_VERSION,
  EXTENSION_POINTS,
  FIRST_PARTY_ID_PREFIX,
  PARAM_TYPES,
  CONFIG_TYPES,
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
 *  ships its own catalog); `firstParty` describes the namespace convention only.
 *  v3 (engine 0.15): plugin settings (`config` / `[plugins.<id>]` / `ctx.config`),
 *  per-plugin storage (`storage.local`), chrome contributions (`menuItems` /
 *  `titleItems` / `hud` behind `ui.screen`), in-engine dialogs (`ui.dialog`) and
 *  actor fields (`actorFields`); the in-game menu is the engine's own. */
export const PLUGIN_SPEC_VERSION = 3

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
  /** The shapes inside `contributes` (one field list per schema) and the closed
   *  value sets they use. */
  schemas: {
    paramTypes: readonly string[]
    configTypes: readonly string[]
    commandCategories: readonly string[]
    shapes: Record<string, FieldDoc[]>
  }
  permissions: PermissionDef[]
  runtime: {
    module: FieldDoc[]
    context: FieldDoc[]
    commandContext: FieldDoc[]
    capabilities: Record<string, string[]>
    /** Call signatures of the capability verbs, the effect handle and the hooks. */
    signatures: FieldDoc[]
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
  F('name', 'string', 'Display name as an i18n id resolved through `messages` (plugin.<slug>.name; slug = the last id segment by convention — a plugin’s messages are its own, so two plugins never clash).', true),
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
  F('assets', 'string[]', 'Resource files relative to plugin.json (no ".."): the complete list an exporter copies, and the only paths ctx.asset() resolves.'),
  F('messages', '{ [lang]: { [id]: text } }', 'The plugin’s own UI-chrome strings; `ctx.t(id)` resolves them in the work language.'),
  F('authorUsage', 'string[]', 'Author-facing usage lines (how to trigger the plugin in an AuthoringDoc); tools prefer these over deriving from contributes.'),
  F('apiVersion', 'number', `Plugin contract version this manifest targets (current: ${PLUGIN_API_VERSION}); a newer one is rejected.`),
]

const CONTRIBUTES_FIELDS: FieldDoc[] = [
  F('commands', 'CommandSchema[]', "Script commands `[name …]` with typed params (drives the editor insert form and the authoring lint); ifFalse: 'skip' (default) | 'handle' sets what a false trailing if= does."),
  F('textEffects', '{ name, label? }[]', 'Inline text effects `{name:text}`.'),
  F('objectKinds', 'ObjectKindSchema[]', 'Addressable stage-object kinds the plugin adds.'),
  F('effects', 'EffectSchema[]', 'Retargetable effects bound to kinds via appliesToKinds.'),
  F('hooks', 'string[]', 'Engine hook names the runtime half listens to (introspection).'),
  F('saveSlice', 'boolean | { version }', 'The plugin owns a SaveState.ext[id] slice (needs the save.slice permission); version = the slice shape version (default 1), equal to the module stateVersion.'),
  F('keybindings', '{ id, default, label?, when? }[]', "Keys in the engine's key table (needs input.keys): default in the [keys] format ('w', 'Ctrl+S', a list, false); when = playing (default) | always. A default already bound elsewhere stays unbound with a diagnostic; the author moves it with [keys.<short name or id>] <id> = …, the player in the settings screen."),
  F('panels', '{ id, label, kind? }[]', 'Editor manager panels the host renders a tab + container for.'),
  F('nodeKinds', 'string[]', 'IR node kinds the editor half owns (forms + inert flag while disabled).'),
  F('stageTools', 'string[]', 'Stage overlay tool ids.'),
  F('lineActions', 'string[]', 'Dialogue-line action bar button ids.'),
  F('objectMenu', 'string[]', 'On-stage object context-menu section ids.'),
  F('config', 'ConfigFieldSchema[]', 'Plugin settings: { key, type, default, label, options?, items?, min?, max?, step?, scope? } (type list = a TOML array, author scope only). The author sets them in the config file’s [plugins.<id>] table (short first-party names work) or the studio; the plugin reads ctx.config.get(key). scope = "player" rows also appear in the in-game settings panel and persist per work (the author’s value is the default). Unknown author keys are one diagnostic.'),
  F('menuItems', 'MenuItemDef[]', '{ id, label (i18n id) } — entries in the in-game system menu, shown while playing; the module wires each with ctx.screen.menuItem(id, onSelect) (needs ui.screen).'),
  F('titleItems', 'MenuItemDef[]', '{ id, label } — buttons on the title page, wired with ctx.screen.titleItem(id, onSelect) (needs ui.screen).'),
  F('hud', 'HudDef[]', '{ id, slot?: top-left | top-right | bottom-left | bottom-right } — a widget container in a stage corner, shown while playing: ctx.screen.hud(id) (needs ui.screen).'),
  F('actorFields', 'ActorFieldDef[]', '{ key, type, label? } — fields an actor declaration may carry for this plugin ([actors.<id>] key = … / [actor id key=…]); the engine files them under the actor’s ext[pluginId] and the plugin reads ctx.actorField(actorId, key).'),
  F('services', 'ServiceDef[]', '{ id, version } — services this plugin offers other plugins, provided with ctx.services.provide(id, api). A consumer lists this plugin in its dependencies and calls ctx.services.get(thisId, id, range?).'),
  F('themeTokens', 'ThemeTokenDef[]', "{ name, default, label? } — the plugin’s own theme tokens, named <short name>-… (weather-drop for com.example.weather). While the plugin is active the default sits on the stage root as --nilvn-<name>; a work’s [theme] / [theme …] sets it like an engine token, and the plugin’s CSS reads var(--nilvn-<name>)."),
]

const RUNTIME_MODULE: FieldDoc[] = [
  F('id', 'string', 'Must equal the manifest id.', true),
  F('permissions', 'Permission[]', 'Only for a module with no plugin.json (a bare [use ./x.js] or a host-registered module). With a manifest, write permissions there only; if both are given and their engine-side sets differ, the manifest wins with a diagnostic.'),
  F('version / dependencies / activation / reload', '…', 'Inline fallbacks for module-only plugins ([use ./x.js]); a manifest wins.'),
  F('styles', 'string', 'CSS injected while active.'),
  F('commands', 'Record<name, (ctx: CommandContext) => void | Promise<void>>', 'Script commands.'),
  F('textEffects', 'Record<name, (span: TextSpan, index, ctx: PluginContext) => void>', 'Inline text effects; `span.addClass` is the only verb.'),
  F('objectKinds', 'ObjectKindDecl[]', 'Runtime kind contracts: `transformable` + `recordable` channels — standard channel NAMES (x / y / scale / rotation / opacity / visible / face / band) or custom RecordableProp descriptors.'),
  F('effects', 'Record<name, { appliesToKinds, apply(handle, params, ctx) }>', 'Effects run with the OWNER plugin’s context.'),
  F('hooks', 'EngineHooks', 'onReady / onSessionChange(state, prev) / onLabel(label) / onDialogue / onDialogueDone / onReveal / onChoices / onChoose / onCommand / onEnd / onSaved(state) / onRestored(state) / onSettingsChange(key, value) / onVarChange(name, value) / onPreload(done, total, ref) / onError — each receives the plugin context last.'),
  F('activate(ctx)', 'void | Promise<void>', 'Once per activation. Register listeners / timers / layers through ctx so they are released on deactivate. A throw isolates the plugin.'),
  F('deactivate(ctx)', 'void', 'Before the host disposes everything registered through ctx.'),
  F('saveState(ctx) / restoreState(ctx, data)', '…', 'The SaveState.ext[id] slice (needs save.slice); restoreState always receives the current stateVersion shape.'),
  F('stateVersion / migrateState(data, from)', 'number / …', 'Slice shape version (default 1). An older saved slice goes through migrateState first; without it, or from a newer version, the slice is dropped with a diagnostic and loading continues.'),
]

const RUNTIME_CONTEXT: FieldDoc[] = [
  F('id / permissions / lang / session / actors', 'readonly', 'Identity, granted permissions, the work language, where the session is (idle / title / playing / ending — onSessionChange announces each change), the actor table.'),
  F('resolve(path)', 'string', 'Resource path → URL (aliases / by-ref assets / base URL).'),
  F('asset(path)', 'string | undefined', 'One of the plugin’s own files (listed in manifest assets) → URL: through the package for a carried plugin, relative to plugin.json / the module for a URL-loaded one.'),
  F('t(id, params?)', 'string', 'In the work language: the author’s [strings] first (a work may rename a plugin’s text), then the plugin’s own `messages`, then the engine chrome catalog; {name} placeholders filled from params.'),
  F('report(message, error?)', 'void', 'A `plugin` diagnostic attributed to this plugin (never throw over content).'),
  F('listen(target, type, fn, opts?)', '() => void', 'Event listener removed on dispose.'),
  F('onDispose(fn)', 'void', 'Run on deactivate.'),
  F('registerCommand / registerTextEffect / registerEffect / registerKind / on(hook, fn) / addStyle(css)', '…', 'Dynamic registration; all disposable.'),
  F('theme', 'ThemeCap', 'Always present: get(token) / all() / onChange(fn) over the work’s `--nilvn-*` theme overrides (THEME_TOKENS has the defaults). Plugin CSS draws with var(--nilvn-…), never colour literals, so it follows the theme.'),
  F('config', 'ConfigCap', 'Always present: get(key) / all() / onChange(fn) — this plugin’s settings, resolved schema default ← the author’s [plugins.<id>] value ← the player’s value.'),
  F('actorField(actorId, key)', 'unknown', 'Always present: a contributes.actorFields value for that actor (undefined when absent).'),
  F('services', 'ServicesCap', 'Always present: provide(id, api) → withdraw() offers a declared contributes.services entry (each function of api becomes a method); get(pluginId, serviceId, range?) → the provider’s methods, every one async, arguments and results structured-cloned both ways (data only, no functions or DOM). get needs the provider in dependencies; it is undefined when the range does not match or nothing is provided, and a call after the provider withdrew rejects.'),
  F('storage', 'StorageCap?', 'storage.local: get / set / remove / keys — a key-value store namespaced per work and plugin (async, JSON values), backed by the engine’s SaveStore.'),
  F('screen', 'ScreenCap?', 'ui.screen: open(id, title, render) → Promise resolved when that screen closes (any way) / close(id?) / isOpen(id?) full-stage screens in the engine’s panel chrome; menuItem(id, onSelect) / titleItem(id, onSelect) wire contributes.menuItems / titleItems; hud(id) → the contributes.hud container. All released on dispose.'),
  F('dialog', 'DialogCap?', 'ui.dialog: confirm(message) → Promise<boolean>, alert(message), prompt(message, { default?, maxlength?, pattern?, type?: text | number, min?, max?, step?, lines? }) → Promise<string | null>, toast(message) — the engine’s own boxes, never the browser’s.'),
  F('stage', 'StageCap?', 'stage.read: hasObject / getProp / getBand / getFace / hasChar / charFace / snapshot. stage.write adds every Renderer write verb + applyEffect / showActor / playFrames / stopFrames / startLoop / stopLoop / runningLoops (write verbs are reporting stubs under stage.read only). playFrames / startLoop / stopLoop accept the keyframe WIRE forms (`obj#t:ch=v;…|…`, `t:ch=v;…`, `ch=v,…`) as well as decoded tracks — the engine owns the codec.'),
  F('audio', 'AudioCap?', 'audio.play: playTrack / stopTrack / stopAllTracks / playSe / volume(channel) / voicePlaying.'),
  F('vars', 'VarsCap?', 'vars.read: get / has / all over the plugin’s own variables (keys without the prefix), global(name) for an author variable, namespace; vars.write adds set (a stub without it). They are stored under the full id (namespace, - → _: com.example.weather.intensity) — what saves hold and what always works in scripts. Scripts may also use the short prefix (a third-party id’s last segment: weather.intensity) while no other active plugin shares it; plugins that share one all lose it, each with a diagnostic.'),
  F('input', 'InputCap?', 'input.keys: on(id, fn) runs fn when a contributes.keybindings binding is pressed (auto-repeat excluded); released on dispose. label(id) is the key it has now as the settings screen shows it ("F", "Ctrl+S"; "" when unbound).'),
  F('saves', 'SavesCap?', 'session.save: saveState / restoreState / restart / saveKey / buildInfo.'),
  F('settings', 'SettingsCap?', 'session.settings: textSpeed, getVolume / setVolume, lang / languages / languageName / setLanguage / onLanguageChange, resolveText.'),
  F('backlog', 'BacklogCap?', 'session.backlog: entries / replayVoice.'),
  F('replay', 'ReplayCap?', 'session.replay: list / isReplaying / play / end / fireSeen / onSeen / onEnd.'),
  F('ui', 'UiCap?', 'ui.layer: layer(className) → a host container in the stage root; onStage(type, fn) for stage input. Both released on dispose.'),
  F('timer', 'TimerCap?', 'timer: setTimeout / setInterval / requestAnimationFrame and their clears; all cleared on dispose.'),
]

const COMMAND_CONTEXT: FieldDoc[] = [
  F('name / args / params / raw', '…', 'The parsed tag, without its trailing `if=` (the engine splits and evaluates it).'),
  F('cond', 'boolean', "The tag's `if=`: true when absent or holding. A false one skips the command unless its CommandSchema declares ifFalse: 'handle' — then the command runs with cond === false and decides what \"not present\" means."),
  F('condExpr', 'string | undefined', "For an ifFalse: 'handle' command only: the if= expression as written. Hand it to the stage (showSprite’s spec.if) and the engine re-evaluates it on every variable change — the sprite is drawn and clickable only while it holds."),
  F('str(keyOrIndex, def?) / num(keyOrIndex, def?) / numOpt(keyOrIndex)', '…', 'Argument accessors (positional index or named key); numOpt yields undefined for an absent / non-numeric param instead of a default.'),
  F('resolve(path) / wait(sec)', '…', 'Path resolution and a delay.'),
  F('plugin', 'PluginContext', 'The owning plugin’s capability context — the ONLY way to the stage / audio / vars.'),
]

const CAPABILITIES: Record<string, string[]> = {
  'stage.read': ['hasObject', 'getProp', 'getBand', 'getFace', 'hasChar', 'charFace', 'snapshot'],
  'stage.write': ['setBackground', 'showChar', 'moveChar', 'hideChar', 'clearChars', 'focusChar', 'showSprite', 'hideSprite', 'clearSprites', 'setProp', 'animate', 'stopAnimations', 'setBand', 'setFace', 'setName', 'showDialog', 'showIndicator', 'setWindowSkin', 'fadeScreen', 'transitionScreen', 'flash', 'applyEffect', 'showActor', 'playFrames', 'stopFrames', 'startLoop', 'stopLoop', 'runningLoops'],
  'audio.play': ['playTrack', 'stopTrack', 'stopAllTracks', 'playSe', 'volume', 'voicePlaying'],
  'vars.read': ['get', 'has', 'all', 'global', 'namespace'],
  'vars.write': ['set'],
  'save.slice': ['saveState', 'restoreState (module methods are called)'],
  'session.save': ['saveState', 'restoreState', 'restart', 'saveKey', 'buildInfo'],
  'session.settings': ['textSpeed', 'getVolume', 'setVolume', 'lang', 'languages', 'languageName', 'setLanguage', 'onLanguageChange', 'resolveText'],
  'session.backlog': ['entries', 'replayVoice'],
  'session.replay': ['list', 'isReplaying', 'play', 'end', 'fireSeen', 'onSeen', 'onEnd'],
  'ui.layer': ['layer', 'onStage'],
  'ui.screen': ['open', 'close', 'isOpen', 'menuItem', 'titleItem', 'hud'],
  'ui.dialog': ['confirm', 'alert', 'prompt', 'toast'],
  timer: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
  'storage.local': ['get', 'set', 'remove', 'keys'],
  'input.keys': ['on', 'label'],
  'project.read': ['state (editor)'],
  'project.commit': ['commit', 'run (editor)'],
  'assets.read': ['assets (editor)'],
  'assets.write': ['assets imports (editor)'],
  'ui.panel': ['refresh (editor)'],
  'ui.window': ['refresh (editor)'],
  'ui.toast': ['toast', 'refresh (editor)'],
}

// ---- signatures: ONE source for plugin-spec.json `runtime.signatures` and the
// README's "Signatures" section (scripts/gen-spec.ts writes both; `spec:check`
// fails on drift). Notes are Markdown; a feature not yet released carries the
// `*(since 0.19.0)*` mark, which `version:set engine` stamps here and in
// the README alike.

/** One row of the stage verbs table: calls that share a note. */
interface CallDoc {
  /** Full call shapes, `moveChar(id, at, timeSec = 0.45)`. */
  calls: string[]
  /** What the promise-returning ones resolve to, when they do. */
  returns?: string
  notes: string
}

const STAGE_CALLS: CallDoc[] = [
  { calls: ['setBackground({ url?, color?, ref? }, fadeSec = 0)'], returns: 'Promise<void>', notes: '`url` resolved (`ctx.resolve` / `ctx.asset`); `ref` = the unresolved path a save should keep.' },
  { calls: ['showChar(id, url, { at?, fade?, face?, ref?, y?, scale?, rotation? })', 'showActor(id, face?, { at?, fade?, src?, y?, scale?, rotation? })'], returns: 'Promise<void>', notes: '`showChar` shows a raw image as character `id`; prefer `showActor`, which goes through the actor table like `[char]`.' },
  { calls: ['moveChar(id, at, timeSec = 0.45)', 'hideChar(id, fadeSec = 0.3)', 'clearChars(fadeSec = 0.3)', 'focusChar(speaker | null)'], notes: '`at` is `left` / `center` / `right` or a percentage.' },
  { calls: ['showSprite(id, spec, fadeSec = 0.3)'], returns: 'Promise<void>', notes: '`spec`: `{ url, ref?, frames, fps, loop, at?, height?, y?, scale?, rotation?, onclick?, if? }` — `url` is the resolved single-row sheet, `frames` / `fps` its frame count and rate, `loop` must be given (`[sprite]` defaults it to true, the call does not), `height` a percentage of the stage height (default 30), `onclick` script commands, `if` a live condition (see `condExpr`). The object is `sprite:<id>`.' },
  { calls: ['hideSprite(id, fadeSec = 0.3)', 'clearSprites(fadeSec = 0)'], notes: '' },
  { calls: ['getProp(objId, prop)', 'setProp(objId, prop, value)'], notes: '`prop` is one of `x` `y` (pixels, or `"12%"` of the object\'s own box) `scale` `rotation` (degrees) `opacity` `visible` `zIndex`, and on the camera `hue` `invert` `saturate` `brightness` `contrast` `grayscale`.' },
  { calls: ['animate(objId, frames, { durationSec, easing?, iterations?, compose?, key?, commit? })'], returns: 'Promise<void>', notes: "`frames`: an array of partial transforms, each with an optional `offset` (0..1) and `easing`; `compose: 'offset'` adds to the resting value instead of replacing it. Resolves at the end, or when stopped. The resting value is untouched — `get` reads the value before, and the object returns to it — unless `commit: true` (an `absolute`, finite animation), which makes the last frame the resting pose that `get` reads and a save keeps. `key` names the animation on its object: a second one with the same key replaces the first, so re-applying an effect never stacks. `key` and `commit` *(since 0.19.0)*." },
  { calls: ['stopAnimations(objId, key?)'], notes: 'Stops what `animate` started on the object — all, or the one with `key` — and the object returns to its resting pose; an `iterations: Infinity` animation runs until then. Show / hide fades and keyframe loops are not touched. An animation is not part of a save: a loop that must survive one is `startLoop`. *(since 0.19.0)*' },
  { calls: ['getBand(objId)', "setBand(objId, 'world' | 'front' | 'back')", 'getFace(objId)', 'setFace(objId, face)'], notes: '' },
  { calls: ['setName(name?, color?, textColor?)', 'showDialog(show)', 'showIndicator(on)', 'setWindowSkin(objId, url?, ref?)'], notes: 'The dialogue box.' },
  { calls: ["fadeScreen(to, sec, color = '#000')", 'transitionScreen(to, sec, { shape?, dir?, color?, mask?, softness? })', 'flash(color, durationSec)'], returns: 'Promise<void>', notes: 'Full-screen covers: `to` 1 = covered, 0 = clear.' },
  { calls: ['applyEffect(name, objId, params)'], returns: 'Promise<void>', notes: 'Runs a registered effect on an object; `params` is a `Record<string, string>`.' },
  { calls: ['playFrames(durationSec, tracks)', 'stopFrames()', 'startLoop(objId, durationSec, entry, body, intoEase?, bridge?)', 'stopLoop(objId, exit, outEase?)', 'runningLoops()'], notes: 'Keyframe playback; `tracks` / `entry` / `body` / `exit` take the keyframe wire strings or decoded objects.' },
  { calls: ['hasObject(objId)', 'hasChar(id)', 'charFace(id)', 'snapshot()'], notes: 'Reads (`stage.read`).' },
]

/** The handle an effect's `apply(handle, params, ctx)` receives. */
const EFFECT_HANDLE = {
  members: ['id', 'kind', 'get(prop)', 'set(prop, value)', 'animate(frames, opts)', 'stopAnimations(key?)', 'getBand()', 'setBand(band)', 'getFace()', 'setFace(face)'],
  notes: '`id` is the full object id (`character:yuki`), `kind` its kind (`character`); the rest are the stage verbs above without the `objId`, and nothing else.',
}

/** Hook arguments; each hook also receives the plugin context last. */
const HOOKS: { hooks: string[]; args: string }[] = [
  { hooks: ['onReady', 'onEnd'], args: '—' },
  { hooks: ['onSessionChange'], args: '`state`, `prev` (`idle` / `title` / `playing` / `ending`)' },
  { hooks: ['onLabel'], args: '`label`' },
  { hooks: ['onDialogue', 'onDialogueDone'], args: '`node`: `{ speaker?, face?, segments, textKey?, line }`' },
  { hooks: ['onReveal'], args: '`char`, `index` (within the line), `speaker`' },
  { hooks: ['onChoices'], args: '`items` (`{ text, textKey?, target, cond?, disabled? }[]`, the shown ones), `handles` (`ChoiceHandle[]`: `index`, `addClass(name)`, `setVar(name, value)`)' },
  { hooks: ['onChoose'], args: '`item`, `index`' },
  { hooks: ['onCommand'], args: '`name`, `args`, `params`' },
  { hooks: ['onSaved', 'onRestored'], args: '`state` (the `SaveState`)' },
  { hooks: ['onSettingsChange'], args: '`key`, `value`' },
  { hooks: ['onVarChange'], args: '`name` (the full name), `value`' },
  { hooks: ['onPreload'], args: '`done`, `total`, `ref`' },
  { hooks: ['onError'], args: '`info` (an `EngineDiagnostic`: `phase`, `message`, `line?`, `plugin?`)' },
]

const MISUSE = 'Every write verb that returns a promise resolves when its fade or animation ends; a verb called with arguments it cannot use reports a diagnostic against your plugin and does nothing — it never throws back into your code.'

const callName = (c: string): string => c.slice(0, c.indexOf('('))
const callArgs = (c: string): string => c.slice(c.indexOf('('))

const SIGNATURES: FieldDoc[] = [
  ...STAGE_CALLS.map((r) => F(`stage.${r.calls.map(callName).join(' / ')}`, r.calls.map(callArgs).join(' / ') + (r.returns ? ` => ${r.returns}` : ''), r.notes)),
  F('effect handle', EFFECT_HANDLE.members.join(', '), `What apply(handle, params, ctx) receives, bound to one object. ${EFFECT_HANDLE.notes}`),
  ...HOOKS.map((h) => F(`hook ${h.hooks.join(' / ')}`, h.args, 'Then the plugin context, last.')),
  F('write verb misuse', '—', MISUSE),
]

const cell = (s: string): string => s.replace(/\|/g, '\\|')

/** The README's "Signatures" section body, generated from the tables above
 *  (scripts/gen-spec.ts writes it between the `signatures` markers). @internal */
export function signaturesMarkdown(): string {
  return [
    "The capability objects' calls, as the engine's type declarations define them",
    '(`@nilvn/engine` ships the `.d.ts`). ' + MISUSE,
    '',
    '| Call | Notes |',
    '|---|---|',
    ...STAGE_CALLS.map((r) => `| ${r.calls.map((c) => '`' + cell(c) + '`').join(' / ')} | ${cell(r.notes)} |`),
    '',
    "An effect's `apply(handle, params, ctx)` receives a handle bound to one object: " + EFFECT_HANDLE.members.map((m) => '`' + m + '`').join(', ') + '. ' + EFFECT_HANDLE.notes,
    '',
    'Hooks receive their arguments and then your context last:',
    '',
    '| Hook | Arguments |',
    '|---|---|',
    ...HOOKS.map((h) => `| ${h.hooks.map((n) => '`' + n + '`').join(' / ')} | ${cell(h.args)} |`),
  ].join('\n')
}

const LIFECYCLE = [
  'register(manifest / module) → validate (id grammar · apiVersion · engine range · dependencies · permission catalog) → activate(ctx) → running → deactivate(ctx) → dispose',
  'Every contribution and resource registered through ctx is released on deactivate; a plugin must not hold globals.',
  'activate() may be async; a rejection or throw isolates the plugin (its commands become no-ops, one diagnostic).',
  'N consecutive command failures (default 3) isolate the plugin; one success resets the count.',
  'reload = saveState slice → deactivate → (re-import cache-busted for path plugins) → activate → restoreState; any failure rolls back to the previous module.',
  'activation.engine: eager (default) | onCommand (first execution of one of its commands) | manual (enablePlugin / setPlugins only).',
  'A running engine (finished game) never hot-swaps its command set; the editor toggles in edit mode and rebuilds the preview per run.',
  'A script package carries a third-party plugin under plugins/<id>/ with every file in its by-ref asset table (nilvn.json plugins[].entry = the plugin.json); the engine imports the module from the URL the package loader serves, so the engine entry must be one self-contained ES module (no relative imports). A carried plugin reloads in place (no re-import).',
]

const PROXY_RULES = [
  'Capability methods are async or pure; return values and parameters must be structured-cloneable.',
  'No DOM handles cross the boundary — TextSpan / ChoiceHandle / StageObjectHandle are proxyable handle objects (index / id + methods).',
  'A denied capability is undefined on the context, never an exception; stage write verbs under stage.read only are reporting stubs.',
  'Third-party plugins default-deny net:* and fs.*; those permissions are reserved until the host mediates them.',
  'In a sandbox, synchronous reads of live state become async: stage hasObject / getProp / getBand / getFace / hasChar / charFace / snapshot / runningLoops, saves.saveState, settings.resolveText, backlog.entries. Reads of slow-changing data (vars, theme, config, lang, session, actors, resolve, asset, t, volumes) are served from a host-pushed mirror and stay synchronous.',
  'ctx.services calls are async both ways and structured-clone their arguments and results already, so a service interface needs no change to cross a sandbox.',
  'Same-realm only (unavailable in a sandbox, declarative equivalents to come): ctx.listen, ui.layer / ui.onStage, the HTMLElement of screen.open render and screen.hud, custom RecordableProp descriptors (standard channel names are fine), showChar opts.faceUrl (use showActor).',
]

const SCHEMA_SHAPES: Record<string, FieldDoc[]> = {
  CommandSchema: [
    F('name', 'string', 'The command, used as [name …].', true),
    F('label', 'string', 'i18n id (plugin messages) for the editor insert menu.', true),
    F('category', 'stage | audio | fx | flow | text', 'Where the editor files the command.', true),
    F('hint', 'string', 'One-line help (an i18n id or text).'),
    F('icon', 'string', 'An emoji for the insert menu.'),
    F('params', 'ParamSchema[]', 'The typed parameters, in order.', true),
    F('ifFalse', 'skip | handle', 'What a false trailing if= does (default skip; handle = the command runs with ctx.cond === false).'),
  ],
  ParamSchema: [
    F('key', 'string', 'The parameter name: [cmd key=value]. A positional param is still named here (forms, lint) but arrives in ctx.args[positional].', true),
    F('label', 'string', 'i18n id (plugin messages).', true),
    F('type', 'ParamType', 'One of `schemas.paramTypes` (asset / actor / face / … drive editor pickers).', true),
    F('positional', 'number', 'The argument index (0, 1, …): the value is written as a bare word at that position ([weather rain] → ctx.args[0]) instead of key=value.'),
    F('required', 'boolean', 'The editor and the authoring lint require it; the runtime does not check.'),
    F('default', 'string | number | boolean', 'Shown and used by the editor; the command still reads its own fallback (str(key, def) / num(key, def)).'),
    F('options', '{ value, label }[]', 'The choices of an enum (label = i18n id).'),
    F('list', 'boolean', 'A positional holding several whitespace-separated values.'),
    F('advanced', 'boolean', 'Folded behind "advanced" in the editor form.'),
  ],
  ConfigFieldSchema: [
    F('key', 'string', 'The setting: ctx.config.get(key), [plugins.<id>] key = … in the config.', true),
    F('label', 'string', 'i18n id (plugin messages) — the settings row / studio form.', true),
    F('type', 'ParamType | list', 'One of `schemas.configTypes`. In the settings screen: boolean → On / Off, number with min + max → a slider, enum → buttons, anything else → a text field. list (config only, author scope only) is a TOML array; ctx.config.get returns an array.', true),
    F('items', 'string | number', 'A list’s item type (default string).'),
    F('default', 'string | number | boolean | array', 'The value until the author or player sets one (ctx.config.get returns it). A list’s default is an array.'),
    F('options', '{ value, label }[]', 'Enum choices.'),
    F('min / max / step', 'number', 'Number range: values are clamped into it; a player row needs min and max to render as a slider.'),
    F('scope', 'author | player', 'author (default): the config file only; player: also a row in the game’s settings screen, persisted per work (the author’s value is the default). A list is author-only.'),
  ],
  KeybindingDef: [
    F('id', 'string', 'Local to the plugin; the key table calls it <plugin id>:<id>, the author’s override is [keys.<short name or id>] <id> = …, and ctx.input.on(id, fn) handles it.', true),
    F('default', 'string | string[] | false', 'The [keys] format: "w", "Ctrl+S", a list, or false (unbound until someone binds it).', true),
    F('label', 'string', 'i18n id (plugin messages) for the settings screen’s key list (default: the id).'),
    F('when', 'playing | always', 'playing (default): while the story plays with no system menu, panel or plugin screen open. always: also on the title and ending pages and while a plugin screen is open — never while a system menu panel is open or a text field has focus. For a title-only key, use always and check ctx.session in the handler.'),
  ],
  MenuItemDef: [
    F('id', 'string', 'Wired with ctx.screen.menuItem(id, onSelect) (titleItems: titleItem). The menu closes before onSelect runs; onSelect gets no arguments.', true),
    F('label', 'string', 'i18n id (plugin messages).', true),
    F('when', '—', 'Deprecated and ignored (a validator warning): the system menu only opens while playing. A title-page entry is a titleItems entry.'),
  ],
  HudDef: [F('id', 'string', 'ctx.screen.hud(id) returns the corner container (shown only while playing).', true), F('slot', 'top-left | top-right | bottom-left | bottom-right', 'The corner (default top-left).')],
  ActorFieldDef: [F('key', 'string', '[actors.<id>] key = … / [actor … key=…]; read with ctx.actorField(actorId, key).', true), F('type', 'ParamType', 'The studio form control.', true), F('label', 'string', 'i18n id.')],
  ServiceDef: [F('id', 'string', 'Local to the plugin (letters, digits, - and _); consumers ask for (plugin id, id).', true), F('version', 'string', 'The service interface’s own semver version ("1.0.0"); a consumer’s range is checked against it.', true)],
  ThemeTokenDef: [
    F('name', 'string', 'Lower-case words joined by dashes, starting with the plugin’s short name and a dash (the id’s last segment: weather- for com.example.weather); the custom property is --nilvn-<name>. May not reuse an engine token or another active plugin’s.', true),
    F('default', 'string', 'One CSS value (no ; { }); may reference other tokens, e.g. var(--nilvn-accent).', true),
    F('label', 'string', 'i18n id (the studio’s theme form).'),
  ],
  TextEffectDef: [F('name', 'string', 'Used inline as {name:text}; implemented in the module’s textEffects.', true), F('label', 'string', 'i18n id.'), F('preview', 'string', 'Sample text for the editor.')],
  ObjectKindSchema: [F('id', 'string', 'The kind id.', true), F('label', 'string', 'i18n id.', true), F('transformable', 'boolean', 'Whether it takes the transform schema.', true), F('icon', 'string', 'An emoji.')],
  EffectSchema: [
    F('name', 'string', 'The effect, implemented in the module’s effects.', true),
    F('label', 'string', 'i18n id.', true),
    F('appliesToKinds', 'string[]', 'Object kinds it targets.', true),
    F('command', 'string', 'The command that applies it (its CommandSchema drives the form).', true),
    F('targetParams / fanout / hint / icon', '…', 'Editor wiring: params pointing the command at the chosen object; an enum param to expand into one entry per option.'),
  ],
}

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
  engine: '>=0.19 <1',
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
  // permissions live in plugin.json
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
      engineTypes: '@nilvn/engine type declarations (PluginContext, the capability interfaces, EngineHooks)',
      coreManifest: '@nilvn/core type declarations (PluginManifest, PluginContributions)',
      sdk: '@nilvn/plugin-sdk exports (README "Exports")',
      template: 'packages/plugin-sdk/template/',
      firstPartyPlugins: 'https://github.com/nilzx/nilvn-plugins',
    },
    manifest: { file: PLUGIN_MANIFEST_FILE, idPattern: PLUGIN_ID_RE.source, fields: MANIFEST_FIELDS, contributes: CONTRIBUTES_FIELDS },
    extensionPoints: [...EXTENSION_POINTS],
    schemas: { paramTypes: PARAM_TYPES, configTypes: CONFIG_TYPES, commandCategories: COMMAND_CATEGORIES, shapes: SCHEMA_SHAPES },
    permissions: [...PERMISSIONS],
    runtime: { module: RUNTIME_MODULE, context: RUNTIME_CONTEXT, commandContext: COMMAND_CONTEXT, capabilities: CAPABILITIES, signatures: SIGNATURES, lifecycle: LIFECYCLE, proxyRules: PROXY_RULES },
    editor: { module: EDITOR_MODULE, context: EDITOR_CONTEXT },
    firstParty: { idPrefix: FIRST_PARTY_ID_PREFIX, package: '@nilvn/plugins', repository: 'https://github.com/nilzx/nilvn-plugins' },
    example: { manifest: EXAMPLE_MANIFEST, engineModule: EXAMPLE_ENGINE_MODULE, use: ['[use ./plugins/neon/plugin.json]', '[use com.example.neon]  ; once registered by the host', '[use ./plugins/neon/engine.js]  ; a bare module (no plugin.json: it must declare its own permissions)'] },
  }
}
