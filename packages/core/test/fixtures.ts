// Shared fixtures for the core test suite. `makeProject()` returns a fresh, minimal
// but VALID two-scene Project on every call (fresh object literals ⇒ tests can mutate
// freely without cross-contamination — important for migrateProject, which edits in
// place). It deliberately exercises the tricky corners the batch-5 work touches:
//   - a per-line voice clip with a start offset (serialize `[voice … offset=]`)
//   - a command param that is an asset ref (asset collection)
//   - a cross-scene choice target (cross-chunk jump vs preview redirect)
//   - a dangling choice target (redirects to the unset landing)
//   - a cross-scene back-jump (branchTargets / fall-through suppression)
//   - a project-level catalog key not referenced by any scene body (locale `base`)
//   - a partially-translated `en` catalog (completeness)
import { CURRENT_SCHEMA_VERSION } from '../src/ir'
import type { Project, Scene } from '../src/ir'

export function makeProject(): Project {
  const scenes: Scene[] = [
    {
      id: 's1',
      titleKey: 's1.title',
      nodes: [
        { kind: 'say', id: 'n1', actor: 'yuki', face: 'happy', textKey: 's1.hello', voice: 'voice/hi.webm', voiceOffset: 0.2 },
        { kind: 'command', id: 'n2', cmd: 'bg', params: { image: 'bg/room.png' } },
        {
          kind: 'choice',
          id: 'n3',
          options: [
            { labelKey: 's1.opt_go', target: { scene: 's2', label: 's2' } },
            { labelKey: 's1.opt_dead', target: { label: '' } },
          ],
        },
      ],
    },
    {
      id: 's2',
      titleKey: 's2.title',
      nodes: [
        { kind: 'narrate', id: 'n4', textKey: 's2.intro' },
        { kind: 'jump', id: 'n5', target: { scene: 's1', label: 's1' } },
      ],
    },
  ]
  return {
    meta: {
      id: 'p1',
      title: 'Test Project',
      version: '0.1.0',
      defaultLang: 'zh',
      languages: ['zh', 'en'],
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    actors: { yuki: { id: 'yuki', nameKey: 'actor.yuki', sprites: 'char/yuki/{face}.png', faces: ['happy'] } },
    variables: [],
    resources: { backgrounds: [], audio: [], spritesheets: [] },
    plugins: [],
    scenes,
    catalogs: {
      zh: {
        'actor.yuki': '由纪',
        's1.title': '开场',
        's1.hello': '你好',
        's1.opt_go': '继续',
        's1.opt_dead': '死路',
        's2.title': '第二幕',
        's2.intro': '这是一段旁白。',
      },
      // Deliberately partial — only two keys translated, for completeness/import tests.
      en: { 'actor.yuki': 'Yuki', 's1.hello': 'Hi' },
    },
  }
}
