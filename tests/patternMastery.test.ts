import { describe, it, expect } from 'vitest';
import { patternMasteryMap, groupMasteredCounts, masteryLevel } from '../src/utils/groupMastery';
import type { PatternExampleSentence } from '../src/types';

// UI 改版 ③b：句型的 10×10 熟練度地圖（純函式）

const s = (id: string, mastery: number | undefined, extra: Partial<PatternExampleSentence> = {}): PatternExampleSentence =>
  ({ id, text: id, checked: true, mastery, groupIndex: Number(id.split('_')[1]) || 0, ...extra } as PatternExampleSentence);

describe('patternMasteryMap', () => {
  it('沒有句子時是 10×10 全部未造句', () => {
    const map = patternMasteryMap(undefined);
    expect(map).toHaveLength(10);
    map.forEach((row, g) => {
      expect(row).toHaveLength(10);
      expect(row.map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p_${g}_${i}`));
      expect(row.every((c) => !c.created)).toBe(true);
    });
  });

  it('只認 p_<組>_<i> 且 checked 的句子；id 決定位置', () => {
    const map = patternMasteryMap([
      s('p_0_3', 1000),
      s('legacy', 1000),
      s('p_2_5', 600, { groupIndex: 7 }),
      s('p_4_1', 800, { checked: false }),
    ]);
    expect(map[0][3]).toMatchObject({ created: true, mastered: true });
    expect(map[2][5]).toMatchObject({ created: true, mastery: 600 });
    expect(map[7].every((c) => !c.created)).toBe(true);
    expect(map[4][1].created).toBe(false);
    const created = map.flat().filter((c) => c.created).length;
    expect(created).toBe(2);
  });

  it('已造句但熟練度 0 的格子仍是 created', () => {
    const map = patternMasteryMap([s('p_1_0', 0)]);
    expect(map[1][0]).toMatchObject({ created: true, mastery: 0 });
    expect(map[1][1].created).toBe(false);
  });
});

describe('groupMasteredCounts', () => {
  it('沒有句子時是 10 個 0', () => {
    expect(groupMasteredCounts(undefined)).toEqual(Array(10).fill(0));
  });

  it('每組已精熟句數，與地圖一致', () => {
    const sentences = [
      ...Array.from({ length: 10 }, (_, i) => s(`p_0_${i}`, 1000)),
      s('p_1_0', 1000), s('p_1_1', 1000), s('p_1_2', 1000), s('p_1_3', 999),
      s('p_3_0', 1500),
      s('legacy', 1000),
    ];
    expect(groupMasteredCounts(sentences)).toEqual([10, 3, 0, 1, 0, 0, 0, 0, 0, 0]);
  });
});

describe('masteryLevel', () => {
  it.each([
    [0, 0], [1, 1], [399, 1], [400, 2], [699, 2], [700, 3], [999, 3], [1000, 4], [1500, 4], [-20, 0], [Number.NaN, 0],
  ])('%s → %s', (m, level) => {
    expect(masteryLevel(m)).toBe(level);
  });
});
