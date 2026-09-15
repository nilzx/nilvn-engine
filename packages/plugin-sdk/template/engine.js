// engine.js — the runtime half named by plugin.json "entries.engine"
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
