import { describe, it, expect } from 'vitest';
import { badgeSummary, nextBadge, badgeRows } from '../src/utils/badges';
import { STAGE_THRESHOLDS, getPatternStage } from '../src/utils/patternStage';
import type { LanguagePattern } from '../src/types';

// ④ 勳章房：總覽、下一枚勳章、列表排序（只讀，門檻 10／40／100 不變）

const pat = (text: string, mastered: number, extra: { unmastered?: number; unchecked?: number } = {}) => {
  const s = [
    ...Array.from({ length: mastered }, () => ({ checked: true, mastery: 1000 })),
    ...Array.from({ length: extra.unmastered ?? 0 }, () => ({ checked: true, mastery: 999 })),
    ...Array.from({ length: extra.unchecked ?? 0 }, () => ({ checked: false, mastery: 1000 })),
  ];
  return { id: text, text, meaningZh: '', exampleSentences: s } as unknown as LanguagePattern;
};

describe('門檻常數', () => {
  it('STAGE_THRESHOLDS 為 10／40／100，getPatternStage 判斷不變', () => {
    expect(STAGE_THRESHOLDS).toEqual({ usable: 10, proficient: 40, mastered: 100 });
    expect(getPatternStage(pat('a', 9)).stage).toBe('learning');
    expect(getPatternStage(pat('a', 10)).stage).toBe('usable');
    expect(getPatternStage(pat('a', 40)).stage).toBe('proficient');
    expect(getPatternStage(pat('a', 100)).stage).toBe('mastered');
  });
});

describe('badgeSummary', () => {
  it('沒有句型 → 全 0', () => {
    expect(badgeSummary([])).toEqual({ usable: 0, proficient: 0, mastered: 0 });
  });
  it('累計計算：精通的句型也算在可用、熟練', () => {
    const r = badgeSummary([pat('a', 9), pat('b', 10), pat('c', 39), pat('d', 40), pat('e', 99), pat('f', 100), pat('g', 101)]);
    expect(r).toEqual({ usable: 6, proficient: 4, mastered: 2 });
  });
  it('只算已通過檢查且滿 1000 的句子', () => {
    expect(badgeSummary([pat('a', 9, { unmastered: 5, unchecked: 5 })])).toEqual({ usable: 0, proficient: 0, mastered: 0 });
  });
});

describe('nextBadge', () => {
  it('沒有句型或全部精通 → null', () => {
    expect(nextBadge([])).toBeNull();
    expect(nextBadge([pat('a', 100), pat('b', 120)])).toBeNull();
  });
  it('挑距離下一個門檻最少的句型', () => {
    const r = nextBadge([pat('a', 9), pat('b', 50), pat('c', 99), pat('d', 100)]);
    expect(r?.pattern.text).toBe('c');
    expect(r?.tier).toBe('精通');
    expect(r?.target).toBe(100);
    expect(r?.remaining).toBe(1);
  });
  it('0 句的句型下一枚是「可用」差 10 句', () => {
    const r = nextBadge([pat('a', 0)]);
    expect(r).toMatchObject({ tier: '可用', target: 10, remaining: 10 });
  });
  it('同距離取精熟句數多的', () => {
    // a：8 → 可用差 2；b：38 → 熟練差 2
    const r = nextBadge([pat('a', 8), pat('b', 38)]);
    expect(r?.pattern.text).toBe('b');
    expect(r?.tier).toBe('熟練');
  });
  it('再同分取句型文字排序（英文規則）', () => {
    const r = nextBadge([pat('used to', 5), pat('end up', 5), pat('Be about to', 5)]);
    expect(r?.pattern.text).toBe('Be about to');
  });
});

describe('badgeRows', () => {
  it('精熟句數多的在前，同分依句型文字排序', () => {
    const rows = badgeRows([pat('b', 12), pat('a', 12), pat('c', 100), pat('d', 0), pat('e', 48)]);
    expect(rows.map((r) => r.pattern.text)).toEqual(['c', 'e', 'a', 'b', 'd']);
  });
  it('每列的階段、下一個門檻與差幾句', () => {
    const rows = badgeRows([pat('a', 0), pat('b', 10), pat('c', 39), pat('d', 40), pat('e', 100), pat('f', 130)]);
    const by = Object.fromEntries(rows.map((r) => [r.pattern.text, r]));
    expect(by.a).toMatchObject({ mastered: 0, tier: null, next: { tier: '可用', target: 10 }, remaining: 10 });
    expect(by.b).toMatchObject({ mastered: 10, tier: '可用', next: { tier: '熟練', target: 40 }, remaining: 30 });
    expect(by.c).toMatchObject({ mastered: 39, tier: '可用', next: { tier: '熟練', target: 40 }, remaining: 1 });
    expect(by.d).toMatchObject({ mastered: 40, tier: '熟練', next: { tier: '精通', target: 100 }, remaining: 60 });
    expect(by.e).toMatchObject({ mastered: 100, tier: '精通', next: null, remaining: 0 });
    expect(by.f).toMatchObject({ mastered: 130, tier: '精通', next: null, remaining: 0 });
  });
  it('不改動傳入的陣列順序', () => {
    const input = [pat('b', 1), pat('a', 2)];
    badgeRows(input);
    expect(input.map((p) => p.text)).toEqual(['b', 'a']);
  });
});
