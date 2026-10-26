import { describe, expect, it } from 'vitest';
import { calculateFinalScores, calculateShadowingScores, calculateSimilarity, compareWords, normalizeForCompare, isShadowingPass } from '../src/utils/scoring';

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
    const r = calculateFinalScores('   ', 'I like apples', 2);
    expect([r.content, r.fluency, r.total]).toEqual([0, 0, 0]);
    expect(r.errors).toBe(3);
  });

  it('完全正確、速度適中時接近滿分', () => {
    const r = calculateFinalScores('I like apples very much', 'I like apples very much', 3);
    expect(r.content).toBe(100);
    expect(r.errors).toBe(0);
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
    for (const v of [r.content, r.fluency, r.total]) {
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

// 【v3.11】單字比對
describe('normalizeForCompare', () => {
  it('縮寫展開、標點忽略、大小寫一致', () => {
    expect(normalizeForCompare("I'm about to head out, so I'll call you.")).toEqual(
      normalizeForCompare('i am about to head out so I will call you')
    );
  });
  it('彎引號視同直引號', () => {
    expect(normalizeForCompare('I’m here')).toEqual(['i', 'am', 'here']);
  });
  it('0～99 數字轉英文字', () => {
    expect(normalizeForCompare('I have 10 cats and 25 dogs')).toEqual(['i', 'have', 'ten', 'cats', 'and', 'twenty', 'five', 'dogs']);
    expect(normalizeForCompare('twenty-five')).toEqual(['twenty', 'five']);
  });
  it('去掉口頭禪', () => {
    expect(normalizeForCompare('Um, I uh think so')).toEqual(['i', 'think', 'so']);
  });
});

describe('compareWords', () => {
  const T = "I'm about to head out, so I'll call you back later.";
  it('完全正確（含縮寫念成全寫）錯誤數為 0', () => {
    expect(compareWords(T, T).errors).toBe(0);
    expect(compareWords('I am about to head out so I will call you back later', T).errors).toBe(0);
    expect(compareWords(T, T).contentScore).toBe(100);
  });
  it('替換、漏念、多念各算 1 個錯', () => {
    expect(compareWords("I'm going to head out, so I'll call you back later.", T).errors).toBe(1);
    expect(compareWords("I'm about to head out, I'll call you back later.", T).errors).toBe(1);
    expect(compareWords("I'm about to head out, so I'll call you back later today.", T).errors).toBe(1);
  });
  it('內容分依句長比例扣分', () => {
    // 原句 13 字錯 1 個 → round(12/13×100) = 92
    expect(compareWords("I'm going to head out, so I'll call you back later.", T).contentScore).toBe(92);
  });
  it('不相干的句子內容分很低', () => {
    expect(compareWords('The weather in Sydney is really nice this time of year.', T).contentScore).toBeLessThan(20);
  });
  it('diff 標出漏念、念錯、多念', () => {
    const d = compareWords('the big red dog runs fast', 'the red cat runs').diff;
    expect(d.filter(x => x.type === 'extra').map(x => x.word)).toEqual(expect.arrayContaining(['big']));
    expect(d.find(x => x.type === 'wrong')).toMatchObject({ word: 'cat', said: 'dog' });
    const m = compareWords('the red runs', 'the red cat runs').diff;
    expect(m.find(x => x.type === 'missing')?.word).toBe('cat');
  });
  it('多念太多時內容分不會低於 0', () => {
    expect(compareWords('one two three four five six', 'hi').contentScore).toBe(0);
  });
});

describe('門檻（v3.11）', () => {
  const T = "I'm about to head out, so I'll call you back later.";
  it('複習：句型講錯時 errors > 0（不會累加熟練度）', () => {
    expect(calculateFinalScores("I'm going to head out, so I'll call you back later.", T, 4).errors).toBeGreaterThan(0);
  });
  it('複習：不相干句子總分遠低於 70', () => {
    expect(calculateFinalScores('The weather in Sydney is really nice this time of year.', T, 4).total).toBeLessThan(50);
  });
  it('跟讀：內容與總分都需 ≥ 70', () => {
    expect(isShadowingPass({ content: 70, total: 70 })).toBe(true);
    expect(isShadowingPass({ content: 69, total: 90 })).toBe(false);
    expect(isShadowingPass({ content: 90, total: 69 })).toBe(false);
  });
  it('跟讀：不相干的句子不會過關', () => {
    const r = calculateShadowingScores('The weather in Sydney is really nice this time of year.', T, 3, 3);
    expect(isShadowingPass(r)).toBe(false);
  });
});
