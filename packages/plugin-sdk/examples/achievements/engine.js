// com.example.achievements — [achieve id] unlocks an achievement that stays unlocked
// across playthroughs, with a toast the first time and a screen listing them all.
// One self-contained ES module: a carried plugin is imported from a blob:/data:
// URL, where relative imports cannot resolve.

const STORE_KEY = 'unlocked'
const SCREEN_ID = 'list'
const ITEM_ID = 'achievements'

// Per-activation state: `perActivation` from @nilvn/plugin-sdk, inlined because
// this example ships without a build step. The host hands the same context to
// activate, commands (`plugin`) and hooks; the entry goes when the plugin is released.
function perActivation(init) {
  const live = new WeakMap()
  return (ctx) => {
    if (!live.has(ctx)) {
      live.set(ctx, init(ctx))
      ctx.onDispose(() => live.delete(ctx))
    }
    return live.get(ctx)
  }
}
const state = perActivation(() => ({ unlocked: new Set(), view: null, ready: Promise.resolve() }))

// The author's list (a `list` setting: an array of ids).
function configuredIds(ctx) {
  const list = ctx.config.get('list')
  return Array.isArray(list) ? [...new Set(list.map(String).filter(Boolean))] : []
}

function displayName(ctx, id) {
  const key = `plugin.achievements.a.${id}`
  const text = ctx.t(key)
  return text && text !== key ? text : id
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function render(ctx, s, root) {
  s.view = root
  const doc = root.ownerDocument
  const listed = configuredIds(ctx)
  // Unlocked ids the list no longer names still show, after the listed ones.
  const ids = [...listed, ...[...s.unlocked].filter((id) => !listed.includes(id))]
  const done = ids.filter((id) => s.unlocked.has(id)).length
  const badge = ctx.asset('assets/badge.svg')

  const wrap = el(doc, 'div', 'exa-screen')
  if (!ids.length) {
    wrap.append(el(doc, 'p', 'exa-empty', ctx.t('plugin.achievements.screen.empty')))
    root.replaceChildren(wrap)
    return
  }
  wrap.append(el(doc, 'p', 'exa-progress',
    ctx.t('plugin.achievements.screen.progress', { done, total: ids.length })))

  const list = el(doc, 'ul', 'exa-list')
  for (const id of ids) {
    const unlocked = s.unlocked.has(id)
    const item = el(doc, 'li', `exa-item ${unlocked ? 'is-unlocked' : 'is-locked'}`)
    const icon = el(doc, 'img', 'exa-badge')
    if (badge) icon.src = badge
    icon.alt = ''
    const text = el(doc, 'div', 'exa-text')
    text.append(el(doc, 'span', 'exa-name', displayName(ctx, id)))
    if (!unlocked) text.append(el(doc, 'span', 'exa-state', ctx.t('plugin.achievements.screen.locked')))
    item.append(icon, text)
    list.append(item)
  }
  wrap.append(list)
  root.replaceChildren(wrap)
}

function openScreen(ctx, s) {
  ctx.screen?.open(SCREEN_ID, ctx.t('plugin.achievements.screen.title'), (root) => render(ctx, s, root))
}

async function loadUnlocked(ctx, s) {
  if (!ctx.storage) {
    ctx.report('storage.local not granted: achievements last only for this page')
    return
  }
  try {
    const saved = await ctx.storage.get(STORE_KEY)
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string') s.unlocked.add(id)
  } catch (error) {
    ctx.report('could not read unlocked achievements', error)
  }
}

export default {
  id: 'com.example.achievements', // permissions live in plugin.json

  commands: {
    // [achieve id]
    async achieve({ str, plugin: ctx }) {
      const s = state(ctx)
      const id = str(0, '').trim() // `id` is positional 0
      if (!id) {
        ctx.report('[achieve] needs an achievement id')
        return
      }
      await s.ready
      if (s.unlocked.has(id)) return
      if (!configuredIds(ctx).includes(id)) {
        ctx.report(`[achieve ${id}]: not in the configured list — unlocked anyway`)
      }
      s.unlocked.add(id)
      try {
        await ctx.storage?.set(STORE_KEY, [...s.unlocked])
      } catch (error) {
        ctx.report('could not store unlocked achievements', error)
      }
      if (ctx.config.get('toasts') !== false) {
        ctx.dialog?.toast(ctx.t('plugin.achievements.toast', { name: displayName(ctx, id) }))
      }
      if (s.view?.isConnected) render(ctx, s, s.view)
    },
  },

  async activate(ctx) {
    const s = state(ctx)
    // Commands wait on this, so an early [achieve] cannot overwrite the stored set.
    s.ready = loadUnlocked(ctx, s)

    const open = () => openScreen(ctx, s)
    ctx.screen?.menuItem(ITEM_ID, open)
    ctx.screen?.titleItem(ITEM_ID, open)
    // The key toggles: a second press closes the screen again.
    ctx.input?.on('open', () => (ctx.screen?.isOpen(SCREEN_ID) ? ctx.screen.close(SCREEN_ID) : open()))

    await s.ready
  },

  // The screen, menu / title entries, key handler, stylesheet and our state are
  // all released by the host — no deactivate needed.
}
