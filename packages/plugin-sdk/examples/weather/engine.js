// com.example.weather — falling rain / snow over the stage.
// One self-contained ES module: a carried plugin is imported from a blob:/data:
// URL, where relative imports cannot resolve.

const KINDS = {
  rain: { asset: 'assets/raindrop.svg', max: 140, size: [0.8, 1.4], duration: [0.45, 0.8], drift: 3 },
  snow: { asset: 'assets/snowflake.svg', max: 90, size: [1.2, 2.6], duration: [5, 11], drift: 6 },
}
const ID = 'com.example.weather'
const CLEAR = 'clear'
const STATE_VERSION = 2

// Per-activation state: `perActivation` from @nilvn/plugin-sdk, inlined because
// this example ships without a build step. The host hands the same context to
// activate, commands (`plugin`), hooks and the save-slice methods; the entry goes
// when the plugin is released.
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
const state = perActivation(() => ({ layer: null, kind: CLEAR, intensity: 0, hiddenByPlayer: false }))

const clamp01 = (n) => Math.min(1, Math.max(0, n))
const between = ([lo, hi]) => lo + Math.random() * (hi - lo)
const isKind = (k) => k === CLEAR || Object.hasOwn(KINDS, k)

function authorIntensity(ctx) {
  const n = Number(ctx.config.get('intensity'))
  return Number.isFinite(n) ? clamp01(n) : 0.6
}

function draw(ctx, s) {
  const { layer } = s
  if (!layer) return
  layer.replaceChildren()
  layer.dataset.kind = s.kind
  if (s.kind === CLEAR) return
  const spec = KINDS[s.kind]
  const url = ctx.asset(spec.asset)
  if (!url) return // ctx.asset has already reported the missing file
  // The SVG is a mask: its shape is ours, its colour comes from the theme (main.css).
  layer.style.setProperty('--exw-shape', `url("${url.replace(/"/g, '%22')}")`)
  const doc = layer.ownerDocument
  const frag = doc.createDocumentFragment()
  const count = Math.round(spec.max * s.intensity)
  for (let i = 0; i < count; i++) {
    const p = doc.createElement('span')
    const duration = between(spec.duration)
    p.className = 'exw-p'
    p.style.setProperty('--x', `${(Math.random() * 100).toFixed(2)}%`)
    p.style.setProperty('--size', `${between(spec.size).toFixed(2)}cqh`)
    p.style.setProperty('--dur', `${duration.toFixed(2)}s`)
    // A negative delay starts every particle mid-fall, so the screen is not empty for a beat.
    p.style.setProperty('--delay', `${(-Math.random() * duration).toFixed(2)}s`)
    p.style.setProperty('--drift', `${((Math.random() * 2 - 1) * spec.drift).toFixed(2)}cqw`)
    frag.append(p)
  }
  layer.append(frag)
}

function syncVisibility(ctx, s) {
  const visible = ctx.config.get('enabled') !== false && !s.hiddenByPlayer
  s.layer?.classList.toggle('is-hidden', !visible)
}

function setWeather(ctx, s, kind, intensity, { writeVars = true } = {}) {
  s.kind = kind
  s.intensity = kind === CLEAR ? 0 : clamp01(intensity)
  if (writeVars) {
    ctx.vars?.set('kind', s.kind)
    ctx.vars?.set('intensity', s.intensity)
  }
  draw(ctx, s)
}

export default {
  id: ID, // permissions live in plugin.json
  stateVersion: STATE_VERSION,

  commands: {
    // [weather rain|snow|clear intensity=0..1]
    weather({ str, numOpt, plugin: ctx }) {
      const s = state(ctx)
      const kind = str(0, '').trim().toLowerCase() // `kind` is positional 0
      if (!isKind(kind)) {
        ctx.report(`[weather]: unknown kind "${kind}" — use rain, snow or clear`)
        return
      }
      const given = numOpt('intensity')
      setWeather(ctx, s, kind, given ?? authorIntensity(ctx))
    },
  },

  hooks: {
    // Every session entry (new game, restart, load) and exit (title, ending) starts
    // clear. On a load this fires before restoreState, which puts the saved weather back.
    onSessionChange(session, prev, ctx) {
      setWeather(ctx, state(ctx), CLEAR, 0, { writeVars: session === 'playing' })
    },
  },

  saveState(ctx) {
    const s = state(ctx)
    return { kind: s.kind, intensity: s.intensity }
  },

  restoreState(ctx, data) {
    const s = state(ctx)
    const kind = isKind(data?.kind) ? data.kind : CLEAR
    const intensity = typeof data?.intensity === 'number' ? data.intensity : authorIntensity(ctx)
    setWeather(ctx, s, kind, intensity)
  },

  // Slice v1 (plugin 1.0.x) stored only the kind; v2 adds the intensity.
  migrateState(data, from) {
    if (from === 1) return { kind: data?.kind ?? CLEAR, intensity: null }
    return data
  },

  activate(ctx) {
    // Over the picture, under the dialogue box.
    const layer = ctx.ui?.layer('exw-layer', { over: 'scene' })
    if (!(layer instanceof Element)) {
      ctx.report('no stage layer available (ui.layer not granted, or a sandboxed host): weather is tracked but not drawn')
    }
    const s = state(ctx)
    s.layer = layer instanceof Element ? layer : null
    syncVisibility(ctx, s)

    ctx.input?.on('toggle', () => {
      s.hiddenByPlayer = !s.hiddenByPlayer
      syncVisibility(ctx, s)
    })

    // The player's on/off switch can change while the story runs (settings screen);
    // the subscription is released with the plugin.
    ctx.config.onChange(() => syncVisibility(ctx, s))
  },

  // The layer, stylesheet, key handler, config subscription and our state are all
  // released by the host — no deactivate needed.
}
