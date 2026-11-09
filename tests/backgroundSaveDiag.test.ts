import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeSaveJob, SAVE_STALL_NO_START_MS } from '../src/utils/saveJob';

// 擁有者 2026-11-09 回報：正式版背景存檔停在「可能中斷了 0/134」，重試仍一樣；伺服器沒有留下原因
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('背景存檔診斷', () => {
  it('可能中斷了時顯示伺服器寫回的診斷說明', () => {
    const now = 2_000_000;
    const v = describeSaveJob({ status: 'saving', title: 'A', progress: { done: 0, total: 134 }, saveRequestedAt: now - SAVE_STALL_NO_START_MS - 1, saveDiag: '第 2 次：出錯：開始交易失敗 (HTTP 403)' }, now);
    expect(v).toMatchObject({ kind: 'stalled' });
    expect(v!.text).toContain('開始交易失敗 (HTTP 403)');
  });
  it('背景函式：收到請求、出錯、未認領時都寫回診斷', () => {
    const f = read('netlify/functions/save-material.ts');
    expect(f).toMatch(/await diag\('伺服器已收到'\)/);
    expect(f).toMatch(/await diag\(`出錯：/);
    expect(f).toMatch(/patchFields\(/);
  });
  it('REST 錯誤訊息附上回應內容（找原因用）', () => {
    expect(read('netlify/shared/firestoreRest.ts')).toMatch(/開始交易失敗 \(HTTP \$\{begin\.status\}\) \$\{b\.slice\(0, 160\)\}/);
  });
});
