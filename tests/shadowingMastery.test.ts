import { describe, it, expect } from 'vitest';
import { nextShadowingMastery } from '../src/utils/shadowingMastery';
import { isShadowingPass } from '../src/utils/scoring';

// 跟讀評分後的熟練度：必須與改版前 ShadowingPracticeView 的寫入完全相同
//   通過（isShadowingPass）才加：Math.min(1000, 舊值 + 總分)；gain = 新值 − 舊值

const pass = { content: 92, fluency: 85, total: 89 };
const failContent = { content: 60, fluency: 95, total: 75 };
const failTotal = { content: 80, fluency: 40, total: 65 };

describe('nextShadowingMastery', () => {
  it('前提：測試用分數的通過判斷與 isShadowingPass 一致', () => {
    expect(isShadowingPass(pass)).toBe(true);
    expect(isShadowingPass(failContent)).toBe(false);
    expect(isShadowingPass(failTotal)).toBe(false);
  });

  it('通過：640 + 89 → 729，增加 89', () => {
    expect(nextShadowingMastery(640, pass)).toEqual({ mastery: 729, gain: 89 });
  });

  it('接近上限：980 + 90 → 1000，實際只增加 20', () => {
    expect(nextShadowingMastery(980, { content: 95, fluency: 85, total: 90 })).toEqual({ mastery: 1000, gain: 20 });
  });

  it('已經 1000：維持 1000，增加 0', () => {
    expect(nextShadowingMastery(1000, pass)).toEqual({ mastery: 1000, gain: 0 });
  });

  it('內容未達標：不加分', () => {
    expect(nextShadowingMastery(640, failContent)).toEqual({ mastery: 640, gain: 0 });
  });

  it('總分未達標：不加分', () => {
    expect(nextShadowingMastery(640, failTotal)).toEqual({ mastery: 640, gain: 0 });
  });

  it('沿用現行行為：舊值超過 1000 且通過時寫成 1000', () => {
    const r = nextShadowingMastery(1500, pass);
    expect(r.mastery).toBe(1000);
    expect(r.gain).toBe(-500);
  });

  it('舊值超過 1000 但未通過：維持原值', () => {
    expect(nextShadowingMastery(1500, failTotal)).toEqual({ mastery: 1500, gain: 0 });
  });

  it('舊值缺少或不是數字 → 視為 0', () => {
    expect(nextShadowingMastery(undefined as unknown as number, pass)).toEqual({ mastery: 89, gain: 89 });
    expect(nextShadowingMastery(Number.NaN, pass)).toEqual({ mastery: 89, gain: 89 });
  });

  it('從 0 開始通過', () => {
    expect(nextShadowingMastery(0, { content: 70, fluency: 70, total: 70 })).toEqual({ mastery: 70, gain: 70 });
  });
});
