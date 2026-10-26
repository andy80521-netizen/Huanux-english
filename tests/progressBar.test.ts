import { describe, it, expect } from 'vitest';
import { progressPercents } from '../src/utils/progress';

// progressPercents(value, max, gain)：value 是目前總值（已含本次增加的 gain），
// 回傳「原本那段」與「本次增加那段」各佔的百分比，兩段相加不超過 100

describe('progressPercents', () => {
  it('一般情況：640 / 1000 → 64%', () => {
    expect(progressPercents(640, 1000)).toEqual({ basePct: 64, gainPct: 0 });
  });

  it('含本次增加：729 / 1000，增加 89 → 原本 64%、增加 8.9%', () => {
    const r = progressPercents(729, 1000, 89);
    expect(r.basePct).toBeCloseTo(64, 10);
    expect(r.gainPct).toBeCloseTo(8.9, 10);
  });

  it('剛好滿 → 100%', () => {
    expect(progressPercents(1000, 1000)).toEqual({ basePct: 100, gainPct: 0 });
  });

  it('超過上限 → 兩段合計 100%', () => {
    const r = progressPercents(1100, 1000, 200);
    expect(r.basePct + r.gainPct).toBeCloseTo(100, 10);
    expect(r.basePct).toBeCloseTo(90, 10);
    expect(r.gainPct).toBeCloseTo(10, 10);
  });

  it('max 為 0 或負數 → 0%（不除以零）', () => {
    expect(progressPercents(10, 0)).toEqual({ basePct: 0, gainPct: 0 });
    expect(progressPercents(10, -5, 3)).toEqual({ basePct: 0, gainPct: 0 });
  });

  it('負值 → 0%', () => {
    expect(progressPercents(-20, 1000)).toEqual({ basePct: 0, gainPct: 0 });
    expect(progressPercents(500, 1000, -30)).toEqual({ basePct: 50, gainPct: 0 });
  });

  it('gain 大於 value → 原本 0%，增加那段等於 value', () => {
    expect(progressPercents(50, 100, 80)).toEqual({ basePct: 0, gainPct: 50 });
  });

  it('非數字 → 0%', () => {
    expect(progressPercents(Number.NaN, 1000)).toEqual({ basePct: 0, gainPct: 0 });
    expect(progressPercents(500, Number.NaN)).toEqual({ basePct: 0, gainPct: 0 });
    expect(progressPercents(500, 1000, Number.NaN)).toEqual({ basePct: 50, gainPct: 0 });
  });
});
