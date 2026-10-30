import { describe, it, expect } from 'vitest';

// 刪除沒有任何地方在用的 enableBackgroundAudioHack（擁有者 2026-10-30 同意）

describe('enableBackgroundAudioHack 已移除', () => {
  it('utils 不再匯出 enableBackgroundAudioHack', async () => {
    const u = await import('../src/utils');
    expect('enableBackgroundAudioHack' in u).toBe(false);
  });
  it('仍在使用的 SILENT_AUDIO 保留', async () => {
    const u = await import('../src/utils');
    expect(u.SILENT_AUDIO).toMatch(/^data:audio\/mp3;base64,/);
  });
});
