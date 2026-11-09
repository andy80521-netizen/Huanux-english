import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { saveButtonLabel } from '../src/utils/saveProgressLabel';

// 擁有者 2026-11-09 回報：按儲存後「沒反應」（進度只顯示在頁面最上方）
// 規劃：docs/plans/background-material-save.md（拆出的第 1 步，小級）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('存檔中按鈕文字', () => {
  it('翻譯中顯示進度', () => {
    expect(saveButtonLabel('translating', { done: 12, total: 35 })).toBe('翻譯中 12/35…');
    expect(saveButtonLabel('translating', null)).toBe('翻譯中…');
  });
  it('其他存檔中狀態 → 儲存中…；沒有在存檔 → null', () => {
    expect(saveButtonLabel('processing', null)).toBe('儲存中…');
    expect(saveButtonLabel('idle', null)).toBeNull();
  });
});

describe('接線', () => {
  it('校對畫面：手機與桌機的確認儲存按鈕都顯示進度文字與轉圈', () => {
    const p = read('src/components/MaterialReviewPanel.tsx');
    expect(p).toMatch(/savingLabel\?: string \| null/);
    expect((p.match(/\{savingLabel \?\? '確認儲存'\}/g) || []).length).toBe(2);
    expect(p).toMatch(/savingLabel \? <Loader2/);
  });
  it('匯入頁：傳入進度文字；文字轉語音存檔中也算存檔中', () => {
    const m = read('src/components/MaterialImportMode.tsx');
    expect(m).toMatch(/savingLabel=\{saveButtonLabel\(loadingState, translateProgress\)\}/);
    expect(m).toMatch(/isSaving=\{loadingState === 'translating' \|\| loadingState === 'processing'\}/);
  });
});
