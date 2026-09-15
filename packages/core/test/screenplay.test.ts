// Contract tests for grammar v1 parsing, construct by construct. The corpus
// sample mirrors the writing tools' sample chapter — the doc IS the test
// corpus, so the grammar table, the sample and this parser cannot drift apart.
import { describe, it, expect } from 'vitest'
import { parseScreenplay, stripScreenplayMarkup, type ScreenplayEvent } from '../src/screenplay'

function kinds(events: ScreenplayEvent[]): string[] {
  return events.map((e) => e.kind)
}

describe('parseScreenplay constructs', () => {
  it('parses chapter and scene headings, trailing code span = anchor id', () => {
    const [chapter, scene, plain] = parseScreenplay('# 第一幕 · 放学后\n\n## 场景 · 教室 `dusk`\n\n## 分支 · 小红的回应')
    expect(chapter).toMatchObject({ kind: 'chapter', title: '第一幕 · 放学后', line: 1 })
    expect(scene).toMatchObject({ kind: 'sceneHeading', title: '场景 · 教室', id: 'dusk' })
    expect(plain).toMatchObject({ kind: 'sceneHeading', title: '分支 · 小红的回应' })
    expect('id' in plain!).toBe(false)
  })

  it('parses dialogue with and without mood; requires the half-width ": " anchor', () => {
    const events = parseScreenplay('小明(犹豫): 那个……我有件事。\n我: 我也是。\n她说：来吧\n12:30 比赛开始')
    expect(events[0]).toMatchObject({ kind: 'say', name: '小明', mood: '犹豫', text: '那个……我有件事。' })
    expect(events[1]).toMatchObject({ kind: 'say', name: '我', text: '我也是。' })
    expect('mood' in events[1]!).toBe(false)
    expect(events[2]!.kind).toBe('narrate') // full-width colon is prose to the strict parser
    expect(events[3]!.kind).toBe('narrate') // no space after the colon → not a speaker anchor
  })

  it('parses inner monologue, first-person and named', () => {
    const events = parseScreenplay('*(他今天怪怪的……)*\n*(小明: 说出来了……)*')
    expect(events[0]).toMatchObject({ kind: 'inner', text: '他今天怪怪的……' })
    expect('name' in events[0]!).toBe(false)
    expect(events[1]).toMatchObject({ kind: 'inner', name: '小明', text: '说出来了……' })
  })

  it('parses whole-line beats; inline bold stays narrate', () => {
    const events = parseScreenplay('**小明深吸一口气。**\n她**猛地**回头。')
    expect(events[0]).toMatchObject({ kind: 'beat', text: '小明深吸一口气。' })
    expect(events[1]).toMatchObject({ kind: 'narrate', text: '她**猛地**回头。' })
  })

  it('parses jumps with in-file and cross-file targets', () => {
    const events = parseScreenplay('> → [两情相悦](#rooftop)\n> → [错过](ch03.md#open)')
    expect(events[0]).toMatchObject({ kind: 'jump', target: { label: '两情相悦', anchor: 'rooftop' } })
    expect(events[1]).toMatchObject({ kind: 'jump', target: { label: '错过', file: 'ch03.md', anchor: 'open' } })
  })

  it('collects option runs into one branch and attaches the preceding note as prompt', () => {
    const events = parseScreenplay(
      [
        '## 分支 · 小红的回应',
        '> 玩家在此替小红做选择。',
        '',
        '- **回应「我也是」** → [两情相悦](ch02.md#open)：两人心意相通、好感大增。',
        '- **低头沉默**：她不是不喜欢，只是怕。',
        '- *(若两人此前已足够亲密)* **反过来调侃他** → [缓和](#relief)：化解尴尬却错过郑重一刻。',
        '',
        '尾声的旁白。',
      ].join('\n'),
    )
    expect(kinds(events)).toEqual(['sceneHeading', 'branch', 'narrate'])
    const branch = events[1]! as Extract<ScreenplayEvent, { kind: 'branch' }>
    expect(branch.prompt).toBe('玩家在此替小红做选择。')
    expect(branch.options).toHaveLength(3)
    expect(branch.options[0]).toMatchObject({
      label: '回应「我也是」',
      target: { label: '两情相悦', file: 'ch02.md', anchor: 'open' },
      consequence: '两人心意相通、好感大增。',
    })
    expect(branch.options[1]).toMatchObject({ label: '低头沉默', consequence: '她不是不喜欢，只是怕。' })
    expect(branch.options[1]!.target).toBeUndefined()
    expect(branch.options[2]).toMatchObject({ label: '反过来调侃他', condition: '若两人此前已足够亲密' })
  })

  it('keeps a promptless option run as a state-driven branch, note stays a note otherwise', () => {
    const events = parseScreenplay('> 天色渐暗。\n\n正文一行。\n\n- **打开门** → [走廊](#hall)：吱呀一声。')
    expect(kinds(events)).toEqual(['note', 'narrate', 'branch'])
    const branch = events[2]! as Extract<ScreenplayEvent, { kind: 'branch' }>
    expect(branch.prompt).toBeUndefined()
  })

  it('emits unknown for lines the grammar does not define, verbatim', () => {
    const events = parseScreenplay('| id | 名 |\n- 小红 / 小明\n### 太深的标题\n1. [目录项](x.md)\n```\n小红(害羞): 代码块里不解析\n```')
    expect(kinds(events)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'])
    expect((events[1] as Extract<ScreenplayEvent, { kind: 'unknown' }>).raw).toBe('- 小红 / 小明')
  })

  it('reports 1-based line numbers through blank lines and CRLF', () => {
    const events = parseScreenplay('# 章\r\n\r\n旁白。')
    expect(events[0]).toMatchObject({ kind: 'chapter', line: 1 })
    expect(events[1]).toMatchObject({ kind: 'narrate', line: 3 })
  })

  it('stripScreenplayMarkup peels bold and machine-word markers, keeping text', () => {
    expect(stripScreenplayMarkup('她**猛地**回头，望向`rooftop`。')).toBe('她猛地回头，望向rooftop。')
  })
})

// The SKILL.md ch01 sample, verbatim — every line must land on a defined kind
// (no unknowns): the doc's own corpus parses clean.
const SKILL_SAMPLE = `# 第一幕 · 放学后

## 场景 · 教室 \`dusk\`
黄昏，夕阳斜照，放学后空无一人。教室里只剩下两个人的呼吸声。

小明(犹豫): 那个……我有件事，憋了很久了。

*(他今天怪怪的……平时哪会这样吞吞吐吐。)*

小红(紧张): 嗯…？你说。

**小明深吸一口气，鼓起了勇气。**

小明(认真): 我喜欢你。从你转学来的第一天起。

*(小明: 说出来了……不管结果如何，总算说出来了。)*

## 分支 · 小红的回应
> 玩家在此替小红做选择。

- **回应「我也是」** → [两情相悦](ch02.md#open)：小红鼓起勇气，两人心意相通、好感大增。
- **低头沉默** → [错过](ch03.md#open)：她不是不喜欢，只是怕。小明误读了沉默。
- *(若两人此前已足够亲密)* **反过来调侃他** → [缓和](#relief)：化解尴尬却错过郑重一刻。

## 场景 · 教室(续) \`relief\`
小红慌忙岔开话题，气氛却没散开。

> → [两情相悦](ch02.md#open)
`

describe('SKILL.md sample corpus', () => {
  it('parses the full ch01 sample with zero unknowns', () => {
    const events = parseScreenplay(SKILL_SAMPLE)
    expect(kinds(events)).toEqual([
      'chapter',
      'sceneHeading',
      'narrate',
      'say',
      'inner',
      'say',
      'beat',
      'say',
      'inner',
      'sceneHeading',
      'branch',
      'sceneHeading',
      'narrate',
      'jump',
    ])
    const branch = events[10]! as Extract<ScreenplayEvent, { kind: 'branch' }>
    expect(branch.prompt).toBe('玩家在此替小红做选择。')
    expect(branch.options.map((o) => o.label)).toEqual(['回应「我也是」', '低头沉默', '反过来调侃他'])
    const relief = events[11]! as Extract<ScreenplayEvent, { kind: 'sceneHeading' }>
    expect(relief).toMatchObject({ title: '场景 · 教室(续)', id: 'relief' })
  })
})

export { SKILL_SAMPLE }
