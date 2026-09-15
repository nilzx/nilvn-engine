// Shared script-package fixture for the engine tests (inline / zip forms).
import type { PackageManifest } from '@nilvn/core'
import type { InlinePackageData } from '../src/index'

/** A two-scene, pure-flow package (no dialogue, so start() resolves). s1 falls
 *  through to s2; both carry a zh text slice; one bg asset; one actor. */
export function makePackage(): InlinePackageData {
  const manifest: PackageManifest = {
    format: 1,
    title: 'Pack',
    engine: '0.15.0',
    lang: 'zh',
    languages: ['zh', 'en'],
    actors: { yuki: { name: '由纪', nameKey: 'actor.yuki', sprites: 'char/yuki/{face}.png', defaultFace: 'happy' } },
    // A first-party-style short name: the engine resolves it against its registry.
    plugins: [{ id: 'fx' }],
    textSpeed: 55,
    saveKey: 'pack-1',
    chunks: {
      format: 1,
      engine: '0.15.0',
      schemaVersion: 10,
      entry: { label: 's1' },
      defaultLang: 'zh',
      sceneOrder: ['s1', 's2'],
      chunks: [
        { id: 's1', scenes: ['s1'], url: 'chunks/scene/s1.json', bytes: 0, labels: ['s1'], assets: ['bg/room.png'], next: ['s2'], branchTargets: [] },
        { id: 's2', scenes: ['s2'], url: 'chunks/scene/s2.json', bytes: 0, labels: ['s2'], assets: [], next: [], branchTargets: [] },
      ],
      labelIndex: { s1: 's1', s2: 's2' },
      locales: {
        zh: [
          { id: 'base', scenes: [], url: 'chunks/locale/zh/base.json', bytes: 0 },
          { id: 's1', scenes: ['s1'], url: 'chunks/locale/zh/s1.json', bytes: 0 },
        ],
        en: [{ id: 'base', scenes: [], url: 'chunks/locale/en/base.json', bytes: 0 }],
      },
      assets: { 'bg/room.png': { url: 'assets/bg/room.png', bytes: 3, kind: 'bg' } },
    },
  }
  const files: Record<string, string> = {
    'chunks/scene/s1.json': JSON.stringify({ id: 's1', body: '[label s1]\n[set x = 1]\n', labels: ['s1'] }),
    'chunks/scene/s2.json': JSON.stringify({ id: 's2', body: '[label s2]\n[set x = x + 1]\n', labels: ['s2'] }),
    'chunks/locale/zh/base.json': JSON.stringify({ 'actor.yuki': '由纪' }),
    'chunks/locale/zh/s1.json': JSON.stringify({ 's1.hello': '你好' }),
    'chunks/locale/en/base.json': JSON.stringify({ 'actor.yuki': 'Yuki' }),
  }
  return { manifest, files, assets: { 'bg/room.png': 'data:image/png;base64,AAA=' } }
}
