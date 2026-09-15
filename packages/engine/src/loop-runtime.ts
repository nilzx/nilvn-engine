// LoopRuntime — recording event-frames and single-element loops, split out of engine.ts. Owns every rAF-driven
// clock the engine runs: blocking event-frames (with their channel claims),
// background loops (one per object), and the transient bridge tweens that ease a
// loop in from / out to the live pose. The engine reaches channels through the
// host (its recordable descriptors); a session change stops everything here.

import { playEventFrame, playLoop } from './keyframes.js'
import type { DecodedFrame, DecodedTrack, FramePlayerHost, RunningFrame } from './keyframes.js'

/** Bridge tween duration: a loop with an `intoEase` / `outEase` eases from the live
 *  pose into its entry (or out to its exit) over this fixed span instead of
 *  snapping. The easing is authored per-loop; the
 *  span is a constant. */
const BRIDGE_SEC = 0.3
/** A continuous channel only bridges when the live value differs from the target by
 *  at least this much — so a loop whose entry already equals the current pose (idle
 *  presets / clips rebased to the live pose) skips the no-op tween and starts at once. */
const BRIDGE_EPS = 1e-3

/** Key into the event-frame channel-claim set: a loop
 *  cedes any (object, channel) an event-frame is currently playing. JSON-joined so
 *  no real objId / channel id can collide on the boundary. */
const claimKey = (objId: string, chId: string): string => JSON.stringify([objId, chId])

/** A running single-element loop captured for save / restore. Stores the loop's
 *  defining data — the `entry` anchor pose and the reusable `body` cycle — but NOT
 *  its phase: a load restarts the cycle from `entry`, so a channel a loop occupies
 *  restores to its anchor (not a mid-phase value), avoiding a load-time
 *  jump. `into` is carried for the bridge-in easing (applied
 *  as a tween later; the runtime snaps to entry for now). */
export interface SavedLoop {
  objId: string
  duration: number
  entry: Record<string, string>
  body: DecodedFrame[]
  into?: string
}

export interface LoopHost {
  /** Write one channel value through the object's recordable descriptor. */
  applyRecordable(objId: string, chId: string, value: number | string): void
  /** The channel's interpolation mode, or undefined when undeclared. */
  recordableMode(objId: string, chId: string): 'continuous' | 'discrete' | undefined
  /** The channel's live value (continuous channels only matter here). */
  readChannel(objId: string, chId: string): number | string | boolean | undefined
  /** Current play-session generation (event-frames retire on a mismatch). */
  generation(): number
  destroyed(): boolean
}

export class LoopRuntime {
  /** Active rAF-driven event-frames. A load / restart / destroy stops them so a new
   *  play session starts clean — the JS clock owns the handle, which is what makes a
   *  running animation stoppable. */
  private rafAnims = new Set<RunningFrame>()
  /** Single-element loops running in the background, keyed by target object id
   *  (one loop per object — a new loop on the same object replaces it). */
  private activeLoops = new Map<string, { run: { stop(): void }; spec: SavedLoop }>()
  /** Transient cosmetic bridge tweens settling a just-stopped loop to its exit pose
   *  The `exit` pose is kept so a snapshot taken mid-bridge can
   *  finalize to it (a stopped loop is not in `activeLoops`, so restore would NOT
   *  re-settle it). */
  private exitBridges = new Map<string, { run: RunningFrame; exit: Record<string, string> }>()
  /** (object, channel) pairs an in-flight event-frame is currently playing; a loop
   *  cedes these while claimed and resumes after (channel arbitration, §3). */
  private frameClaims = new Set<string>()

  constructor(private readonly host: LoopHost) {}

  /** Play a decoded recording event-frame to completion (blocking). Registered so
   *  a load / restart / destroy can stop it; generation-guarded so a superseded
   *  play session's clock aborts without committing the end pose. */
  async playFrames(durationSec: number, tracks: DecodedTrack[]): Promise<void> {
    const gen = this.host.generation()
    // Claim every (object, channel) this event-frame touches so any loop on those
    // objects cedes the shared channels for the duration (the event-frame wins, the
    // loop resumes after —). Event-frames are blocking, so
    // at most one plays at a time and a plain add/delete needs no ref-counting.
    const claims: string[] = []
    for (const tr of tracks) for (const k of tr.keys) for (const chId in k.ch) {
      const key = claimKey(tr.objId, chId)
      if (!this.frameClaims.has(key)) {
        this.frameClaims.add(key)
        claims.push(key)
      }
    }
    // Release the claims on ANY exit — including a throw from playEventFrame's
    // synchronous setup (its kf0 tick) — so a failed event-frame can never strand a
    // claim and freeze loops on those channels forever. The outer finally owns the
    // claims; the inner one owns the registry entry.
    try {
      const anim = playEventFrame(
        {
          // Event-frames own the channels they touch (they hold the claims), so a write
          // always lands.
          apply: (objId, chId, value) => {
            this.host.applyRecordable(objId, chId, value)
            return true
          },
          resolveMode: (objId, chId) => this.host.recordableMode(objId, chId),
          alive: () => !this.host.destroyed() && gen === this.host.generation(),
        },
        durationSec,
        tracks,
      )
      this.rafAnims.add(anim)
      try {
        await anim.done
      } finally {
        this.rafAnims.delete(anim)
      }
    } finally {
      for (const key of claims) this.frameClaims.delete(key)
    }
  }

  /** Stop every active event-frame and release its channel claims (load / restart /
   *  destroy). Loops are stopped separately via {@link cancelLoops}. */
  cancelRafAnims(): void {
    for (const a of [...this.rafAnims]) a.stop()
    this.rafAnims.clear()
    this.frameClaims.clear()
  }

  /** The claim-checking player host a loop (and its bridge tweens) write through: a
   *  channel an event-frame is currently playing is ceded (channel arbitration, §3). */
  private loopHost(): FramePlayerHost {
    return {
      apply: (id, chId, value) => {
        // A channel an event-frame is currently claiming is ceded — the write is dropped
        // and reported as not-landed so the loop re-asserts it after the claim releases.
        if (this.frameClaims.has(claimKey(id, chId))) return false
        this.host.applyRecordable(id, chId, value)
        return true
      },
      resolveMode: (id, chId) => this.host.recordableMode(id, chId),
      // Loops are cancelled explicitly on every session change (cancelLoops), so a
      // plain destroyed-guard is enough — no generation coupling needed.
      alive: () => !this.host.destroyed(),
    }
  }

  /** The live numeric value of each CONTINUOUS channel named in `channels` (its
   *  current on-stage pose), the source the bridge tween eases away from. */
  private continuousFrom(objId: string, channels: Record<string, string>): Record<string, number> {
    const from: Record<string, number> = {}
    for (const chId in channels) {
      if (this.host.recordableMode(objId, chId) !== 'continuous') continue
      const cur = this.host.readChannel(objId, chId)
      if (typeof cur === 'number') from[chId] = cur
    }
    return from
  }

  /** Whether to ease (vs. snap) into `target`: only when an easing is authored (and
   *  not the step `hold`) AND some continuous channel actually moves (else the tween
   *  is a no-op and would just delay the loop). */
  private shouldBridge(ease: string | undefined, from: Record<string, number>, target: Record<string, string>): boolean {
    if (!ease || ease === 'hold') return false
    for (const chId in from) {
      const to = parseFloat(target[chId]!)
      if (Number.isFinite(to) && Math.abs(to - from[chId]!) > BRIDGE_EPS) return true
    }
    return false
  }

  /** A one-shot tween easing the continuous channels from their live pose to `target`
   *  over {@link BRIDGE_SEC}, via the shared event-frame player (same interpolation
   *  core, same hidden-page snap-to-end fallback). Discrete channels are not bridged
   *  (they snap when the caller settles the anchor). */
  private playBridge(objId: string, from: Record<string, number>, target: Record<string, string>, ease: string): RunningFrame {
    const fromCh: Record<string, string> = {}
    const toCh: Record<string, string> = {}
    for (const chId in from) {
      const to = parseFloat(target[chId]!)
      if (!Number.isFinite(to)) continue
      fromCh[chId] = String(from[chId])
      toCh[chId] = String(to)
    }
    const keys: DecodedFrame[] = [
      { t: 0, ch: fromCh, ease },
      { t: BRIDGE_SEC, ch: toCh },
    ]
    return playEventFrame(this.loopHost(), BRIDGE_SEC, [{ objId, keys }])
  }

  /** The defining data of every loop running now (entry + body, no phase — §4).
   *  This is what the animstudio plugin persists into its SaveState.ext slice. */
  runningLoops(): SavedLoop[] {
    return [...this.activeLoops.values()].map((e) => e.spec)
  }

  /** Begin (or replace) a single-element loop on an object: settle the `entry` anchor
   *  pose, then play `body` on repeat through a background rAF clock. Non-blocking —
   *  returns at once; the loop runs until {@link stopLoop}, a new loop on the same
   *  object, or a load / restart / destroy. The loop's `apply` yields any channel an
   *  event-frame is currently playing (channel arbitration). With `intoEase` set and a
   *  pose change to make, the element eases from its live pose into the anchor before
   *  the cycle starts (`bridge` is false on restore so a load lands instantly, §4). */
  startLoop(objId: string, durationSec: number, entry: Record<string, string>, body: DecodedFrame[], intoEase?: string, bridge = true): void {
    this.stopLoopRun(objId)
    this.stopExitBridge(objId) // a pending settle on this object is superseded
    // Capture the live pose BEFORE settling, so a bridge can ease away from it.
    const from = this.continuousFrom(objId, entry)
    // Settle the anchor (held channels + body baseline + discrete snaps) into the
    // resting model, so save / restage are correct even mid-bridge.
    for (const [chId, v] of Object.entries(entry)) this.host.applyRecordable(objId, chId, v)
    const spec: SavedLoop = { objId, duration: durationSec, entry, body, into: intoEase }
    const startBody = (): void => {
      const e = this.activeLoops.get(objId)
      if (!e || e.spec !== spec) return // superseded / stopped during the bridge
      e.run = playLoop(this.loopHost(), objId, durationSec, body)
    }
    if (bridge && this.shouldBridge(intoEase, from, entry)) {
      // Ease in first; the cycle starts when the bridge resolves. The registry holds
      // the bridge as the loop's current handle, so a stop mid-bridge cancels it and
      // a save mid-bridge still captures the loop (spec) for restore.
      const br = this.playBridge(objId, from, entry, intoEase!)
      this.activeLoops.set(objId, { run: br, spec })
      void br.done.then(startBody)
    } else {
      this.activeLoops.set(objId, { run: playLoop(this.loopHost(), objId, durationSec, body), spec })
    }
  }

  /** Stop the loop running on `objId` and settle the object to its `exit` pose,
   *  committed to the resting model. With `outEase` set and a pose change
   *  to make, a cosmetic bridge eases the element from its live (mid-cycle) pose to the
   *  exit on top of the already-settled model. Idempotent — a [loopstop] without a
   *  running loop just applies the settle pose.
   *
   *  Known limitation (same shape as a running loop / the entry bridge): the cosmetic
   *  settle keeps writing the object's continuous channels for ~BRIDGE_SEC and, like a
   *  loop, yields only to an in-flight event-frame's channel claims — not to an ordinary
   *  command. So an opt-in eased stop immediately followed by a continuous-channel
   *  command on the SAME object (within ~0.3s) is overridden by the settle. Rare and
   *  bounded; a new loop op or a session change cancels the bridge at once. */
  stopLoop(objId: string, exit: Record<string, string>, outEase?: string): void {
    this.stopLoopRun(objId)
    this.stopExitBridge(objId)
    const from = this.continuousFrom(objId, exit)
    for (const [chId, v] of Object.entries(exit)) this.host.applyRecordable(objId, chId, v)
    if (this.shouldBridge(outEase, from, exit)) {
      const br = this.playBridge(objId, from, exit, outEase!)
      this.exitBridges.set(objId, { run: br, exit })
      void br.done.then(() => {
        if (this.exitBridges.get(objId)?.run === br) this.exitBridges.delete(objId)
      })
    }
  }

  /** Finalize every in-flight exit-settle bridge to its exit pose (stop the rAF +
   *  re-apply exit). Called before a snapshot so a save taken mid-bridge persists the
   *  settled exit rather than a transient mid-tween pose — a stopped loop is not in
   *  `activeLoops`, so restore would otherwise reload it frozen off-pose. */
  settleExitBridges(): void {
    for (const [objId, b] of this.exitBridges) {
      b.run.stop()
      for (const [chId, v] of Object.entries(b.exit)) this.host.applyRecordable(objId, chId, v)
    }
    this.exitBridges.clear()
  }

  /** Cancel a loop's clock (entry bridge or running cycle) without settling — replace
   *  / load / restart. */
  private stopLoopRun(objId: string): void {
    const entry = this.activeLoops.get(objId)
    if (entry) {
      entry.run.stop()
      this.activeLoops.delete(objId)
    }
  }

  /** Cancel a just-stopped loop's transient settle bridge, if any. */
  private stopExitBridge(objId: string): void {
    const b = this.exitBridges.get(objId)
    if (b) {
      b.run.stop()
      this.exitBridges.delete(objId)
    }
  }

  /** Stop every running loop (and any settle bridge), leaving the stage as-is for
   *  restore (load / restart / destroy). A load then restarts the saved loops from
   *  their entry pose. */
  cancelLoops(): void {
    for (const entry of this.activeLoops.values()) entry.run.stop()
    this.activeLoops.clear()
    for (const b of this.exitBridges.values()) b.run.stop()
    this.exitBridges.clear()
  }

  /** Stop every clock (destroy). */
  destroy(): void {
    this.cancelRafAnims()
    this.cancelLoops()
  }
}
