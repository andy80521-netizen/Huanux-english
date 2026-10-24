import { describe, expect, it } from 'vitest';
import { checkAndUpdateUnlockedGroups, isGroupUnlocked } from '../src/utils/groupUnlock';
import { interleaveByKey } from '../src/utils/interleave';
import { getMasteredCount, getPatternStage } from '../src/utils/patternStage';
import type { LanguagePattern } from '../src/types';

const sentence = (groupIndex: number, mastery: number, checked = true) =>
  ({ groupIndex, mastery, checked }) as unknown as LanguagePattern['exampleSentences'][number];

const pattern = (sentences: ReturnType<typeof sentence>[], unlockedGroups = 0) =>
  ({ exampleSentences: sentences, unlockedGroups }) as unknown as LanguagePattern;

const group = (g: number, mastery: number, count = 10) => Array.from({ length: count }, () => sentence(g, mastery));

describe('getMasteredCount / getPatternStage', () => {
  it('只計算已通過檢查且 mastery ≥ 1000 的句子', () => {
    const p = pattern([sentence(0, 1000), sentence(0, 999), sentence(0, 1500, false)]);
    expect(getMasteredCount(p)).toBe(1);
  });

  it('依精熟句數分成 學習中 / 可用 / 熟練 / 精通（10 / 40 / 100）', () => {
    expect(getPatternStage(pattern(group(0, 1000, 9))).stage).toBe('learning');
    expect(getPatternStage(pattern(group(0, 1000, 10))).stage).toBe('usable');
    expect(getPatternStage(pattern(group(0, 1000, 40))).stage).toBe('proficient');
    expect(getPatternStage(pattern(group(0, 1000, 100))).stage).toBe('mastered');
  });

  it('沒有例句時不出錯', () => {
    expect(getMasteredCount(pattern(undefined as never))).toBe(0);
  });
});

describe('組別解鎖（每組 10 句都達 1000 分才解鎖下一組）', () => {
  it('第 0 組永遠解鎖', () => {
    expect(isGroupUnlocked(pattern([], 0), 0)).toBe(true);
    expect(isGroupUnlocked(pattern([], 0), 1)).toBe(false);
  });

  it('目前組別 10 句全部精熟 → 解鎖下一組', () => {
    expect(checkAndUpdateUnlockedGroups(pattern(group(0, 1000), 0))).toBe(1);
  });

  it('有一句未達 1000 → 不解鎖', () => {
    const s = [...group(0, 1000, 9), sentence(0, 999)];
    expect(checkAndUpdateUnlockedGroups(pattern(s, 0))).toBe(0);
  });

  it('句數不足 10 句 → 不解鎖', () => {
    expect(checkAndUpdateUnlockedGroups(pattern(group(0, 1000, 9), 0))).toBe(0);
  });

  it('最多解鎖到第 9 組', () => {
    expect(checkAndUpdateUnlockedGroups(pattern(group(9, 1000), 9))).toBe(9);
  });
});

describe('interleaveByKey', () => {
  it('不會遺漏或重複任何項目', () => {
    const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'c1'];
    const out = interleaveByKey(items, (s) => s[0]);
    expect([...out].sort()).toEqual([...items].sort());
  });

  it('能交錯時，相鄰項目不屬於同一組', () => {
    const items = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
    for (let t = 0; t < 50; t++) {
      const out = interleaveByKey(items, (s) => s[0]);
      for (let i = 1; i < out.length; i++) expect(out[i][0]).not.toBe(out[i - 1][0]);
    }
  });

  it('第一項避開 initialLastKey', () => {
    for (let t = 0; t < 30; t++) {
      expect(interleaveByKey(['a1', 'b1'], (s) => s[0], 'a')[0]).toBe('b1');
    }
  });
});
