import { describe, it, expect } from 'vitest';
import { importSteps, type ImportLoadingState } from '../src/utils/importSteps';

// UI 改版 ②b：匯入處理中的三步驟進度（純函式）

const statuses = (r: ReturnType<typeof importSteps>) => r?.steps.map((s) => s.status);
const labels = (r: ReturnType<typeof importSteps>) => r?.steps.map((s) => s.label);
const active = (r: ReturnType<typeof importSteps>) => r?.steps.find((s) => s.status === 'active');

const AUDIO = ['上傳音檔', '轉錄與斷句', '校對與翻譯'];
const TEXT = ['準備句子', '生成語音', '校對與儲存'];

describe('importSteps：沒有步驟可顯示時回傳 null', () => {
  for (const st of ['idle', 'uploading', 'analyzing', 'timestamping'] as ImportLoadingState[]) {
    it(st, () => {
      expect(importSteps(st, false, null)).toBeNull();
      expect(importSteps(st, true, { done: 1, total: 3 })).toBeNull();
    });
  }
});

describe('importSteps：音檔路徑', () => {
  it('uploadingAudio → 第 1 步進行中', () => {
    const r = importSteps('uploadingAudio', false, null);
    expect(labels(r)).toEqual(AUDIO);
    expect(statuses(r)).toEqual(['active', 'pending', 'pending']);
    expect(active(r)?.detail).toBe('正在上傳音檔至 Storage...');
  });

  it('transcribing → 第 2 步進行中，未開始的校對步驟附說明', () => {
    const r = importSteps('transcribing', false, null);
    expect(labels(r)).toEqual(AUDIO);
    expect(statuses(r)).toEqual(['done', 'active', 'pending']);
    expect(active(r)?.detail).toBe('Whisper 正在進行語音轉錄與斷句...');
    expect(r?.steps[2].detail).toBe('完成後先校對時間軸，確認儲存時再翻譯');
  });

  it('已完成的步驟不另加文字', () => {
    const r = importSteps('transcribing', false, null);
    expect(r?.steps[0].detail).toBeUndefined();
  });

  it('translating → 第 3 步進行中，沿用原本的翻譯進度文字', () => {
    const r = importSteps('translating', false, { done: 2, total: 9 });
    expect(labels(r)).toEqual(AUDIO);
    expect(statuses(r)).toEqual(['done', 'done', 'active']);
    expect(active(r)?.detail).toBe('正在翻譯（已完成 2 / 共 9 句）...');
  });

  it('translating 沒有進度時顯示 0 / 0（與現行相同）', () => {
    expect(active(importSteps('translating', false, null))?.detail).toBe('正在翻譯（已完成 0 / 共 0 句）...');
  });

  it('translating 不論 ttsPending 都走音檔路徑', () => {
    expect(labels(importSteps('translating', true, { done: 1, total: 2 }))).toEqual(AUDIO);
  });
});

describe('importSteps：文字與舊題庫路徑', () => {
  it('processing 且尚無待校對教材 → 第 1 步「準備句子」進行中', () => {
    const r = importSteps('processing', false, null);
    expect(labels(r)).toEqual(TEXT);
    expect(statuses(r)).toEqual(['active', 'pending', 'pending']);
    expect(active(r)?.detail).toBe('Gemini AI 正在處理中...');
  });

  it('generating → 第 2 步進行中，沿用原本的語音進度文字', () => {
    const r = importSteps('generating', false, { done: 1, total: 4 });
    expect(labels(r)).toEqual(TEXT);
    expect(statuses(r)).toEqual(['done', 'active', 'pending']);
    expect(active(r)?.detail).toBe('正在生成語音 (1/4)...');
  });

  it('generating 沒有進度時顯示 0/0', () => {
    expect(active(importSteps('generating', false, null))?.detail).toBe('正在生成語音 (0/0)...');
  });

  it('processing 且有 TTS 待校對教材（儲存中）→ 第 3 步「校對與儲存」進行中', () => {
    const r = importSteps('processing', true, null);
    expect(labels(r)).toEqual(TEXT);
    expect(statuses(r)).toEqual(['done', 'done', 'active']);
    expect(active(r)?.detail).toBe('Gemini AI 正在處理中...');
  });
});
