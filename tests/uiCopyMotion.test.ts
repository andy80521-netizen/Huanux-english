import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ⑤ 的守門：新文案、動畫定義、減少動態、接線（擁有者 2026-10-27 核准）

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const css = read('src/styles/app.css');
const today = read('src/components/TodayReviewView.tsx');
const practice = read('src/components/LanguageModelPracticeView.tsx');
const badge = read('src/components/BadgeMode.tsx');
const app = read('src/App.tsx');
const materialMode = read('src/components/MaterialImportMode.tsx');
const lmMode = read('src/components/LanguageModelMode.tsx');
const materialList = read('src/components/MaterialListView.tsx');
const lmList = read('src/components/LanguageModelListView.tsx');

describe('文案', () => {
  it('本組練習完成：新勳章、精熟句數、整組精熟', () => {
    for (const w of ['新勳章', '這個句型已精熟 ', ' 10 句全部精熟', '本組練習完成', '返回今日複習']) expect(today).toContain(w);
  });
  it('解鎖文字不變', () => {
    expect(practice).toContain('已解鎖第 ');
    expect(practice).toContain(' 組！');
  });
  it('印章依實際門檻顯示，不寫死「熟練」', () => {
    expect(today).toContain('sessionHighlights');
    expect(today).toMatch(/newTier\.tier/);
  });
});

describe('動畫定義', () => {
  for (const k of ['page-in', 'stamp', 'ripple', 'pop-in', 'unlock', 'burst']) {
    it(`app.css 有 @keyframes ${k}`, () => expect(css).toMatch(new RegExp(`@keyframes ${k}\\s*\\{`)));
  }
  it('page-in 結束值是 transform: none（不留下影響 fixed 對話框的 transform）', () => {
    const m = css.match(/@keyframes page-in\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/to\s*\{[^}]*transform:\s*none/);
  });
  it('減少動態：全域規則仍在，且延遲歸零', () => {
    const m = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(m![1]).toMatch(/animation-delay:\s*0s\s*!important/);
    expect(m![1]).toMatch(/transition-delay:\s*0s\s*!important/);
  });
});

describe('接線', () => {
  it('App、教材、語言模型的畫面切換用 PageEnter', () => {
    for (const src of [app, materialMode, lmMode]) expect(src).toContain('PageEnter');
  });
  it('有刪除鈕的卡片只在按標題時輕壓', () => {
    for (const src of [materialList, lmList]) {
      expect(src).toContain('data-card-link');
      expect(src).toContain('has-[[data-card-link]:active]:scale-[0.985]');
    }
  });
  it('今日複習卡片按下輕壓', () => {
    expect(today).toContain('active:scale-[0.985]');
  });
  it('勳章房：只播一次、數字跑動、逐列延遲有上限、減少動態不加延遲', () => {
    expect(badge).toMatch(/let \w+ = false/);
    expect(badge).toContain('countUpValue');
    expect(badge).toMatch(/Math\.min\([^)]*480\)/);
    expect(badge).toContain('prefersReducedMotion');
  });
  it('解鎖卡片有彈出、鎖環、金點動畫', () => {
    for (const k of ['animate-pop-in', 'animate-unlock', 'animate-burst']) expect(practice).toContain(k);
  });
  it('印章卡有蓋章與漣漪動畫', () => {
    for (const k of ['animate-stamp', 'animate-ripple']) expect(today).toContain(k);
  });
});
