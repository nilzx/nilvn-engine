// Engine UI-chrome i18n: the lookup MECHANISM plugins and hosts render chrome
// through (`ctx.t` falls back here after a plugin's own `messages` and the
// work's overrides), by STABLE DOTTED IDs, active → en → id. The engine's own
// screens (title / ending — batch G) carry their strings here, en as the base;
// a work overrides any id through `createEngine({ messages })` or the config
// file's `[strings.<lang>]`. The catalogs stay baked in (no @nilvn/core runtime
// dependency) so a single-file export switches language fully offline.
//
// This localizes only chrome. The work's *content* (dialogue, character names,
// choice labels) is resolved separately from the project catalogs the engine
// receives at boot — see Engine.resolveText / setLanguage. Chrome language
// follows the work's language: set at boot from the project's defaultLang and
// switchable from the in-game menu, which keeps both in sync.

type Catalog = Record<string, string>

const BASE = 'en'

const en: Catalog = {
  'ui.title.new': 'New game',
  'ui.title.continue': 'Continue',
  'ui.title.load': 'Load',
  'ui.title.settings': 'Settings',
  'ui.title.quit': 'Quit',
  'ui.ending.title': 'The End',
  'ui.ending.toTitle': 'Back to title',
  'ui.ending.restart': 'Play again',
  'ui.menu.title': 'Menu (Esc)',
  'ui.menu.save': 'Save',
  'ui.menu.load': 'Load',
  'ui.menu.quicksave': 'Quick save',
  'ui.menu.quickload': 'Quick load',
  'ui.menu.backlog': 'Backlog',
  'ui.menu.auto': 'Auto',
  'ui.menu.skip': 'Skip',
  'ui.menu.settings': 'Settings',
  'ui.menu.replays': 'Replays',
  'ui.menu.replayExit': 'Back to story',
  'ui.menu.toTitle': 'Title',
  'ui.menu.restart': 'Restart',
  'ui.menu.close': 'Close',
  'ui.menu.version': 'NilVN Studio v{ver}',
  'ui.settings.textSpeed': 'Text speed',
  'ui.settings.speed.slow': 'Slow',
  'ui.settings.speed.normal': 'Normal',
  'ui.settings.speed.fast': 'Fast',
  'ui.settings.autoDelay': 'Auto wait',
  'ui.settings.skipMode': 'Skip',
  'ui.settings.skip.read': 'Read text',
  'ui.settings.skip.all': 'Everything',
  'ui.settings.vol.music': 'Music',
  'ui.settings.vol.ambience': 'Ambience',
  'ui.settings.vol.sfx': 'SFX',
  'ui.settings.vol.voice': 'Voice',
  'ui.settings.language': 'Language',
  'ui.settings.fullscreen': 'Fullscreen',
  'ui.settings.dialogOpacity': 'Dialogue box',
  'ui.settings.uiScale': 'Text size',
  'ui.settings.on': 'On',
  'ui.settings.off': 'Off',
  'ui.saves.autoSlot': 'Auto',
  'ui.saves.quickSlot': 'Quick',
  'ui.saves.empty': 'Empty',
  'ui.saves.delete': 'Delete',
  'ui.saves.msg.saved': 'Saved',
  'ui.saves.msg.overwrite': 'Overwrite this save?',
  'ui.saves.msg.delete': 'Delete this save?',
  'ui.saves.msg.failed': 'Save failed (storage full)',
  'ui.saves.msg.mismatch': "Save doesn't match this version",
  'ui.saves.msg.noQuick': 'No quick save yet',
  'ui.backlog.empty': 'No dialogue yet',
  'ui.backlog.playVoice': 'Play voice',
  'ui.replays.locked': 'Locked — reach this part of the story first',
  'ui.msg.restartConfirm': 'Restart? Unsaved progress will be lost.',
  'ui.msg.toTitleConfirm': 'Back to the title? Unsaved progress will be lost.',
  'ui.dialog.ok': 'OK',
  'ui.dialog.cancel': 'Cancel',
}
const zh: Catalog = {
  'ui.title.new': '开始游戏',
  'ui.title.continue': '继续',
  'ui.title.load': '读取',
  'ui.title.settings': '设置',
  'ui.title.quit': '退出',
  'ui.ending.title': '完',
  'ui.ending.toTitle': '回到标题',
  'ui.ending.restart': '再来一次',
  'ui.menu.title': '菜单（Esc）',
  'ui.menu.save': '保存进度',
  'ui.menu.load': '读取进度',
  'ui.menu.quicksave': '快速保存',
  'ui.menu.quickload': '快速读取',
  'ui.menu.backlog': '回看',
  'ui.menu.auto': '自动',
  'ui.menu.skip': '快进',
  'ui.menu.settings': '设置',
  'ui.menu.replays': '回想',
  'ui.menu.replayExit': '返回剧情',
  'ui.menu.toTitle': '标题',
  'ui.menu.restart': '回到开始',
  'ui.menu.close': '关闭',
  'ui.menu.version': 'NilVN 工坊 v{ver}',
  'ui.settings.textSpeed': '文字速度',
  'ui.settings.speed.slow': '慢',
  'ui.settings.speed.normal': '中',
  'ui.settings.speed.fast': '快',
  'ui.settings.autoDelay': '自动等待',
  'ui.settings.skipMode': '快进范围',
  'ui.settings.skip.read': '已读',
  'ui.settings.skip.all': '全部',
  'ui.settings.vol.music': '音乐',
  'ui.settings.vol.ambience': '环境音',
  'ui.settings.vol.sfx': '音效',
  'ui.settings.vol.voice': '语音',
  'ui.settings.language': '语言',
  'ui.settings.fullscreen': '全屏',
  'ui.settings.dialogOpacity': '对白框',
  'ui.settings.uiScale': '文字大小',
  'ui.settings.on': '开',
  'ui.settings.off': '关',
  'ui.saves.autoSlot': '自动',
  'ui.saves.quickSlot': '快速',
  'ui.saves.empty': '空档位',
  'ui.saves.delete': '删除',
  'ui.saves.msg.saved': '已保存',
  'ui.saves.msg.overwrite': '覆盖这个存档？',
  'ui.saves.msg.delete': '删除这个存档？',
  'ui.saves.msg.failed': '保存失败（空间已满）',
  'ui.saves.msg.mismatch': '存档与当前版本不符',
  'ui.saves.msg.noQuick': '还没有快速存档',
  'ui.backlog.empty': '还没有对白',
  'ui.backlog.playVoice': '播放语音',
  'ui.replays.locked': '未解锁——先在剧情里看到这一段',
  'ui.msg.restartConfirm': '回到开始？尚未保存的进度会丢失。',
  'ui.msg.toTitleConfirm': '回到标题？尚未保存的进度会丢失。',
  'ui.dialog.ok': '确定',
  'ui.dialog.cancel': '取消',
}
const ja: Catalog = {
  'ui.title.new': 'はじめから',
  'ui.title.continue': 'つづきから',
  'ui.title.load': 'ロード',
  'ui.title.settings': '設定',
  'ui.title.quit': '終了',
  'ui.ending.title': 'おわり',
  'ui.ending.toTitle': 'タイトルへ',
  'ui.ending.restart': 'もう一度',
  'ui.menu.title': 'メニュー（Esc）',
  'ui.menu.save': 'セーブ',
  'ui.menu.load': 'ロード',
  'ui.menu.quicksave': 'クイックセーブ',
  'ui.menu.quickload': 'クイックロード',
  'ui.menu.backlog': 'バックログ',
  'ui.menu.auto': 'オート',
  'ui.menu.skip': 'スキップ',
  'ui.menu.settings': '設定',
  'ui.menu.replays': '回想',
  'ui.menu.replayExit': '物語に戻る',
  'ui.menu.toTitle': 'タイトル',
  'ui.menu.restart': '最初に戻る',
  'ui.menu.close': '閉じる',
  'ui.menu.version': 'NilVN スタジオ v{ver}',
  'ui.settings.textSpeed': '文字速度',
  'ui.settings.speed.slow': '遅い',
  'ui.settings.speed.normal': '普通',
  'ui.settings.speed.fast': '速い',
  'ui.settings.autoDelay': 'オート待ち時間',
  'ui.settings.skipMode': 'スキップ範囲',
  'ui.settings.skip.read': '既読のみ',
  'ui.settings.skip.all': 'すべて',
  'ui.settings.vol.music': '音楽',
  'ui.settings.vol.ambience': '環境音',
  'ui.settings.vol.sfx': '効果音',
  'ui.settings.vol.voice': 'ボイス',
  'ui.settings.language': '言語',
  'ui.settings.fullscreen': '全画面',
  'ui.settings.dialogOpacity': 'セリフ枠',
  'ui.settings.uiScale': '文字サイズ',
  'ui.settings.on': 'オン',
  'ui.settings.off': 'オフ',
  'ui.saves.autoSlot': 'オート',
  'ui.saves.quickSlot': 'クイック',
  'ui.saves.empty': '空きスロット',
  'ui.saves.delete': '削除',
  'ui.saves.msg.saved': '保存しました',
  'ui.saves.msg.overwrite': 'このセーブを上書きしますか？',
  'ui.saves.msg.delete': 'このセーブを削除しますか？',
  'ui.saves.msg.failed': '保存に失敗しました（空き容量不足）',
  'ui.saves.msg.mismatch': 'セーブデータがこのバージョンと一致しません',
  'ui.saves.msg.noQuick': 'クイックセーブがありません',
  'ui.backlog.empty': 'まだセリフがありません',
  'ui.backlog.playVoice': 'ボイスを再生',
  'ui.replays.locked': '未解放——まず本編でこの場面まで進めてください',
  'ui.msg.restartConfirm': '最初に戻りますか？保存していない進行状況は失われます。',
  'ui.msg.toTitleConfirm': 'タイトルに戻りますか？保存していない進行状況は失われます。',
  'ui.dialog.ok': 'OK',
  'ui.dialog.cancel': 'キャンセル',
}

/** The ids the engine's own chrome uses (a host override targets these). */
export const CHROME_STRING_IDS: readonly string[] = Object.freeze(Object.keys(en))

const catalogs: Record<string, Catalog> = { en, zh, ja }

let current = BASE

/** Set the module-level default chrome language (used when `tUI` gets no
 *  explicit language). The engine no longer sets it — plugins pass `engine.lang`. */
export function setUILang(lang: string): void {
  current = lang
}

export function getUILang(): string {
  return current
}

/** Resolve a chrome string by its dotted id (`lang` → en → id). `{name}`
 *  placeholders are filled from `params`. Pass the engine's own language: the
 *  module-level default (`setUILang`) is a legacy convenience — two engines on
 *  one page each speak their own work's language. */
export function tUI(id: string, params?: Record<string, string | number>, lang: string = current): string {
  const tpl = catalogs[lang]?.[id] ?? catalogs[BASE]?.[id] ?? id
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`))
}

/** Display name for a language code, used by the in-game language switcher. */
const LANG_NAMES: Record<string, string> = { zh: '中文', ja: '日本語', en: 'English' } // i18n-ignore
export function uiLangName(lang: string): string {
  return LANG_NAMES[lang] ?? lang
}
