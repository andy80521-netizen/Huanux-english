import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ②a 的守門：既有文案不能在改版時掉了、本 PR 的元件不再用舊色階、熟練度寫入走共用函式

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const FILES = {
  list: 'src/components/MaterialListView.tsx',
  detail: 'src/components/MaterialDetailView.tsx',
  practice: 'src/components/ShadowingPracticeView.tsx',
  diff: 'src/components/WordDiffView.tsx',
  retell: 'src/components/RetellSection.tsx',
  dialog: 'src/components/ConfirmDialog.tsx',
} as const;

const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<keyof typeof FILES, string>;

describe('既有文案仍存在', () => {
  const must: Array<[keyof typeof FILES, string[]]> = [
    ['practice', ['開始跟讀', '我念完了', '再念一次', '下一句', '重播我的錄音', '重新錄一次', '重試評分', '已完成本教材所有句子', '您實際念的內容', '請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。', '教材播放完畢，您可以繼續補完發音', '正在播放並同步錄音中', 'AI 評分中']],
    ['list', ['我的教材庫', '匯入新教材', '立即匯入', '確認刪除', '尚無任何教材', '請先登入', '無法讀取教材列表']],
    ['detail', ['跟讀', '重新比對', '比對已學句型', '產生封面', '重新產生封面', '寫實攝影', '日系動漫', '至少需保留 1 句', '已學句型比對', '低信心度', '已精熟', '含句型：', '封面產生失敗']],
    ['retell', ['複述練習', '聽完一段，用自己的話說出重點', '重新分段', '開始分段', '複述']],
    ['diff', ['逐字比對']],
  ];
  for (const [key, words] of must) {
    for (const w of words) {
      it(`${FILES[key]} 含「${w}」`, () => {
        expect(src[key]).toContain(w);
      });
    }
  }
});

describe('擁有者同意的文案變更', () => {
  it('詳情頁萃取鈕改為「萃取」「重新萃取」，舊文案不殘留', () => {
    expect(src.detail).toContain('重新萃取');
    expect(src.detail).not.toContain('萃取語言模型');
    expect(src.detail).not.toContain('已萃取・重新萃取');
  });

  it('句子卡不再顯示「Mastery:」文字標籤', () => {
    expect(src.detail).not.toContain('Mastery:');
  });

  it('列表進度改成「句畢業」', () => {
    expect(src.list).toContain('句畢業');
  });

  it('逐字比對說明改成「底線＝漏念」，不再寫「紅底」', () => {
    expect(src.diff).toContain('底線＝漏念');
    expect(src.diff).not.toContain('紅底');
  });
});

describe('本 PR 的元件不再使用舊色階 class（改用語意 token）', () => {
  const banned = /-(?:slate|indigo|red|purple|emerald|amber|green|orange)-(?:50|[1-9]00|850|950)(?![\w-])/g;
  for (const [key, file] of Object.entries(FILES) as Array<[keyof typeof FILES, string]>) {
    it(file, () => {
      const hits = src[key].match(banned) ?? [];
      expect(hits, `仍使用：${[...new Set(hits)].join(', ')}`).toEqual([]);
    });
  }
});

describe('熟練度寫入走共用函式', () => {
  it('ShadowingPracticeView 使用 nextShadowingMastery，不再自己算', () => {
    expect(src.practice).toContain('nextShadowingMastery(');
    expect(src.practice).not.toMatch(/Math\.min\(\s*1000\s*,\s*sentence\.mastery/);
  });

  it('列表與詳情都用 materialProgress 計算進度', () => {
    expect(src.list).toContain('materialProgress(');
    expect(src.detail).toContain('materialProgress(');
  });
});

describe('列表卡片不可按鈕包按鈕', () => {
  it('刪除教材鈕有 aria-label，且卡片外層不是 <button>', () => {
    expect(src.list).toContain('aria-label="刪除教材"');
    // 卡片外框用 <article>（非互動），進詳情的 button 與刪除鈕同層
    expect(src.list).toMatch(/<article/);
  });
});
