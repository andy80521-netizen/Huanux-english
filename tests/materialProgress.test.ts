import { describe, it, expect } from 'vitest';
import { materialProgress } from '../src/utils/materialProgress';

// 教材進度：只算未刪除的句子；熟練度 ≥ 1000 算畢業。列表與詳情頁共用

type S = { mastery?: number; deleted?: boolean };
const s = (mastery: number | undefined, deleted?: boolean): S => ({ mastery, deleted });

describe('materialProgress', () => {
  it('空陣列 → 0 / 0', () => {
    expect(materialProgress([])).toEqual({ total: 0, completed: 0 });
  });

  it('沒有 sentences（舊資料）→ 0 / 0，不拋錯', () => {
    expect(materialProgress(undefined)).toEqual({ total: 0, completed: 0 });
    expect(materialProgress(null)).toEqual({ total: 0, completed: 0 });
  });

  it('全部刪除 → 0 / 0', () => {
    expect(materialProgress([s(1000, true), s(500, true)])).toEqual({ total: 0, completed: 0 });
  });

  it('含已刪除的句子：刪除的不算', () => {
    expect(materialProgress([s(1000), s(1000, true), s(300), s(0, true)])).toEqual({ total: 2, completed: 1 });
  });

  it('deleted 未設定或為 false 都算在內', () => {
    expect(materialProgress([s(10), s(20, false)])).toEqual({ total: 2, completed: 0 });
  });

  it('999 不算畢業；1000 與超過 1000 都算畢業', () => {
    expect(materialProgress([s(999), s(1000), s(1001)])).toEqual({ total: 3, completed: 2 });
  });

  it('熟練度缺少或不是數字 → 視為 0（算在總數，不算畢業）', () => {
    expect(materialProgress([s(undefined), { mastery: Number.NaN } as S, s(1000)])).toEqual({ total: 3, completed: 1 });
  });
});
