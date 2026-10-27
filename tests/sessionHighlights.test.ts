import { describe, it, expect } from 'vitest';
import { sessionHighlights } from '../src/utils/sessionHighlights';
import type { PatternExampleSentence } from '../src/types';

// ⑤ 高光時刻：本組練習完成時，是否跨過勳章門檻（10／40／100）、是否整組精熟。只讀計算

const s = (g: number, i: number, mastery: number, checked = true) =>
  ({ id: `p_${g}_${i}`, groupIndex: g, mastery, checked }) as unknown as PatternExampleSentence;
/** 第 0..groups-1 組全部精熟（每組 10 句） */
const fullGroups = (groups: number) => Array.from({ length: groups * 10 }, (_, k) => s(Math.floor(k / 10), k % 10, 1000));

describe('sessionHighlights：新勳章', () => {
  it('空資料、缺值都安全', () => {
    expect(sessionHighlights(undefined, 0)).toEqual({ newTier: null, groupCompleted: false });
    expect(sessionHighlights([], 0, {}, {})).toEqual({ newTier: null, groupCompleted: false });
    expect(sessionHighlights([s(0, 0, Number.NaN)], 0, { p_0_0: Number.NaN }, {})).toEqual({ newTier: null, groupCompleted: false });
  });

  it('沒有跨過門檻 → null', () => {
    const sentences = [...Array.from({ length: 5 }, (_, i) => s(0, i, 1000)), s(0, 5, 900)];
    expect(sessionHighlights(sentences, 0, { p_0_5: 800 }, { p_0_5: 900 }).newTier).toBeNull();
  });

  it('跨過 10 → 可用', () => {
    const sentences = Array.from({ length: 10 }, (_, i) => s(0, i, 1000));
    const r = sessionHighlights(sentences, 0, { p_0_9: 950 }, { p_0_9: 1000 });
    expect(r.newTier).toEqual({ tier: '可用', mastered: 10 });
  });

  it('跨過 40 → 熟練', () => {
    const sentences = fullGroups(4);
    const r = sessionHighlights(sentences, 3, { p_3_0: 990 }, { p_3_0: 1000 });
    expect(r.newTier).toEqual({ tier: '熟練', mastered: 40 });
  });

  it('跨過 100 → 精通', () => {
    const sentences = fullGroups(10);
    const r = sessionHighlights(sentences, 9, { p_9_9: 700 }, { p_9_9: 1000 });
    expect(r.newTier).toEqual({ tier: '精通', mastered: 100 });
  });

  it('一次跨過兩個門檻取最高', () => {
    // 練習前 9 句、練習後 41 句（極端：起始值讓 32 句原本未滿）
    const sentences = [...fullGroups(4), s(4, 0, 1000)];
    const start: Record<string, number> = {};
    for (let g = 0; g < 4; g++) for (let i = 0; i < 10; i++) if (g * 10 + i >= 9) start[`p_${g}_${i}`] = 500;
    start.p_4_0 = 500;
    const r = sessionHighlights(sentences, 0, start, {});
    expect(r.newTier).toEqual({ tier: '熟練', mastered: 41 });
  });

  it('寫入值優先於目前值；沒有寫入值時用目前值', () => {
    // 監聽資料還是舊的 950，但這次真的寫入 1000
    const sentences = [...Array.from({ length: 9 }, (_, i) => s(0, i, 1000)), s(0, 9, 950)];
    expect(sessionHighlights(sentences, 0, { p_0_9: 950 }, { p_0_9: 1000 }).newTier).toEqual({ tier: '可用', mastered: 10 });
    // 沒有寫入值（例如寫入失敗）→ 用目前值 950，不算跨過
    expect(sessionHighlights(sentences, 0, { p_0_9: 950 }, {}).newTier).toBeNull();
  });

  it('未通過檢查的句子不算', () => {
    const sentences = [...Array.from({ length: 9 }, (_, i) => s(0, i, 1000)), s(0, 9, 1000, false)];
    expect(sessionHighlights(sentences, 0, { p_0_9: 0 }, { p_0_9: 1000 }).newTier).toBeNull();
  });

  it('原本就超過門檻、這次又多精熟一句 → 不重複發勳章', () => {
    const sentences = [...fullGroups(1), s(1, 0, 1000)];
    expect(sessionHighlights(sentences, 1, { p_1_0: 900 }, { p_1_0: 1000 }).newTier).toBeNull();
  });
});

describe('sessionHighlights：整組精熟', () => {
  it('練習前不是、練習後 10 句都 1000 → true', () => {
    const sentences = fullGroups(2);
    expect(sessionHighlights(sentences, 1, { p_1_3: 800 }, { p_1_3: 1000 }).groupCompleted).toBe(true);
  });
  it('練習前就已整組精熟 → false', () => {
    const sentences = fullGroups(2);
    expect(sessionHighlights(sentences, 1, { p_1_3: 1000 }, { p_1_3: 1000 }).groupCompleted).toBe(false);
  });
  it('練習後還有一句沒滿 → false', () => {
    const sentences = [...Array.from({ length: 9 }, (_, i) => s(0, i, 1000)), s(0, 9, 900)];
    expect(sessionHighlights(sentences, 0, { p_0_8: 900 }, { p_0_8: 1000 }).groupCompleted).toBe(false);
  });
  it('本組不到 10 句 → false', () => {
    const sentences = Array.from({ length: 8 }, (_, i) => s(0, i, 1000));
    expect(sessionHighlights(sentences, 0, { p_0_0: 0 }, { p_0_0: 1000 }).groupCompleted).toBe(false);
  });
});
