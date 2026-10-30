import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ④ 的守門：勳章房、個人、App 外框（擁有者 2026-10-27 核准設計稿與文案）
// 2026-10-30 擁有者同意：移除 GitHub 登入，「使用 GitHub 登入」改為「使用 Google 登入」

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const badge = read('src/components/BadgeMode.tsx');
const personal = read('src/components/PersonalMode.tsx');
const app = read('src/App.tsx');

describe('既有文案仍存在', () => {
  const must: Array<[string, string, string[]]> = [
    ['BadgeMode', badge, ['成就徽章', '精熟 10 句即「可用」，40 句「熟練」，100 句「精通」', '尚未開始任何句型', '去句型庫新增並練習，即可在這裡看到成就。', '請先登入以檢視成就徽章', '載入中...', '還差 ']],
    ['PersonalMode', personal, [
      '設定與個人', '資料同步中', '提示：匿名帳號資料在清除瀏覽器快取後會遺失，建議註冊帳號。', 'Anonymous User', '訪客', '使用者',
      '登入帳號', '註冊新帳號', '跨裝置同步學習進度', '設定資料庫連線', '使用預設資料庫中', '使用 Google 登入', '或使用 Email',
      '您的暱稱', '電子郵件', '密碼', '立即登入', '開始註冊', '沒有帳號？前往註冊', '已有帳號？前往登入', '以訪客身分繼續使用',
      '中文語音', '英文語音', '試聽語音', '提示：手機與電腦內建的語音包不同。若覺得預設聲音不自然，請在此手動選擇。', '登出帳號',
      'Huanux ENGLISH v1.8.1', '跟隨系統', '淺色', '深色',
      'Firebase 設定', '如何取得設定碼：', '儲存並套用', '重設',
    ]],
  ];
  for (const [name, src, words] of must) {
    for (const w of words) {
      it(`${name} 含「${w}」`, () => expect(src).toContain(w));
    }
  }
});

describe('新文案', () => {
  const must: Array<[string, string, string[]]> = [
    ['BadgeMode', badge, ['已取得的勳章', ' 枚', '下一枚勳章', '再精熟 ', ' 句就是「', '所有句型・', ' 句到「', '三枚勳章都已取得', '已精熟 ', ' / 100', '讀取句型失敗，請檢查網路後再試一次', '重試']],
    ['PersonalMode', personal, ['語音設定', '自動選擇（推薦）', '外觀']],
  ];
  for (const [name, src, words] of must) {
    for (const w of words) {
      it(`${name} 含「${w}」`, () => expect(src).toContain(w));
    }
  }
});

describe('移除的文案', () => {
  it('勳章房不再有「Achieved」「已精熟句數：」', () => {
    expect(badge).not.toContain('Achieved');
    expect(badge).not.toContain('已精熟句數：');
  });
  it('個人頁不再有「(TTS)」「✨」「自動選擇 (推薦)」', () => {
    expect(personal).not.toContain('(TTS)');
    expect(personal).not.toContain('✨');
    expect(personal).not.toContain('自動選擇 (推薦)');
  });
});

describe('不再使用舊色階', () => {
  const OLD = /\b(?:bg|text|border|ring|from|via|to|shadow|outline|fill|stroke|divide|placeholder)-(?:slate|indigo|red|green|orange|emerald|amber|yellow|purple|violet|rose|sky|blue|gray|zinc)-\d{2,3}\b/;
  for (const [name, src] of [['BadgeMode', badge], ['PersonalMode', personal], ['App.tsx', app]] as const) {
    it(`${name} 沒有舊色階`, () => expect(src).not.toMatch(OLD));
  }
});

describe('結構與無障礙', () => {
  it('App.tsx 拿掉 WIDE_TABS 與 768px 寬度', () => {
    expect(app).not.toContain('WIDE_TABS');
    expect(app).not.toContain('max-w-3xl');
  });
  it('Firebase 設定對話框是 dialog、aria-modal、有標題關聯', () => {
    expect(personal).toContain('role="dialog"');
    expect(personal).toContain('aria-modal="true"');
    expect(personal).toMatch(/aria-labelledby=/);
  });
  it('設定鈕閃爍只在允許動態時', () => {
    expect(personal).not.toMatch(/(?<!motion-safe:)animate-pulse/);
    expect(personal).toContain('motion-safe:animate-pulse');
  });
  it('BadgeMode：錯誤回呼會更新畫面、retryKey 在訂閱 effect 依賴裡、用 patternLoadReducer', () => {
    const m = badge.match(/\},\s*\((?:err|error|e)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\b(?:dispatch|set[A-Z]\w*)\(/);
    expect(badge).toMatch(/\[[^\]]*\bretryKey\b[^\]]*\]\s*\);/);
    expect(badge).toContain('patternLoadReducer');
  });
  it('BadgeMode 用 badges.ts 的計算', () => {
    for (const fn of ['badgeSummary', 'nextBadge', 'badgeRows']) expect(badge).toContain(fn);
  });
});
