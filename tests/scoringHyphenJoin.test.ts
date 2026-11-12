import { describe, it, expect } from 'vitest';
import { compareWords } from '../src/utils/scoring';

// 擁有者 2026-11-12：原句 setups、轉文字 set-ups → 同一個詞被算 2 個錯（念錯＋多念）
// 相鄰兩個字合起來等於另一邊的一個字 → 算相同（兩個方向都適用）
const errorsOf = (user: string, target: string) => compareWords(user, target).errors;

describe('連字號／合寫：發音相同不扣分', () => {
  it('擁有者的例子：只剩漏念 you know 的 2 個錯，setups 標成正確、沒有多念', () => {
    const r = compareWords('With the iconic windows which had Christmas set-ups', 'With the iconic, you know, windows which had Christmas setups');
    expect(r.errors).toBe(2);
    expect(r.contentScore).toBe(80);
    expect(r.diff.find(d => d.word === 'setups')?.type).toBe('ok');
    expect(r.diff.some(d => d.type === 'extra')).toBe(false);
  });

  it('原句有連字號、轉文字是一個字', () => {
    expect(errorsOf('Christmas setups', 'Christmas set-ups')).toBe(0);
    expect(compareWords('Christmas setups', 'Christmas set-ups').diff.map(d => d.type)).toEqual(['ok', 'ok']);
  });

  // 實作時發現既有驗收測試（tests 中「不放寬」）要求 now here／nowhere、may be／maybe 仍算錯 → 只合併連字號拆出來的兩段
  it('連字號寫法兩個方向都算相同（cooperate／co-operate、reenter／re-enter）', () => {
    expect(errorsOf('they co-operate', 'they cooperate')).toBe(0);
    expect(errorsOf('they cooperate', 'they co-operate')).toBe(0);
    expect(errorsOf('please re-enter', 'please reenter')).toBe(0);
  });

  it('分開寫的兩個字不合併（維持既有規則：now here／nowhere 算錯）', () => {
    expect(errorsOf('a web site', 'a website')).toBeGreaterThan(0);
    expect(errorsOf('now here', 'nowhere')).toBeGreaterThan(0);
  });

  it('合起來不完全相同就照常扣分（不會過度放寬）', () => {
    expect(errorsOf('set up', 'setups')).toBe(2);
    expect(errorsOf('in two', 'into')).toBe(2);
    expect(errorsOf('set', 'setups')).toBe(1);
  });

  it('其他既有規則不受影響：數字、縮寫、口頭禪', () => {
    expect(errorsOf('twenty six stores', '26 stores')).toBe(0);
    expect(errorsOf("I am here", "I'm here")).toBe(0);
    expect(errorsOf('um I am here', "I'm here")).toBe(0);
  });
});
