// Formatter contract: the two normalization tiers plus the three invariants
// (idempotent, meaning-preserving,
// protected zones untouched / never merge or split lines).
import { describe, it, expect } from 'vitest'
import { formatScreenplay } from '../src/screenplay-format'
import { parseScreenplay } from '../src/screenplay'
import { SKILL_SAMPLE } from './screenplay.test'

describe('tier 1 — structural control chars', () => {
  it('normalizes full-width speaker colon and mood parens to the strict form', () => {
    expect(formatScreenplay('小红：那个……')).toBe('小红: 那个……')
    expect(formatScreenplay('小明（犹豫）：我喜欢你。')).toBe('小明(犹豫): 我喜欢你。')
    expect(formatScreenplay('小明（犹豫): 混用也归一。')).toBe('小明(犹豫): 混用也归一。')
  })

  it('leaves prose colons alone: >4-char prefixes and all-half-width lines', () => {
    expect(formatScreenplay('那位转学生说：好。')).toBe('那位转学生说：好。')
    expect(formatScreenplay('12:30 比赛开始')).toBe('12:30 比赛开始')
    // Known tradeoff of the ≤4-char rule: a short prose prefix does convert —
    // the importer's actor-mapping panel is the safety net (map that speaker to narration).
    expect(formatScreenplay('她说：来吧')).toBe('她说: 来吧')
  })

  it('normalizes named inner monologue colons', () => {
    expect(formatScreenplay('*(小明：说出来了……)*')).toBe('*(小明: 说出来了……)*')
  })

  it('normalizes -> to → before link targets on control/option lines only', () => {
    expect(formatScreenplay('> -> [两情相悦](#rooftop)')).toBe('> → [两情相悦](#rooftop)')
    expect(formatScreenplay('- **回应** -> [目标](#a)：后果')).toBe('- **回应** → [目标](#a)：后果')
    expect(formatScreenplay('公式 a -> b 不受影响')).toBe('公式 a -> b 不受影响')
  })

  it('migrates legacy pandoc {#id} anchors to trailing code spans', () => {
    expect(formatScreenplay('## 场景 · 教室 {#dusk}')).toBe('## 场景 · 教室 `dusk`')
  })
})

describe('tier 2 — body punctuation style', () => {
  it('unifies quote pairs to the default straight style', () => {
    expect(formatScreenplay('她说了“好”，又说「不行」。')).toBe('她说了"好"，又说"不行"。')
  })

  it('converts to directional styles with per-line pairing for straight quotes', () => {
    expect(formatScreenplay('她说了"好"。', { quoteStyle: '「」' })).toBe('她说了「好」。')
    expect(formatScreenplay('她说了“好”。', { quoteStyle: '「」' })).toBe('她说了「好」。')
    expect(formatScreenplay('他答了「行」。', { quoteStyle: '“”' })).toBe('他答了“行”。')
  })

  it('unifies ASCII and run-on ellipses; a lone … is a short pause and stays', () => {
    expect(formatScreenplay('那个...我…没事…………')).toBe('那个……我…没事……')
    expect(formatScreenplay('那个……嗯…', { ellipsis: '...' })).toBe('那个...嗯...')
  })
})

describe('invariants', () => {
  const MESSY = [
    '# 第一幕 · 放学后',
    '',
    '## 场景 · 教室 {#dusk}',
    '黄昏...教室里只剩下“两个人”的呼吸声。',
    '',
    '小明（犹豫）：那个……我有件事。',
    '*(小明：说出来了...)*',
    '',
    '> 玩家在此替小红做选择。',
    '',
    '- **回应「我也是」** -> [两情相悦](ch02.md#open)：好感大增。',
    '',
    '> -> [错过](ch03.md#open)',
    '变量`好感`与锚`dusk`不能动...哪怕在正文里。',
  ].join('\n')

  it('is idempotent', () => {
    const once = formatScreenplay(MESSY)
    expect(formatScreenplay(once)).toBe(once)
    const styled = formatScreenplay(MESSY, { quoteStyle: '「」' })
    expect(formatScreenplay(styled, { quoteStyle: '「」' })).toBe(styled)
  })

  it('never touches code spans, link targets or fenced blocks', () => {
    const out = formatScreenplay(MESSY)
    expect(out).toContain('`好感`')
    expect(out).toContain('`dusk`不能动')
    expect(out).toContain('](ch02.md#open)')
    expect(out).toContain('](ch03.md#open)')
    const fenced = '```\n小明（犹豫）：代码块里原样...\n```'
    expect(formatScreenplay(fenced)).toBe(fenced)
  })

  it('never merges or splits lines', () => {
    expect(formatScreenplay(MESSY).split('\n')).toHaveLength(MESSY.split('\n').length)
  })

  it('format→parse resolves the messy input to the same play as the strict form', () => {
    const events = parseScreenplay(formatScreenplay(MESSY))
    expect(events.map((e) => e.kind)).toEqual(['chapter', 'sceneHeading', 'narrate', 'say', 'inner', 'branch', 'jump', 'narrate'])
    expect(events[3]).toMatchObject({ kind: 'say', name: '小明', mood: '犹豫', text: '那个……我有件事。' })
    expect(events[4]).toMatchObject({ kind: 'inner', name: '小明', text: '说出来了……' })
    const branch = events[5]!
    expect(branch).toMatchObject({ kind: 'branch', prompt: '玩家在此替小红做选择。' })
  })

  it('leaves the already-strict SKILL sample unchanged except body punctuation policy', () => {
    // The sample uses 「」 in an option label; with quoteStyle 「」 the strict
    // sample must round-trip byte-identical.
    expect(formatScreenplay(SKILL_SAMPLE, { quoteStyle: '「」' })).toBe(SKILL_SAMPLE)
  })
})
