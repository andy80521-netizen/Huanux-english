import { describe, expect, it } from 'vitest';
import { calculateFinalScores, calculateShadowingScores, calculateSimilarity } from '../src/utils/scoring';

describe('calculateSimilarity', () => {
  it('完全相同（忽略大小寫與標點）為 100', () => {
    expect(calculateSimilarity('Hello, World!', 'hello world')).toBe(100);
  });

  it('空字串為 0', () => {
    expect(calculateSimilarity('', 'hello')).toBe(0);
    expect(calculateSimilarity('hello', '')).toBe(0);
    expect(calculateSimilarity('!!!', 'hello')).toBe(0);
  });

  it('差一個字母時介於 0 與 100 之間', () => {
    const s = calculateSimilarity('cat', 'bat');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });

  it('結果永遠落在 0～100', () => {
    for (const [a, b] of [['a', 'zzzzzzzz'], ['abc', 'xyz'], ['short', 'a much longer sentence']]) {
      const s = calculateSimilarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateFinalScores', () => {
  it('沒有講話時全部為 0', () => {
    expect(calculateFinalScores('   ', 'I like apples', 2)).toEqual({ pronunciation: 0, fluency: 0, stress: 0, total: 0 });
  });

  it('完全正確、速度適中時接近滿分', () => {
    const r = calculateFinalScores('I like apples very much', 'I like apples very much', 3);
    expect(r.pronunciation).toBe(100);
    expect(r.fluency).toBe(100);
    expect(r.total).toBe(100);
  });

  it('講太慢會扣流暢度', () => {
    const normal = calculateFinalScores('I like apples very much', 'I like apples very much', 3);
    const slow = calculateFinalScores('I like apples very much', 'I like apples very much', 12);
    expect(slow.fluency).toBeLessThan(normal.fluency);
  });

  it('所有分數都在 0～100', () => {
    const r = calculateFinalScores('totally different words here', 'I like apples very much', 60);
    for (const v of Object.values(r)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateShadowingScores', () => {
  const target = 'the quick brown fox jumps';

  it('講話時間為原音 90%～130% 時流暢度滿分', () => {
    expect(calculateShadowingScores(target, target, 10, 10).fluency).toBe(100);
    expect(calculateShadowingScores(target, target, 12, 10).fluency).toBe(100);
  });

  it('太快或太慢都會扣分', () => {
    expect(calculateShadowingScores(target, target, 5, 10).fluency).toBeLessThan(100);
    expect(calculateShadowingScores(target, target, 20, 10).fluency).toBeLessThan(100);
  });

  it('原音長度為 0 時不會出錯', () => {
    const r = calculateShadowingScores(target, target, 3, 0);
    expect(Number.isFinite(r.total)).toBe(true);
  });
});
