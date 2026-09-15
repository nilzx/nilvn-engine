// @vitest-environment jsdom
// Multi-track audio: named loop tracks side by side —
// 'music' is the classic BGM slot on the music bus, every other name an ambience
// bed on the ambience bus. Verified through the public surface (saveState shape,
// stop semantics, bus-master volume derivation).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createEngine, type Engine } from '../src/index'

// jsdom's HTMLMediaElement.play is a not-implemented stub; make it a resolved
// promise so playTrack's autoplay-retry path never fires in tests.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
})

// Capture every Audio element the engine creates, to observe live volumes.
const created: HTMLAudioElement[] = []
beforeAll(() => {
  const Real = window.Audio
  window.Audio = function (url?: string) {
    const a = new Real(url)
    created.push(a)
    return a
  } as unknown as typeof Audio
})
beforeEach(() => {
  created.length = 0
})

function freshEngine(): Engine {
  return createEngine({ container: document.createElement('div') })
}

describe('multi-track loop audio', () => {
  it('music and ambience beds play side by side and save separately', () => {
    const engine = freshEngine()
    engine.playBgm('theme.mp3', { volume: 0.8 })
    engine.playTrack('rain', 'rain.mp3', { volume: 0.5 })
    engine.playTrack('crowd', 'crowd.mp3', { loop: false })
    const s = engine.saveState()
    expect(s.bgm).toEqual({ src: 'theme.mp3', loop: true, volume: 0.8 })
    expect(s.tracks).toEqual([
      { track: 'rain', src: 'rain.mp3', loop: true, volume: 0.5 },
      { track: 'crowd', src: 'crowd.mp3', loop: false, volume: 1 },
    ])
  })

  it('replaying a track replaces it; stopping one leaves the others', () => {
    const engine = freshEngine()
    engine.playTrack('rain', 'rain1.mp3')
    engine.playTrack('rain', 'rain2.mp3')
    engine.playBgm('theme.mp3')
    engine.stopTrack('rain', 0)
    const s = engine.saveState()
    expect(s.tracks).toBeUndefined()
    expect(s.bgm?.src).toBe('theme.mp3')
  })

  it('stopAllTracks silences everything (and the save shows it)', () => {
    const engine = freshEngine()
    engine.playBgm('theme.mp3')
    engine.playTrack('rain', 'rain.mp3')
    engine.stopAllTracks(0)
    const s = engine.saveState()
    expect(s.bgm).toBeUndefined()
    expect(s.tracks).toBeUndefined()
  })

  it("each bus has its own master: bgmVolume scales 'music', ambienceVolume the beds", () => {
    const engine = freshEngine()
    engine.bgmVolume = 0.5
    engine.ambienceVolume = 0.25
    engine.playBgm('theme.mp3', { volume: 0.8 })
    engine.playTrack('rain', 'rain.mp3', { volume: 0.8 })
    const [music, rain] = created
    expect(music!.volume).toBeCloseTo(0.4) // 0.8 × bgm master 0.5
    expect(rain!.volume).toBeCloseTo(0.2) // 0.8 × ambience master 0.25
    // Live master change re-derives both, each against its own bus.
    engine.bgmVolume = 1
    engine.ambienceVolume = 1
    engine.applyVolumes()
    expect(music!.volume).toBeCloseTo(0.8)
    expect(rain!.volume).toBeCloseTo(0.8)
  })

  it('fade-in ramps from silence to the bus-scaled target', () => {
    vi.useFakeTimers()
    try {
      const engine = freshEngine()
      engine.playTrack('rain', 'rain.mp3', { volume: 0.8, fade: 0.4 })
      const rain = created[0]!
      expect(rain.volume).toBe(0)
      vi.advanceTimersByTime(200)
      expect(rain.volume).toBeGreaterThan(0.2)
      expect(rain.volume).toBeLessThan(0.8)
      vi.advanceTimersByTime(400)
      expect(rain.volume).toBeCloseTo(0.8)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fade-out ramps a stopping track down and pauses it', () => {
    vi.useFakeTimers()
    try {
      const engine = freshEngine()
      engine.playTrack('rain', 'rain.mp3')
      const rain = created[0]!
      const paused = vi.fn()
      Object.defineProperty(rain, 'pause', { value: paused })
      engine.stopTrack('rain', 0.2)
      expect(engine.saveState().tracks).toBeUndefined() // gone from the model at once
      vi.advanceTimersByTime(400)
      expect(rain.volume).toBe(0)
      expect(paused).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
