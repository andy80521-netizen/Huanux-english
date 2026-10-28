import { describe, it, expect } from 'vitest';
import {
  RECORDING_ORIGINAL_VOLUME, OVERLAY_ORIGINAL_VOLUME, OVERLAY_OFFSET_MAX_MS, HEADPHONE_TIP_KEY,
  canSetElementVolume, overlayOffsetMs, sentenceSegment, shouldShowHeadphoneTip, dismissHeadphoneTip,
} from '../src/utils/shadowingAudio';

// 跟讀辨識改善：音量偵測、對齊、句子範圍、耳機提醒（擁有者 2026-10-28 核准）

describe('音量常數（擁有者決定先用 50%）', () => {
  it('錄音時與重疊播放的原音音量都是 0.5；對齊上限 3000ms；提醒鍵帶版本', () => {
    expect(RECORDING_ORIGINAL_VOLUME).toBe(0.5);
    expect(OVERLAY_ORIGINAL_VOLUME).toBe(0.5);
    expect(OVERLAY_OFFSET_MAX_MS).toBe(3000);
    expect(HEADPHONE_TIP_KEY).toBe('huanux_headphone_tip_dismissed_v1');
  });
});

describe('canSetElementVolume', () => {
  it('可以設定 → true，結束後還原為 1', () => {
    const probe = { volume: 1 };
    expect(canSetElementVolume(probe)).toBe(true);
    expect(probe.volume).toBe(1);
  });
  it('像 iPhone 一樣唯讀（讀回仍是 1）→ false', () => {
    const probe = { get volume() { return 1; }, set volume(_v: number) { /* 忽略 */ } };
    expect(canSetElementVolume(probe)).toBe(false);
  });
  it('設定時丟錯 → false 且不丟錯', () => {
    const probe = { get volume() { return 1; }, set volume(_v: number) { throw new Error('nope'); } };
    expect(() => canSetElementVolume(probe)).not.toThrow();
    expect(canSetElementVolume(probe)).toBe(false);
  });
  it('沒有探測元素 → false', () => {
    expect(canSetElementVolume(null)).toBe(false);
    expect(canSetElementVolume(undefined)).toBe(false);
  });
});

describe('overlayOffsetMs', () => {
  it('原音比錄音晚開始多少毫秒', () => {
    expect(overlayOffsetMs(1000, 1240)).toBe(240);
  });
  it('負值 → 0；超過上限 → 3000；缺值或非數字 → 0', () => {
    expect(overlayOffsetMs(1000, 900)).toBe(0);
    expect(overlayOffsetMs(1000, 9000)).toBe(3000);
    expect(overlayOffsetMs(null, 1200)).toBe(0);
    expect(overlayOffsetMs(1000, undefined)).toBe(0);
    expect(overlayOffsetMs(Number.NaN, 1200)).toBe(0);
  });
});

describe('sentenceSegment', () => {
  it('正常：用句子的開始與結束時間', () => {
    expect(sentenceSegment(12.5, 15.75, 4)).toEqual({ start: 12.5, end: 15.75 });
  });
  it('結束時間為 0 或不大於開始時間 → 用錄音長度當上限', () => {
    expect(sentenceSegment(3, 0, 4)).toEqual({ start: 3, end: 7 });
    expect(sentenceSegment(3, 2, 4)).toEqual({ start: 3, end: 7 });
  });
  it('開始時間無效 → 從 0；錄音長度也無效 → 長度 0', () => {
    expect(sentenceSegment(Number.NaN, 2, 4)).toEqual({ start: 0, end: 2 });
    expect(sentenceSegment(3, 0, Number.NaN)).toEqual({ start: 3, end: 3 });
  });
});

describe('耳機提醒（只存瀏覽器）', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  it('沒設過 → 要提醒；按不再提醒後 → 不提醒', () => {
    const s = memory();
    expect(shouldShowHeadphoneTip(() => s)).toBe(true);
    dismissHeadphoneTip(() => s);
    expect(shouldShowHeadphoneTip(() => s)).toBe(false);
  });
  it('取得 storage 丟錯、沒有 storage、讀寫丟錯 → 要提醒且不丟錯', () => {
    const boom = () => { throw new Error('SecurityError'); };
    expect(shouldShowHeadphoneTip(boom)).toBe(true);
    expect(() => dismissHeadphoneTip(boom)).not.toThrow();
    expect(shouldShowHeadphoneTip(() => null)).toBe(true);
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(shouldShowHeadphoneTip(() => bad)).toBe(true);
    expect(() => dismissHeadphoneTip(() => bad)).not.toThrow();
  });
});
