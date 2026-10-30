import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ③b 的守門：既有文案不能掉、新文案到位、不再用舊色階、版面與可及性
// 2026-10-31 擁有者同意：題組內容頁的「問答題／情境題／看圖題」改為「中文意思／情境／情境插圖」

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const FILES = {
  list: 'src/components/LanguageModelListView.tsx',
  detail: 'src/components/LanguageModelDetailView.tsx',
  groups: 'src/components/GroupSelectionView.tsx',
  groupDetail: 'src/components/GroupDetailView.tsx',
  practice: 'src/components/LanguageModelPracticeView.tsx',
  sightings: 'src/components/PatternSightingsSection.tsx',
  quick: 'src/components/PatternQuickCard.tsx',
} as const;
type Key = keyof typeof FILES;
const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<Key, string>;
const mode = read('src/components/LanguageModelMode.tsx');
const stage = read('src/utils/patternStage.ts');

describe('既有文案仍存在（完整連續字串）', () => {
  const must: Array<[Key, string[]]> = [
    ['list', ['語言模型庫', '從跟讀教材中萃取出的精華句型', '選取', '清除篩選', '取消全選', '全選目前結果', '刪除', '完成', '搜尋句型或中文語意...', '全部', '溝通功能', '此分類下無溝通功能標籤', '沒有符合條件的句型', '請嘗試更換搜尋關鍵字或調整篩選條件', '刪除句型', '尚無任何語言模型句型', '請先在教材裡完成跟讀練習並萃取句型。', '請先至「個人」頁面登入才能使用語言模型功能。', '已造句 ', '已精熟 ', '刪除中 ', '已刪除 ', '已選 ']],
    ['detail', ['學習重點', '使用時機', '情境標籤', '來自: ', '開始造句練習', '示範例句', '重新產生', '產生中…', '目前沒有示範例句，可以按「重新產生」建立', '重新產生例句？', '刪除這個句型？', '維持複習：', '上次沒有通過', '尚未開始', '刪除句型']],
    ['groups', ['選擇造句組別', '已造句：', '已精熟：', '完成上一組才能解鎖', '查看內容']],
    ['groupDetail', ['組內容', '進入這一組', '尚未造句', '可練習', '等待 ', '已精熟', '（還沒有造句）', '中文意思', '情境', '情境插圖', '尚未產生（練習時會自動產生）', '尚未產生（練習時會自動補產）']],
    ['practice', ['造句練習', '目標句型', '請用目標句型造一個英文句子：', '檢查通過：', '未通過檢查：', '自然道地', '文法正確', '拼字正確', '建議優化說法 ', '(部分調整)', '(整句重寫)', '使用建議優化說法', '確認送出, 完成這句', '檢查中...', '送出檢查', '從示範例句加入', '已加入', '加入', '本組10句已全部精熟', '您已經完成了這個句型的基本練習，現在可以開始念出來練習了。', '開始練習', '已解鎖第 ', '恭喜完成第 ', '重新產生']],
    ['sightings', ['在教材中出現', '播放原音', '親口念過 ', '還沒有在其他教材遇到這個句型。匯入新教材後會自動比對，舊教材可以在教材頁按「比對已學句型」。']],
    ['quick', ['這個句型已經不存在', '到「語言模型」分頁可以查看與練習這個句型', '已造句 ', '已精熟 ']],
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
  it('句型詳情：熟練度地圖與里程碑，拿掉「語意說明」', () => {
    expect(src.detail).toContain('熟練度地圖');
    expect(src.detail).toContain(' / 100 句精熟');
    expect(src.detail).toContain('可用 10');
    expect(src.detail).toContain('熟練 40');
    expect(src.detail).toContain('精通 100');
    expect(src.detail).not.toContain('語意說明');
  });
  it('造句練習：加入前會先檢查、副標含組別、拿掉表情符號', () => {
    expect(src.practice).toContain('加入前會先檢查');
    expect(src.practice).not.toContain('直接加入本組，不需檢查');
    expect(src.practice).toContain('組・第 ');
    expect(src.practice).not.toContain('🎉');
  });
  it('句型庫：手機篩選不再有冒號前綴', () => {
    for (const w of ['類型：', '情境：', '溝通功能：']) expect(src.list).not.toContain(w);
  });
});

describe('不再使用舊色階 class', () => {
  const banned = /-(?:slate|indigo|red|purple|emerald|amber|green|orange|yellow|sky)-(?:50|[1-9]00|850|950)(?![\w-])/g;
  const all: Array<[string, string]> = [
    ...Object.entries(FILES).map(([k, f]) => [f, src[k as Key]] as [string, string]),
    ['src/utils/patternStage.ts', stage],
    ['src/components/ui/MasterySegments.tsx', read('src/components/ui/MasterySegments.tsx')],
  ];
  for (const [file, text] of all) {
    it(file, () => {
      const hits = text.match(banned) ?? [];
      expect(hits, `仍使用：${[...new Set(hits)].join(', ')}`).toEqual([]);
    });
  }
});

describe('版面與可及性', () => {
  it('語言模型外框不再有 ③a 的 max-w-3xl 暫時寬度；句型庫由列表放切換', () => {
    expect(mode).not.toContain('max-w-3xl');
    expect(mode).toMatch(/<LanguageModelListView[\s\S]*?tabs=\{tabs\}/);
  });
  it('句型庫卡片：外層 article，不再是外層可點 div；刪除鈕有名稱；選取用 aria-pressed', () => {
    expect(src.list).toContain('<article');
    expect(src.list).not.toContain('onClick={() => (selectMode ? toggleSelected');
    expect(src.list).toContain('aria-label="刪除句型"');
    expect(src.list).toContain('aria-pressed');
  });
  it('句型詳情地圖有可及名稱；10 段與地圖用共用元件', () => {
    expect(src.detail).toContain('role="img"');
    expect(src.detail).toContain('MasterySegments');
    expect(src.list).toContain('MasterySegments');
    expect(src.quick).toContain('MasterySegments');
  });
  it('速覽卡是對話框：role、aria-modal、Esc 關閉、關閉鈕有名稱', () => {
    expect(src.quick).toContain('role="dialog"');
    expect(src.quick).toContain('aria-modal="true"');
    expect(src.quick).toContain("'Escape'");
    expect(src.quick).toContain('aria-label="關閉"');
  });
  it('造句輸入框與搜尋框字級至少 16px（iOS 聚焦不放大）', () => {
    expect(src.practice).toMatch(/<textarea[^>]*className="[^"]*(text-base|text-\[1[6-9]px\]|text-\[2\dpx\]|text-lg)/);
    expect(src.list).toMatch(/<input[^>]*className="[^"]*(text-base|text-\[1[6-9]px\])/);
  });
});
