import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ②b 的守門：既有文案不能掉、新文案到位、不再用舊色階、寬度限制已拿掉

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const FILES = {
  import: 'src/components/MaterialImportMode.tsx',
  review: 'src/components/MaterialReviewPanel.tsx',
  extract: 'src/components/ExtractPreviewDialog.tsx',
  retell: 'src/components/RetellView.tsx',
  feedback: 'src/components/RetellFeedbackPanel.tsx',
} as const;
type Key = keyof typeof FILES;

const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<Key, string>;
const detail = read('src/components/MaterialDetailView.tsx');

describe('既有文案仍存在（完整連續字串）', () => {
  const must: Array<[Key, string[]]> = [
    ['import', ['選擇音檔 (.mp3)', '直接送出文字', '上傳檔案', '匯入選定題庫', '尚無舊題庫資料', '取消匯入', '重試', '生成語音，開始跟讀', '萃取語言模型', '請先登入', '檔案超過 24MB，請壓縮或改用較短的音檔']],
    ['review', ['校對內容', '確認儲存', '至少需保留 1 句才能存檔', '此句的斷句或時間可能不準，建議優先核對', '原文 (English)', '翻譯 (Chinese)', '開始 (s)', '結束 (s)', '播放片段', '暫停播放', '復原', '確定存檔', '將永久捨棄', '開始時間必須小於結束時間', '寫實攝影', '日系動漫', '不產生封面']],
    ['extract', ['全部不要', '加入中…']],
    ['retell', ['複述練習', '重聽這一段', '停止播放', '試著用上這些句型', '按下開始錄音，最長 3 分鐘', '我說完了', '停下來想沒關係，不會自動結束', '你說的（語音辨識）', '重試分析', '重新錄一次', '再複述一次', '重播我的錄音', '當時說的', '無法取得麥克風權限', '語音辨識中…', '分析你的複述中…']],
    ['feedback', ['內容涵蓋', '語言表現', '語言修正', '句型運用', '示範版本', '播放示範', '語音準備中…', '用對了', '用錯了', '沒用到', '漏掉：']],
  ];
  for (const [key, words] of must) {
    for (const w of words) {
      it(`${FILES[key]} 含「${w}」`, () => {
        expect(src[key]).toContain(w);
      });
    }
  }
});

describe('擁有者同意的新文案', () => {
  it('匯入頁說明', () => {
    expect(src.import).toContain('選一種方式匯入。原文會逐句斷句並翻譯，不會摘要或改寫。');
  });
  for (const sub of ['真人 mp3（podcast、廣播），自動切出每句時間', '貼上英文，或上傳 .txt／.pdf，用 AI 語音產生原音', '把舊版課程的題目轉成教材']) {
    it(`選項卡說明「${sub}」`, () => {
      expect(src.import).toContain(sub);
    });
  }
  it('匯入頁使用 importSteps 顯示處理步驟，並有「正在匯入」', () => {
    expect(src.import).toContain('importSteps(');
    expect(src.import).toContain('正在匯入');
  });
  it('封面風格標籤去掉冒號', () => {
    expect(src.review).toContain('封面風格');
    expect(src.review).not.toContain('封面風格：');
  });
  it('複述計時以 MAX_SECONDS 組出「/ 3:00」', () => {
    expect(src.retell).toContain('formatTime(MAX_SECONDS)');
  });
});

describe('本 PR 的元件不再使用舊色階 class', () => {
  const banned = /-(?:slate|indigo|red|purple|emerald|amber|green|orange|yellow)-(?:50|[1-9]00|850|950)(?![\w-])/g;
  for (const [key, file] of Object.entries(FILES) as Array<[Key, string]>) {
    it(file, () => {
      const hits = src[key].match(banned) ?? [];
      expect(hits, `仍使用：${[...new Set(hits)].join(', ')}`).toEqual([]);
    });
  }
});

describe('版面與行為', () => {
  it('匯入頁與詳情頁不再有 ②a 的 max-w-3xl 暫時限制', () => {
    expect(src.import).not.toContain('max-w-3xl');
    expect(detail).not.toContain('max-w-3xl');
  });
  it('校對頁封面風格改用 SegmentedControl，且保留 huanux_cover_style', () => {
    expect(src.review).toContain('SegmentedControl');
    expect(src.review).toContain('huanux_cover_style');
  });
  it('萃取預覽不處理 Escape（取消＝全部不要，有副作用）', () => {
    expect(src.extract).not.toMatch(/Escape|keydown|onKeyDown/);
  });
  it('複述回饋分數動畫可關閉（animateScores）並使用 countUpValue', () => {
    expect(src.feedback).toContain('animateScores');
    expect(src.feedback).toContain('countUpValue(');
  });
});
