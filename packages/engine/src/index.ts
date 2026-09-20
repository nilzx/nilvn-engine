export { Engine, createEngine } from './engine.js'
export type { SaveState, SaveAddress, SavedLoop } from './engine.js'
// Chunked-streaming Web loader — the inc-6 bootstrap builds one from a
// fetched manifest and passes it to createEngine({ loader, manifest }).
export { WebContentLoader } from './loader.js'
// Script package (.nvs): the one load entry — a package directory URL, zip
// bytes, or the single-file export's inline payload.
export {
  openPackage,
  inlinePackage,
  checkPackageManifest,
  isPackageManifest,
  InlineContentLoader,
  ZipContentLoader,
  PackageFormatError,
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILE,
} from './package.js'
export type { ScriptPackage, PackageSource, InlinePackageData } from './package.js'
export { DomRenderer, animate, preloadImage } from './stage.js'
export type { EditStage } from './stage.js'
export type {
  Renderer,
  StageState,
  StagePos,
  CharOptions,
  Length,
  Transform,
  TransformProp,
  TransformValue,
  TransformKeyframe,
  AnimFrame,
  AnimOpts,
  ChromeRenderer,
  ScreenId,
  ScreenModel,
  ScreenButton,
} from './renderer/types.js'
export { ObjectHandle, kindOf, BUILTIN_KINDS, STANDARD_CHANNELS, resolveKind } from './object.js'
// Plugin platform v2: the runtime manifest mirror + version the host
// checks `plugin.json` against, and the semver subset it uses.
export { PLUGIN_API_VERSION, PLUGIN_MANIFEST_FILE, FIRST_PARTY_ID_PREFIX, PERMISSION_IDS, firstPartyShortName, matchPermission, isPluginId, manifestProblems } from './plugin-manifest.js'
export { satisfiesRange, isValidRange, parseSemVer, compareSemVer } from './semver.js'
export { ENGINE_VERSION } from './version.js'
export { ENGINE_CAPABILITIES } from './plugin-context.js'
export { applyConfig, fetchConfig, windowTheme } from './config.js'
// The theme contract: token table + defaults, the `--nilvn-` prefix, helpers.
export { THEME_TOKENS, THEME_PREFIX, THEME_TOKEN_RE, isThemeToken, themeVar } from './theme.js'
export type { ThemeTokens } from './theme.js'
export { parseScript, parseSegments, parseTag } from './parser.js'
export type { ParsedScript, ParseDiagnostic } from './parser.js'
// Recording interpolation core — shared with the editor's event-frame scrub preview:
// the same sampling the engine plays at runtime.
export { decodeTracks, decodeFrames, decodeChannelSet, sampleContinuous, sampleContinuousCarry, discreteAt, easeFn } from './keyframes.js'
export type { DecodedTrack, DecodedFrame } from './keyframes.js'
export { tUI, setUILang, getUILang, uiLangName, CHROME_STRING_IDS } from './i18n.js'
// Persistence seam (saves / settings) and the built-in screens' model builders.
export { LocalStorageSaveStore, MemorySaveStore, AUTOSAVE_KEY, QUICKSAVE_KEY, SETTINGS_KEY, READ_KEY, UNLOCKS_KEY, PLUGIN_SETTINGS_KEY, slotKey, pluginStorageKey, isSlotPayload } from './save-store.js'
export type { SaveStore, SlotPayload, SettingsPayload } from './save-store.js'
export { MENU_ITEMS_DEFAULT, SETTINGS_ROWS_DEFAULT } from './system-menu.js'
export { titleModel, endingModel, screenBackground, TITLE_BUTTONS_DEFAULT } from './chrome.js'
export type { ChromeHost } from './chrome.js'
export { evalExpr, truthy } from './expr.js'
export { builtins } from './builtins.js'
export type * from './types.js'
