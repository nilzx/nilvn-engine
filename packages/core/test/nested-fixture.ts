// A scene with nested in-scene branches (schema v14), shared by the core and
// engine suites. Every body leaves a mark in `trail` (via [set]) so a played
// route can be read back from the variables alone.
import { CURRENT_SCHEMA_VERSION } from '../src/ir'
import type { Project, SceneNode } from '../src/ir'

const mark = (id: string, m: string): SceneNode => ({ kind: 'set', id, var: 'trail', expr: `trail + "${m}"` })

export function nestedProject(): Project {
  return {
    meta: { id: 'nested', title: 'Nested', version: '0.1.0', defaultLang: 'zh', languages: ['zh'], schemaVersion: CURRENT_SCHEMA_VERSION },
    actors: {},
    variables: [{ name: 'trail', type: 'string', default: '' }, { name: 'trust', type: 'number', default: 0 }],
    resources: { backgrounds: [], audio: [], spritesheets: [] },
    plugins: [],
    scenes: [
      {
        id: 's1',
        titleKey: 's1.title',
        nodes: [
          { kind: 'set', id: 'init', var: 'trail', expr: '""' },
          {
            kind: 'choice',
            id: 'c1',
            options: [
              {
                labelKey: 'o.a',
                body: [
                  mark('a1', 'A'),
                  { kind: 'set', id: 'a2', var: 'trust', expr: 'trust + 1' },
                  {
                    kind: 'choice',
                    id: 'c2',
                    options: [
                      { labelKey: 'o.aa', body: [mark('aa1', 'a')] },
                      { labelKey: 'o.ab', body: [mark('ab1', 'b')] },
                    ],
                  },
                  mark('a3', '!'),
                ],
              },
              { labelKey: 'o.b', body: [mark('b1', 'B')] },
              { labelKey: 'o.c', body: [] },
            ],
          },
          mark('m1', '|'),
          {
            kind: 'branch',
            id: 'br1',
            cases: [{ condition: 'trust >= 1', body: [mark('t1', 'T')] }],
            else: [mark('e1', 'E')],
          },
          mark('m2', '.'),
        ],
      },
    ],
    catalogs: { zh: { 's1.title': '一', 'o.a': '甲', 'o.b': '乙', 'o.c': '丙', 'o.aa': '甲甲', 'o.ab': '甲乙' } },
  }
}
