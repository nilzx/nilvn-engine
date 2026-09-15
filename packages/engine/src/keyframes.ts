// Recording event-frame runtime: a pure-JS rAF clock
// player plus the interpolation core it shares with the editor's scrub preview.
//
// Why pure JS and not WAAPI: discrete channels must snap at an exact time
// (setProp), WAAPI `fill:auto` reverts the end pose, custom tweens aren't bound by
// CSS, and — the biggest win — the editor scrub must compute a pose at any `t`
// using the *same* interpolation as the engine. So the sampling functions here
// (`sampleContinuous` / `discreteAt` / `easeFn`) are the one shared core; the rAF
// loop on top is engine-only. `[anim]` / `animate()` keep their WAAPI path as a
// low-level primitive — this is a separate, additive player.

/** A decoded keyframe: channel values stay as raw wire strings; the player
 *  coerces per channel mode (continuous → number, discrete → the descriptor
 *  coerces). `ease` is the segment easing code into the next keyframe. */
export interface DecodedFrame {
  t: number
  ch: Record<string, string>
  ease?: string
}

export interface DecodedTrack {
  objId: string
  keys: DecodedFrame[]
}

/** Decode the compact `kf` token emitted by core's `serializeEventFrame` (keep the
 *  two in sync). Grammar:
 *    kf    = TRACK ("|" TRACK)*
 *    TRACK = <objId> "#" FRAME (";" FRAME)*
 *    FRAME = <t> ["~" <easeCode>] [":" CH ("," CH)*]
 *    CH    = <chId> "=" <value>
 *  Malformed pieces are skipped rather than thrown, so a hand-authored or imported
 *  token can never strand playback. Keyframes are sorted by `t` (the encoder emits
 *  them in order, but a hand-written node may not). */
export function decodeTracks(kf: string): DecodedTrack[] {
  const tracks: DecodedTrack[] = []
  if (!kf) return tracks
  for (const traw of kf.split('|')) {
    if (!traw) continue
    const hash = traw.indexOf('#')
    if (hash <= 0) continue
    const objId = traw.slice(0, hash)
    const keys = decodeFrames(traw.slice(hash + 1))
    if (keys.length) tracks.push({ objId, keys })
  }
  return tracks
}

/** Decode one track's frame list — `FRAME (";" FRAME)*` — into sorted keyframes.
 *  Shared by `decodeTracks` (event-frame tracks) and the loop runtime (a loop's
 *  `body=` rides the same grammar, just without the `objId#` track prefix). */
export function decodeFrames(framesStr: string): DecodedFrame[] {
  const keys: DecodedFrame[] = []
  for (const fraw of framesStr.split(';')) {
    if (!fraw) continue
    const colon = fraw.indexOf(':')
    const head = colon < 0 ? fraw : fraw.slice(0, colon)
    const tilde = head.indexOf('~')
    const t = parseFloat(tilde < 0 ? head : head.slice(0, tilde))
    if (!Number.isFinite(t)) continue
    const ease = tilde < 0 ? undefined : head.slice(tilde + 1) || undefined
    const ch = colon >= 0 ? decodeChannelSet(fraw.slice(colon + 1)) : {}
    keys.push({ t, ch, ease })
  }
  keys.sort((a, b) => a.t - b.t)
  return keys
}

/** Decode a bare channel set — `CH ("," CH)*`, each `chId "=" value` — into a map
 *  of raw wire values. Backs a frame's `ch` and a loop's `entry=` / `exit=` poses.
 *  A malformed pair (no `=`, or an empty id) is skipped, never thrown. */
export function decodeChannelSet(s: string): Record<string, string> {
  const ch: Record<string, string> = {}
  for (const ctok of s.split(',')) {
    if (!ctok) continue
    const eq = ctok.indexOf('=')
    if (eq <= 0) continue
    ch[ctok.slice(0, eq)] = ctok.slice(eq + 1)
  }
  return ch
}

// ---- easing (pure JS, CSS-cubic-bezier matched) ----
// Control points mirror the CSS keyword timing functions, so the JS clock and a
// future CSS path agree. `hold` is a step: the left value holds until the next
// keyframe (the player switches segments there). An unknown code falls back to
// linear — it can never throw (unlike feeding a bad string to WAAPI).

const EASE_BEZIER: Record<string, readonly [number, number, number, number]> = {
  lin: [0, 0, 1, 1],
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  io: [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1], // gentle overshoot
}

/** A cubic-bezier(x1,y1,x2,y2) timing function evaluator: maps progress x∈[0,1] to
 *  eased y. Newton-Raphson to invert x(s), bisection fallback (the standard WebKit
 *  approach). Identity control points short-circuit to linear. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (x1 === y1 && x2 === y2) return (t) => t
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s
  const slopeX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx
  const solveX = (x: number): number => {
    let s = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x
      if (Math.abs(err) < 1e-6) return s
      const d = slopeX(s)
      if (Math.abs(d) < 1e-6) break
      s -= err / d
    }
    let lo = 0
    let hi = 1
    s = x
    for (let i = 0; i < 24 && lo < hi; i++) {
      const err = sampleX(s) - x
      if (Math.abs(err) < 1e-6) break
      if (err > 0) hi = s
      else lo = s
      s = (lo + hi) / 2
    }
    return s
  }
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solveX(t)))
}

const easeCache = new Map<string, (t: number) => number>()
const HOLD = (): number => 0

/** Resolve an easing code to a pure-JS easing function. `undefined` / unknown →
 *  linear; `hold` → step-end (value holds until the next keyframe). */
export function easeFn(code?: string): (t: number) => number {
  if (code === 'hold') return HOLD
  const key = code ?? 'lin'
  let fn = easeCache.get(key)
  if (!fn) {
    const cp = EASE_BEZIER[key] ?? EASE_BEZIER.lin!
    fn = cubicBezier(cp[0], cp[1], cp[2], cp[3])
    easeCache.set(key, fn)
  }
  return fn
}

// ---- sampling (the shared interpolation core) ----

/** The keyframes of a track that actually define `chId`, as numeric points. The
 *  segment easing is the left endpoint's `ease` (the easing into the next keyframe
 *  of this channel — sparse channels skip over keyframes that don't touch them). */
function definingPoints(keys: DecodedFrame[], chId: string): { t: number; v: number; ease?: string }[] {
  const pts: { t: number; v: number; ease?: string }[] = []
  for (const k of keys) {
    const raw = k.ch[chId]
    if (raw === undefined) continue
    const v = parseFloat(raw)
    if (Number.isFinite(v)) pts.push({ t: k.t, v, ease: k.ease })
  }
  return pts
}

/** Value of a continuous channel at time `t`, interpolated between the channel's
 *  surrounding defining keyframes (clamped at the ends). `undefined` when the
 *  channel is never defined on this track. */
export function sampleContinuous(keys: DecodedFrame[], chId: string, t: number): number | undefined {
  const pts = definingPoints(keys, chId)
  if (pts.length === 0) return undefined
  if (t <= pts[0]!.t) return pts[0]!.v
  const last = pts[pts.length - 1]!
  if (t >= last.t) return last.v
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    if (t < b.t) {
      const span = b.t - a.t
      const localT = span > 0 ? (t - a.t) / span : 1
      const eased = easeFn(a.ease)(localT)
      return a.v + (b.v - a.v) * eased
    }
  }
  return last.v
}

/** Carry-forward continuous sampling for AUTHORED event frames. A keyframe stores only the channels it changed; a channel it omits inherits
 *  ("carries forward") the previous keyframe's value, so EVERY keyframe has a complete
 *  effective pose (kf0 is a full snapshot, the carry-forward seed). Interpolation runs
 *  between the effective values of the two TEMPORALLY-ADJACENT keyframes — so a change
 *  is always contained between neighbouring keyframes and never bleeds across a third
 *  (the per-channel `sampleContinuous`, by contrast, interpolates between a channel's
 *  own sparse defining points, which lets a late single-channel key slide from far
 *  earlier). The segment easing is the left keyframe's `ease`. `undefined` when the
 *  channel is never defined on the track.
 *
 *  Authored loops (R2) use this sampler too: a loop body is now sparse keyframes (the
 *  real-time RDP recorder was retired), so carry-forward gives each body keyframe a
 *  complete effective pose exactly like an event frame. The older per-channel
 *  `sampleContinuous` is kept only as a reference for the historical contrast above. */
export function sampleContinuousCarry(keys: DecodedFrame[], chId: string, t: number): number | string | undefined {
  const n = keys.length
  if (n === 0) return undefined
  // Effective value at keyframe index i: this key's own value, else the nearest earlier
  // key that defines the channel (undefined if never defined at/before i).
  const eff = (i: number): Sampled | undefined => {
    for (let j = i; j >= 0; j--) {
      const raw = keys[j]!.ch[chId]
      if (raw !== undefined) {
        const s = parseSampled(raw)
        if (s) return s
      }
    }
    return undefined
  }
  if (t <= keys[0]!.t) return outSampled(eff(0))
  if (t >= keys[n - 1]!.t) return outSampled(eff(n - 1))
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i]!
    const b = keys[i + 1]!
    if (t < b.t) {
      const va = eff(i)
      const vb = eff(i + 1)
      if (va === undefined) return outSampled(vb) // channel introduced later — hold its first value
      if (vb === undefined) return outSampled(va)
      const span = b.t - a.t
      const localT = span > 0 ? (t - a.t) / span : 1
      // Percent is contagious: a bare 0 is unit-agnostic, and mixing a legacy pixel
      // value with a percent one (only reachable by editing a track authored before
      // percent panning) is better read in percent than silently re-scaled.
      return outSampled({ v: va.v + (vb.v - va.v) * easeFn(a.ease)(localT), pct: va.pct || vb.pct })
    }
  }
  return outSampled(eff(n - 1))
}

/** A parsed wire value plus whether it carried a `%` unit. Percent lengths are how a
 *  resolution-independent camera pan is authored (a percent of the stage box), so the
 *  unit has to survive interpolation instead of collapsing to pixels. */
interface Sampled {
  v: number
  pct: boolean
}

function parseSampled(raw: string): Sampled | undefined {
  const v = parseFloat(raw)
  if (!Number.isFinite(v)) return undefined
  return { v, pct: raw.trimEnd().endsWith('%') }
}

function outSampled(s: Sampled | undefined): number | string | undefined {
  if (!s) return undefined
  return s.pct ? `${Math.round(s.v * 1000) / 1000}%` : s.v
}

/** Raw value of a discrete channel at time `t`: the latest keyframe at or before
 *  `t` that defines the channel (left-nearest snap). `undefined` when never set
 *  at/before `t`. */
export function discreteAt(keys: DecodedFrame[], chId: string, t: number): string | undefined {
  let val: string | undefined
  for (const k of keys) {
    if (k.t > t) break
    const raw = k.ch[chId]
    if (raw !== undefined) val = raw
  }
  return val
}

// ---- the rAF clock player ----

/** What the player needs from the engine to apply a channel and know its mode,
 *  without the player importing engine internals. */
export interface FramePlayerHost {
  /** Apply a channel value to a stage object (continuous → number; discrete → the
   *  raw wire string, which the channel descriptor coerces). Returns whether the write
   *  actually LANDED: a loop's host cedes a channel an event-frame is currently claiming
   *  (returns false), so a discrete channel must not memoize a ceded write as applied —
   *  else on claim-release the loop would skip re-asserting its own value. */
  apply(objId: string, chId: string, value: number | string): boolean
  /** This channel's mode on this object, or undefined when the object's kind does
   *  not declare the channel (then it is skipped). */
  resolveMode(objId: string, chId: string): 'continuous' | 'discrete' | undefined
  /** False once the play session this belongs to is superseded (load / destroy);
   *  the loop then aborts WITHOUT committing the end pose (load restores instead). */
  alive(): boolean
}

interface PlannedChannel {
  id: string
  mode: 'continuous' | 'discrete'
  /** Last applied discrete value, to skip redundant writes. */
  last?: string
}

interface PlannedTrack {
  objId: string
  keys: DecodedFrame[]
  channels: PlannedChannel[]
}

/** A running event-frame: its completion promise and a `stop()` that cancels the
 *  rAF and resolves `done` (used by the engine's active-animation registry). */
export interface RunningFrame {
  done: Promise<void>
  stop(): void
}

/** Play a one-shot event-frame on a real wall-clock (rAF). Each tick, every
 *  continuous channel is interpolated and applied; every discrete channel snaps to
 *  its left-nearest value (applied only on change). kf0 lands synchronously before
 *  the first paint; the exact last keyframe is committed at the end, so
 *  the resting model holds kfN when the awaited promise resolves and `runLoop`
 *  advances. */
export function playEventFrame(host: FramePlayerHost, durationSec: number, tracks: DecodedTrack[]): RunningFrame {
  const plan: PlannedTrack[] = tracks.map((tr) => {
    const ids = new Set<string>()
    for (const k of tr.keys) for (const id in k.ch) ids.add(id)
    const channels: PlannedChannel[] = []
    for (const id of ids) {
      const mode = host.resolveMode(tr.objId, id)
      if (mode) channels.push({ id, mode })
    }
    return { objId: tr.objId, keys: tr.keys, channels }
  })

  const tick = (t: number): void => {
    for (const tr of plan) {
      for (const c of tr.channels) {
        if (c.mode === 'continuous') {
          // Carry-forward: authored event-frame keyframes are sparse, so an unchanged
          // channel inherits the previous keyframe's value and the tween stays between
          // adjacent keyframes.
          const v = sampleContinuousCarry(tr.keys, c.id, t)
          if (v !== undefined) host.apply(tr.objId, c.id, v)
        } else {
          const v = discreteAt(tr.keys, c.id, t)
          // Only memoize once the write actually lands (a ceded write keeps `last` stale
          // so it re-asserts when the claim releases).
          if (v !== undefined && v !== c.last && host.apply(tr.objId, c.id, v)) c.last = v
        }
      }
    }
  }

  let raf = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let resolveDone!: () => void
  const done = new Promise<void>((r) => {
    resolveDone = r
  })
  const cleanup = (): void => {
    if (settled) return
    settled = true
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
    resolveDone()
  }

  const duration = durationSec > 0 ? durationSec : 0
  const start = performance.now()
  const finish = (): void => {
    if (host.alive()) tick(duration) // commit the exact end pose (no rAF-timing rounding)
    cleanup()
  }
  const step = (): void => {
    if (!host.alive()) return cleanup() // load/destroy: leave the stage for restore
    const elapsed = (performance.now() - start) / 1000
    if (elapsed >= duration) return finish()
    tick(elapsed)
    raf = requestAnimationFrame(step)
  }

  tick(0) // kf0 before first paint
  if (duration <= 0) {
    cleanup()
  } else {
    raf = requestAnimationFrame(step)
    // Wall-clock safety net: a hidden/backgrounded page fully pauses rAF, so the
    // step loop would never reach the end and the awaited beat would hang forever.
    // Mirror `animate()`'s fallback — once the clip's wall-clock is up, snap to the
    // end pose and finish (no intermediate frames when hidden; the player isn't
    // watching anyway). On a visible page rAF finishes first and clears this.
    timer = setTimeout(finish, duration * 1000 + 80)
  }

  return { done, stop: cleanup }
}

/** A running single-element loop: a handle to cancel its rAF clock. Held by the
 *  engine's loop registry so a `[loopstop]`, a replacing loop, or a load / restart /
 *  destroy can stop it (the JS clock owning the handle
 *  is what makes a running loop stoppable). */
export interface RunningLoop {
  stop(): void
}

/** Play a `body` cycle on repeat on one object through a background rAF
 *  clock. Each tick the clock wraps to `localT =
 *  elapsed % cycleSec`; every continuous channel is interpolated at `localT`, every
 *  discrete channel snaps to its left-nearest value (applied only on change). The
 *  loop is non-blocking and endless — it runs until `stop()` (or `host.alive()`
 *  turns false). Unlike an event-frame there is no wall-clock fallback: a loop has
 *  no end to reach, so a hidden page simply freezes it and it resumes when visible.
 *  Channel arbitration with event-frames is the engine's job: it wires a
 *  claim-checking `apply` so a channel an event-frame is currently playing is ceded
 *  (the loop's write is dropped) and resumed when the event-frame releases it. */
export function playLoop(host: FramePlayerHost, objId: string, cycleSec: number, body: DecodedFrame[]): RunningLoop {
  const channels: PlannedChannel[] = []
  const ids = new Set<string>()
  for (const k of body) for (const id in k.ch) ids.add(id)
  for (const id of ids) {
    const mode = host.resolveMode(objId, id)
    if (mode) channels.push({ id, mode })
  }

  const tick = (localT: number): void => {
    for (const c of channels) {
      if (c.mode === 'continuous') {
        // Carry-forward (same as event frames): authored loop bodies are sparse, so an
        // unchanged channel inherits the previous keyframe's value and the tween stays
        // between adjacent keyframes.
        const v = sampleContinuousCarry(body, c.id, localT)
        if (v !== undefined) host.apply(objId, c.id, v)
      } else {
        const v = discreteAt(body, c.id, localT)
        // Only memoize a landed write — a write ceded to an event-frame's channel claim
        // keeps `last` stale, so the loop re-asserts its value once the claim releases.
        if (v !== undefined && v !== c.last && host.apply(objId, c.id, v)) c.last = v
      }
    }
  }

  const cycle = cycleSec > 0 ? cycleSec : 0
  let raf = 0
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (raf) cancelAnimationFrame(raf)
  }
  const start = performance.now()
  const step = (): void => {
    if (stopped || !host.alive()) return stop()
    const elapsed = (performance.now() - start) / 1000
    tick(cycle > 0 ? elapsed % cycle : 0)
    raf = requestAnimationFrame(step)
  }

  tick(0) // land the entry/kf0 pose before the first paint
  // Only spin the clock when there is something to animate: a zero-length cycle or
  // an empty body (a degenerate / channel-less loop) just holds the entry pose.
  if (cycle > 0 && channels.length) raf = requestAnimationFrame(step)
  return { stop }
}
