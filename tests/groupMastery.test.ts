import { describe, it, expect } from 'vitest';
import { groupMasteryBars } from '../src/utils/groupMastery';
import type { PatternExampleSentence } from '../src/types';

// UI 改版 ③a：組別 10 格熟練度（純函式）

const s = (id: string, mastery: number | undefined, extra: Partial<PatternExampleSentence> = {}): PatternExampleSentence =>
  ({ id, text: id, checked: true, mastery, groupIndex: Number(id.split('_')[1]), ...extra } as PatternExampleSentence);

describe('groupMasteryBars：對位與格數', () => {
  it('固定 10 格，依 p_<組>_<i> 對位', () => {
    const bars = groupMasteryBars([s('p_2_3', 500), s('p_2_0', 100)], 2);
    expect(bars).toHaveLength(10);
    expect(bars.map((b) => b.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p_2_${i}`));
    expect(bars[0]).toMatchObject({ created: true, mastery: 100 });
    expect(bars[3]).toMatchObject({ created: true, mastery: 500 });
    expect(bars[1]).toMatchObject({ created: false, mastery: 0, gain: 0, mastered: false });
  });

  it('沒有句子（undefined）時 10 格都是未造句', () => {
    const bars = groupMasteryBars(undefined, 0);
    expect(bars).toHaveLength(10);
    expect(bars.every((b) => !b.created && b.mastery === 0 && b.gain === 0)).toBe(true);
  });

  it('其他組、id 不符規則、超出 0～9 的句子忽略', () => {
    const bars = groupMasteryBars([s('p_1_0', 900), s('legacy', 900, { groupIndex: 2 }), s('p_2_10', 900), s('p_2_x', 900)], 2);
    expect(bars.every((b) => !b.created)).toBe(true);
  });

  it('checked 為 false 的句子視為未造句，熟練度顯示 0', () => {
    const bars = groupMasteryBars([s('p_0_4', 700, { checked: false })], 0);
    expect(bars[4]).toMatchObject({ created: false, mastery: 0, gain: 0 });
  });
});

describe('groupMasteryBars：熟練度', () => {
  it('夾在 0～1000；不是數字視為 0', () => {
    const bars = groupMasteryBars([s('p_0_0', 1300), s('p_0_1', -50), s('p_0_2', NaN), s('p_0_3', undefined)], 0);
    expect(bars.slice(0, 4).map((b) => b.mastery)).toEqual([1000, 0, 0, 0]);
  });

  it('≥1000 為 mastered', () => {
    const bars = groupMasteryBars([s('p_0_0', 1000), s('p_0_1', 999)], 0);
    expect(bars[0].mastered).toBe(true);
    expect(bars[1].mastered).toBe(false);
  });
});

describe('groupMasteryBars：本次增加量', () => {
  it('沒傳起始值時 gain 全為 0', () => {
    expect(groupMasteryBars([s('p_0_0', 600)], 0)[0].gain).toBe(0);
  });

  it('有起始值時 gain＝目前−起始；起始 0 也算', () => {
    const bars = groupMasteryBars([s('p_0_0', 600), s('p_0_1', 90)], 0, { p_0_0: 450, p_0_1: 0 });
    expect(bars[0].gain).toBe(150);
    expect(bars[1].gain).toBe(90);
  });

  it('沒有起始值的句子（佇列外）gain 為 0，不把歷史熟練度當成這次增加', () => {
    const bars = groupMasteryBars([s('p_0_0', 1000), s('p_0_1', 300)], 0, { p_0_1: 200 });
    expect(bars[0].gain).toBe(0);
    expect(bars[1].gain).toBe(100);
  });

  it('gain 不為負，且以夾過的值計算', () => {
    const bars = groupMasteryBars([s('p_0_0', 300), s('p_0_1', 1200)], 0, { p_0_0: 500, p_0_1: 900 });
    expect(bars[0].gain).toBe(0);
    expect(bars[1].gain).toBe(100);
  });

  it('可用覆寫值取代資料中的目前熟練度（練習期間記下的結果）', () => {
    const bars = groupMasteryBars([s('p_0_0', 400)], 0, { p_0_0: 400 }, { p_0_0: 520 });
    expect(bars[0]).toMatchObject({ mastery: 520, gain: 120 });
  });
});
