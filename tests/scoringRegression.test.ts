import { describe, it, expect } from 'vitest';
import { compareWords } from '../src/utils/scoring';

// PR #6 Codex 審查發現的回歸案例
const errs = (user: string, target: string) => compareWords(user, target).errors;

describe('英數混合字保留原樣', () => {
  it('不同數字不能判為相同', () => {
    expect(errs('I take B6', 'I take B12')).toBeGreaterThanOrEqual(1);
    expect(errs('the 2nd floor', 'the 1st floor')).toBeGreaterThanOrEqual(1);
    expect(errs('in the 1980s', 'in the 1990s')).toBeGreaterThanOrEqual(1);
  });

  it('相同的英數混合字算對', () => {
    expect(errs('I take B12', 'I take B12')).toBe(0);
    expect(errs('the 1st floor', 'the 1st floor')).toBe(0);
  });
});

describe('一般單字不會撞到物件內建屬性', () => {
  it('constructor、toString 等字可以正常評分', () => {
    expect(errs('constructor', 'constructor')).toBe(0);
    expect(errs('the toString hasOwnProperty valueOf', 'the toString hasOwnProperty valueOf')).toBe(0);
  });
});

describe('複合縮寫', () => {
  it("I'd've、wouldn't've 與完整念法雙向算對", () => {
    expect(errs('I would have left', "I'd've left")).toBe(0);
    expect(errs("I'd've left", 'I would have left')).toBe(0);
    expect(errs('I would not have gone', "I wouldn't've gone")).toBe(0);
  });
});
