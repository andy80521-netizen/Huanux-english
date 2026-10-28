import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 跟讀辨識改善：文案與結構守門（行為以 shadowingPlayback.test.ts 為準）

const src = readFileSync(resolve(__dirname, '..', 'src/components/ShadowingPracticeView.tsx'), 'utf8');

describe('文案', () => {
  const must = [
    '建議戴有線耳機練習',
    '跟讀時會同時播放原音和錄你的聲音。沒戴耳機時，原音會被麥克風收進去，你的聲音容易被壓掉，辨識變差、分數偏低。',
    '藍牙耳機在錄音時音質會變差，有線耳機效果最好。沒有耳機也可以練，',
    '不再提醒', '取消',
    '錄音時原音會調小聲，讓你的聲音更清楚',
    '建議戴耳機，讓收音更清楚',
    '聽聽看', '重疊播放：同時聽你的錄音和原音', '我的錄音', '原音', '重疊播放',
    // 既有文案
    '開始跟讀', '重播我的錄音', '請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。',
  ];
  for (const w of must) it(`含「${w}」`, () => expect(src).toContain(w));
});

describe('結構', () => {
  it('耳機提醒卡是對話框', () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
  });
  it('使用播放控制器與音量工具', () => {
    for (const k of ['createListenPlayer', 'canSetElementVolume', 'RECORDING_ORIGINAL_VOLUME', 'shouldShowHeadphoneTip', 'dismissHeadphoneTip', 'restoreOriginalVolume']) expect(src).toContain(k);
  });
  it('三個播放按鈕有 aria-pressed', () => {
    expect((src.match(/aria-pressed=/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('本 PR 不做 Web Audio：原音不設 crossOrigin、不用 createMediaElementSource', () => {
    expect(src).not.toMatch(/crossOrigin/);
    expect(src).not.toContain('createMediaElementSource');
  });
  it('音量還原在多個路徑都有呼叫（換句、重錄、結束、卸載）', () => {
    expect((src.match(/restoreOriginalVolume\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
