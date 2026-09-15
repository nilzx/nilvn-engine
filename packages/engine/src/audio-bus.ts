// AudioBus — every <audio> element the engine owns, split out of
// engine.ts. The multi-track model: any number of
// named looping tracks play side by side, each on a bus — 'music' rides the music
// master, everything else the ambience master. One-shot sound effects, the
// per-line voice clip, and the backlog's replay clip live here too, so a single
// `destroy()` can silence and release all of them (and every timer / gesture
// listener they spawned). Volumes stay on the engine (plugins read them); the
// bus reads them back through its host.

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1)

export interface AudioHost {
  /** Live master volumes (0..1) per bus. */
  volumes(): { bgm: number; ambience: number; se: number; voice: number }
  /** True while a play session is running (gesture retries give up otherwise). */
  running(): boolean
}

export interface TrackOptions {
  loop?: boolean
  volume?: number
  fade?: number
}

interface TrackSlot {
  audio: HTMLAudioElement
  /** Authored volume, before the bus master multiplier. */
  base: number
  src: string
  loop: boolean
}

export class AudioBus {
  /** The classic BGM slot's track name. */
  static readonly MUSIC_TRACK = 'music'

  private loopTracks = new Map<string, TrackSlot>()
  private sounds = new Set<HTMLAudioElement>()
  /** The currently-playing per-line voice element, stopped on advance/destroy. */
  private voiceAudio: HTMLAudioElement | null = null
  /** A backlog-replay voice clip, stopped before the next replay / on session reset. */
  private backlogAudio: HTMLAudioElement | null = null
  private gestureCleanups = new Set<() => void>()
  private timers = new Set<ReturnType<typeof setInterval>>()
  /** True while a real per-line voice clip is playing; voicefx reads it (through
   *  the engine) to mute the synthesized typing blip for that line. */
  voicePlaying = false

  constructor(private readonly host: AudioHost) {}

  /** The bus master a named track scales by. */
  private trackMaster(track: string): number {
    const v = this.host.volumes()
    return track === AudioBus.MUSIC_TRACK ? v.bgm : v.ambience
  }

  /** Start (or replace) a named looping track. `fade` > 0 ramps the volume in from
   *  silence; the ramp re-derives its target each step so a live master change
   *  mid-fade still lands on the right level. */
  playTrack(track: string, url: string, opts: TrackOptions = {}): void {
    this.stopTrack(track, 0)
    const audio = this.watchAudio(new Audio(url), `track "${track}"`, url)
    audio.loop = opts.loop ?? true
    const slot: TrackSlot = { audio, base: opts.volume ?? 1, src: url, loop: audio.loop }
    const fade = opts.fade ?? 0
    audio.volume = fade > 0 ? 0 : clamp01(slot.base * this.trackMaster(track))
    this.loopTracks.set(track, slot)
    void audio.play().catch(() => this.resumeOnGesture(audio, () => this.loopTracks.get(track) === slot))
    if (fade > 0) {
      const stepFrac = 1 / Math.max(1, (fade * 1000) / 40)
      let frac = 0
      const timer = setInterval(() => {
        if (this.loopTracks.get(track) !== slot) {
          this.clearTimer(timer)
          return
        }
        frac = Math.min(1, frac + stepFrac)
        audio.volume = clamp01(slot.base * this.trackMaster(track) * frac)
        if (frac >= 1) this.clearTimer(timer)
      }, 40)
      this.timers.add(timer)
    }
  }

  /** Stop one named track, optionally fading it out. */
  stopTrack(track: string, fadeSec = 0): void {
    const slot = this.loopTracks.get(track)
    if (!slot) return
    this.loopTracks.delete(track)
    const audio = slot.audio
    if (fadeSec <= 0) {
      audio.pause()
      return
    }
    const step = audio.volume / Math.max(1, (fadeSec * 1000) / 40)
    const timer = setInterval(() => {
      audio.volume = Math.max(0, audio.volume - step)
      if (audio.volume <= 0) {
        this.clearTimer(timer)
        audio.pause()
      }
    }, 40)
    this.timers.add(timer)
  }

  /** Stop every looping track (load / restart / destroy / `[stopbgm track=all]`). */
  stopAllTracks(fadeSec = 0): void {
    for (const track of [...this.loopTracks.keys()]) this.stopTrack(track, fadeSec)
  }

  /** Re-apply the master volumes to anything currently audible — call after the
   *  user changes a channel volume (the in-game menu does). Only the loop tracks
   *  have long-lived elements to update live; se / voice are short and pick up
   *  the new level on their next play. */
  applyVolumes(): void {
    for (const [track, slot] of this.loopTracks) slot.audio.volume = clamp01(slot.base * this.trackMaster(track))
  }

  /** The playing tracks, for a save: the music slot and the ambience beds. */
  tracks(): { music?: { src: string; loop: boolean; volume: number }; beds: { track: string; src: string; loop: boolean; volume: number }[] } {
    const music = this.loopTracks.get(AudioBus.MUSIC_TRACK)
    const beds = [...this.loopTracks].filter(([track]) => track !== AudioBus.MUSIC_TRACK)
    return {
      music: music ? { src: music.src, loop: music.loop, volume: music.base } : undefined,
      beds: beds.map(([track, s]) => ({ track, src: s.src, loop: s.loop, volume: s.base })),
    }
  }

  /** Play a one-shot sound effect, tracked so destroy() can stop it mid-clip. */
  playSe(url: string, volume = 1): void {
    const audio = this.watchAudio(new Audio(url), 'sound effect', url)
    audio.volume = clamp01(volume * this.host.volumes().se)
    this.sounds.add(audio)
    audio.addEventListener('ended', () => this.sounds.delete(audio), { once: true })
    // Like bgm, retry on first gesture if autoplay blocked it (e.g. an SE on the
    // opening frame before any interaction); guard on sounds so a finished/destroyed clip won't replay.
    void audio.play().catch(() => this.resumeOnGesture(audio, () => this.sounds.has(audio)))
  }

  // ---- per-line voice ----

  /** Play a per-line voice clip alongside the typewriter, seeking past `offset`
   *  seconds of leading silence. `current()` says whether the line that started
   *  it is still on screen (a load mid-line drops the clip). */
  playVoice(url: string, offset: number, current: () => boolean): void {
    const audio = this.watchAudio(new Audio(url), 'voice', url)
    audio.preload = 'auto'
    audio.volume = clamp01(this.host.volumes().voice)
    this.voiceAudio = audio
    this.voicePlaying = true
    const begin = (): void => {
      if (!current() || this.voiceAudio !== audio) return
      if (offset > 0) {
        try {
          audio.currentTime = offset
        } catch {
          /* not seekable — plays from the start */
        }
      }
      void audio.play().catch(() => this.retryVoiceOnGesture(audio))
    }
    // Seeking needs metadata; wait for it only when there's an offset to apply.
    if (offset > 0 && audio.readyState < 1) audio.addEventListener('loadedmetadata', begin, { once: true })
    else begin()
  }

  /** Stop the current per-line voice clip (advance, next line, destroy). */
  stopVoice(): void {
    if (this.voiceAudio) {
      this.voiceAudio.pause()
      this.voiceAudio = null
    }
    this.voicePlaying = false
  }

  /** Autoplay policy can block a voiced line that starts before any user gesture
   *  (typically the very first line). Retry the playback once on the first
   *  gesture — but only while this is still the current line's clip and we're
   *  still running, so we never resurrect a clip the player has already left. */
  private retryVoiceOnGesture(audio: HTMLAudioElement): void {
    if (this.voiceAudio !== audio || !this.host.running()) return
    this.resumeOnGesture(audio, () => this.voiceAudio === audio && this.host.running())
  }

  // ---- backlog replay ----

  /** Play a backlogged line's clip, seeking past `offset` exactly as live play
   *  does; stops any prior replay so clips never overlap. */
  playBacklog(url: string, offset = 0): void {
    this.backlogAudio?.pause()
    const audio = this.watchAudio(new Audio(url), 'backlog voice', url)
    audio.volume = clamp01(this.host.volumes().voice)
    this.backlogAudio = audio
    const begin = (): void => {
      if (this.backlogAudio !== audio) return // superseded by a newer replay / reset
      if (offset > 0) {
        try {
          audio.currentTime = offset
        } catch {
          /* not seekable — plays from the start */
        }
      }
      void audio.play().catch(() => {
        if (this.backlogAudio === audio) this.backlogAudio = null
      })
    }
    audio.addEventListener(
      'ended',
      () => {
        if (this.backlogAudio === audio) this.backlogAudio = null
      },
      { once: true },
    )
    if (offset > 0 && audio.readyState < 1) audio.addEventListener('loadedmetadata', begin, { once: true })
    else begin()
  }

  /** Stop the backlog replay clip (session reset / a new replay click). */
  stopBacklog(): void {
    this.backlogAudio?.pause()
    this.backlogAudio = null
  }

  // ---- internals ----

  /** Report why a clip never played. Media failures are otherwise invisible:
   *  every play() here falls back to a gesture retry, so a pack whose audio the
   *  host cannot decode (a Linux build missing the Ogg/Opus GStreamer plugins,
   *  say) is silent with nothing in the console. MediaError.code says which:
   *  2 = network/fetch, 3 = decode, 4 = source not supported. */
  private watchAudio(audio: HTMLAudioElement, what: string, url: string): HTMLAudioElement {
    audio.addEventListener(
      'error',
      () => {
        const code = audio.error?.code
        const why = code === 2 ? 'network' : code === 3 ? 'decode' : code === 4 ? 'format not supported' : 'unknown'
        console.warn(`[nilvn] ${what} audio failed (${why}, MediaError ${code ?? '?'}):`, url)
      },
      { once: true },
    )
    return audio
  }

  /** Retry a blocked autoplay once, on the first user gesture — but only if the
   *  clip is still wanted (bgm: still the current track; se: not yet finished /
   *  destroyed). One-shot listeners, so no leak and no replay on later gestures. */
  private resumeOnGesture(audio: HTMLAudioElement, stillWanted: () => boolean): void {
    let cleanup = (): void => {}
    const resume = (): void => {
      cleanup()
      if (stillWanted()) void audio.play().catch(() => {})
    }
    cleanup = () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
      this.gestureCleanups.delete(cleanup)
    }
    this.gestureCleanups.add(cleanup)
    window.addEventListener('pointerdown', resume, { once: true })
    window.addEventListener('keydown', resume, { once: true })
  }

  private clearTimer(timer: ReturnType<typeof setInterval>): void {
    clearInterval(timer)
    this.timers.delete(timer)
  }

  /** Silence everything and release every timer / gesture listener. */
  destroy(): void {
    for (const cleanup of [...this.gestureCleanups]) cleanup()
    for (const timer of [...this.timers]) this.clearTimer(timer)
    this.stopAllTracks(0)
    this.stopVoice()
    this.stopBacklog()
    for (const a of this.sounds) a.pause()
    this.sounds.clear()
  }
}
