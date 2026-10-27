import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI 改版 ③a 的守門：既有文案不能掉、新文案到位、不再用舊色階、共用元件接線不變

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

const FILES = {
  today: 'src/components/TodayReviewView.tsx',
  session: 'src/components/PatternPracticeSessionView.tsx',
  mode: 'src/components/LanguageModelMode.tsx',
} as const;
type Key = keyof typeof FILES;
const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<Key, string>;
const app = read('src/App.tsx');

describe('既有文案仍存在（完整連續字串）', () => {
  const must: Array<[Key, string[]]> = [
    ['today', ['今日複習', '所有進度已完成', '維持複習', '上次沒有通過', '第一次維持複習', '今天沒有可以複習的句子', '去造更多新句型，或等待下一輪解鎖吧！', '本組練習完成', '練習句數', '熟練度合計', '本次精熟', '返回今日複習', '維持複習通過', '這次沒有通過', '這次不計算', '已經更新過了', '儲存失敗', '儲存結果中…', '有題目沒有完成評分，這次的結果不會更新，之後再做一次即可', '這個句型的維持複習已經更新過（或已延後），這次不重複計算', '請先登入以檢視今日複習',
      '共有 ', '個句子等待練習', '個句型要維持複習', '維持題 ', '已連續通過 ', '句中 ', '句全對即通過', '句熟練度降為 750，已回到今日複習，今天就可以重新練習', '下次維持複習：']],
    ['session', ['念出來練習', '播放題目', '語音準備中…', '語音暫時無法使用', '換一組題目', '正在準備題目…', '第一次練習這句需要幾秒鐘', '再試一次', '跳過這題', '聆聽中... (講完自動停止)', '分析語音與評分中...', '總分', '內容', '流暢', '目標原句', '您念的內容 (語音辨識)', '重播正確答案', '重播我的錄音', '目前熟練度', '再念一次', '下一句', '完成練習', '重新錄一次', '重試評分', '無法取得麥克風權限', '語音辨識或評分失敗，可以重試評分或重新錄一次', '回答這個問題', '情境任務', '看圖說出對應的句子',
      '個字不一致，熟練度未增加', '已到目前階段練習上限，', '天後可以繼續往上練習到更高分']],
    ['mode', ['今日複習', '句型庫']],
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
  it('今日複習：待練組別、待練平均，不再寫「來自句型：」「平均熟練度：」', () => {
    expect(src.today).toContain('待練組別');
    expect(src.today).toContain('待練平均');
    expect(src.today).not.toContain('來自句型：');
    expect(src.today).not.toContain('平均熟練度：');
  });
  it('念出來練習：新提示與一字不差標示', () => {
    expect(src.session).toContain('說出你造的那句話，一字不差才算數');
    expect(src.session).toContain('總分・一字不差');
  });
  it('題型小標去掉冒號', () => {
    for (const w of ['回答這個問題：', '情境任務：', '看圖說出對應的句子：']) expect(src.session).not.toContain(w);
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

describe('版面', () => {
  // ③b（PR #14）已拿掉 ③a 的暫時寬度；擁有者 2026-10-27 同意把這條改成新狀態
  it('語言模型外框用 SegmentedControl；③b 已拿掉 max-w-3xl 暫時寬度', () => {
    expect(src.mode).toContain('SegmentedControl');
    expect(src.mode).not.toContain('max-w-3xl');
  });
  it('App：語言模型分頁桌機寬度 1200px', () => {
    expect(app).toMatch(/WIDE_TABS\s*=\s*\[[^\]]*'languageModel'/);
    expect(app).toContain('lg:max-w-[1200px]');
  });
  it('今日複習的卡片不是可點的 div', () => {
    expect(src.today).not.toMatch(/<div[^>]*onClick/);
  });
});

describe('共用元件接線不變（今日複習與句型詳情共用）', () => {
  it('「完成練習」「下一句」都呼叫 onNext', () => {
    expect(src.session).toMatch(/onClick=\{onNext\}[^]*?完成練習/);
    expect(src.session).toMatch(/onClick=\{onNext\}[^]*?下一句/);
  });
  it('出題失敗的「跳過這題」沿用 isLastSentence ? onBack : onNext', () => {
    expect(src.session).toMatch(/onClick=\{isLastSentence \? onBack : onNext\}[^]*?跳過這題/);
  });
  it('每次評分都回報 onScored', () => {
    expect(src.session).toContain('onScored?.(sentenceObj.id, scores.total, isExact)');
  });
  it('增加量只在真的寫入時出現：更新函式開頭清空 outcome、以回傳值判斷', () => {
    expect(src.session).toMatch(/updatePatternSentences\(pattern\.id, \(sentences\) => \{\s*outcome = null;/);
    expect(src.session).toMatch(/const written = await updatePatternSentences/);
    expect(src.session).toContain('onMasteryUpdated');
    expect(src.today).toContain('onMasteryUpdated');
  });
});
