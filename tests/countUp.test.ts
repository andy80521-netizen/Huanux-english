import { describe, it, expect } from 'vitest';
import { countUpValue } from '../src/utils/countUp';

// 評分結果的數字跑動：ease-out 公式 1 − (1 − t)^3，回傳四捨五入後的整數

describe('countUpValue', () => {
  it('progress 0 → 起點', () => {
    expect(countUpValue(0, 89, 0)).toBe(0);
  });

  it('progress 1 → 終點', () => {
    expect(countUpValue(0, 89, 1)).toBe(89);
  });

  it('中間值依 ease-out 公式（t = 0.5 → 87.5%）', () => {
    // 1 − 0.5^3 = 0.875；0 + 89 × 0.875 = 77.875 → 78
    expect(countUpValue(0, 89, 0.5)).toBe(78);
    // 1 − 0.8^3 = 0.488；100 + 100 × 0.488 = 148.8 → 149
    expect(countUpValue(100, 200, 0.2)).toBe(149);
  });

  it('progress 超出範圍會夾住', () => {
    expect(countUpValue(0, 89, -1)).toBe(0);
    expect(countUpValue(0, 89, 3)).toBe(89);
  });

  it('progress 不是數字 → 視為已完成（直接顯示終點）', () => {
    expect(countUpValue(0, 89, Number.NaN)).toBe(89);
  });

  it('from > to 時遞減', () => {
    expect(countUpValue(100, 0, 0.5)).toBe(13);
    expect(countUpValue(100, 0, 1)).toBe(0);
  });

  it('前半段跑得比後半段快（ease-out）', () => {
    const first = countUpValue(0, 1000, 0.5) - countUpValue(0, 1000, 0);
    const second = countUpValue(0, 1000, 1) - countUpValue(0, 1000, 0.5);
    expect(first).toBeGreaterThan(second);
  });
});
