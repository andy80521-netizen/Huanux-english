import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 修正「一直卡在載入中」：監聽失敗、文件不存在、未登入都要有自己的畫面（擁有者 2026-10-27 核准文案）

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const review = read('src/components/TodayReviewView.tsx');
const list = read('src/components/LanguageModelListView.tsx');
const detail = read('src/components/LanguageModelDetailView.tsx');

const LOAD_FAILED = '讀取句型失敗，請檢查網路後再試一次';

/** 取出 onSnapshot 的錯誤回呼內容（第二個參數） */
function errorHandlers(src: string): string[] {
  const out: string[] = [];
  const re = /\},\s*\((?:err|error|e)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

describe('新文案', () => {
  it('今日複習有讀取失敗訊息與重試', () => {
    expect(review).toContain(LOAD_FAILED);
    expect(review).toContain('重試');
  });
  it('句型庫有讀取失敗訊息與重試', () => {
    expect(list).toContain(LOAD_FAILED);
    expect(list).toContain('重試');
  });
  it('句型詳情：找不到、讀取失敗、未登入', () => {
    expect(detail).toContain('找不到這個句型，可能已在其他裝置刪除');
    expect(detail).toContain(LOAD_FAILED);
    expect(detail).toContain('請先登入');
    expect(detail).toContain('回到句型庫');
    expect(detail).toContain('重試');
  });
});

describe('監聽失敗不能只印 console', () => {
  for (const [name, src] of [['TodayReviewView', review], ['LanguageModelListView', list], ['LanguageModelDetailView', detail]] as const) {
    it(`${name} 的 onSnapshot 錯誤回呼會更新畫面狀態`, () => {
      const hs = errorHandlers(src);
      expect(hs.length).toBeGreaterThan(0);
      for (const h of hs) expect(h).toMatch(/\bset[A-Z]\w*\(/);
    });
    it(`${name} 重試會重新訂閱（重試計數在 effect 依賴裡）`, () => {
      expect(src).toMatch(/\[[^\]]*\bretryKey\b[^\]]*\]\s*\);/);
    });
  }
});

describe('句型詳情：文件不存在要結束載入', () => {
  it('snapshot.exists() 為 false 時有處理分支', () => {
    expect(detail).toMatch(/if\s*\(\s*snapshot\.exists\(\)\s*\)\s*\{[^}]*\}\s*else\s*\{[^}]*\bset[A-Z]\w*\(/);
  });
});

describe('句型庫：讀取失敗不可顯示成空的句型庫', () => {
  it('錯誤畫面的判斷在「尚無任何語言模型句型」之前', () => {
    const errIdx = list.indexOf(LOAD_FAILED);
    const emptyIdx = list.indexOf('尚無任何語言模型句型');
    expect(errIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(emptyIdx);
  });
});
