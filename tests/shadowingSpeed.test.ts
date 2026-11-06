import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SHADOWING_SPEEDS, DEFAULT_SPEED, SPEED_STORAGE_KEY, loadSpeed, saveSpeed, effectiveOriginalSec, applyPlaybackSpeed,
  scoreShadowingAttempt,
} from '../src/utils/shadowingSpeed';
import { createListenPlayer, type MediaLike } from '../src/utils/shadowingPlayback';

// 規劃：docs/plans/shadowing-speed.md
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe('記住速度（驗收 1）', () => {
  it('選項與預設', () => {
    expect([...SHADOWING_SPEEDS]).toEqual([0.75, 0.85, 1]);
    expect(DEFAULT_SPEED).toBe(1);
  });
  it('沒有設定、不合法值、localStorage 丟錯 → 1', () => {
    expect(loadSpeed(() => store())).toBe(1);
    expect(loadSpeed(() => store({ [SPEED_STORAGE_KEY]: '0.5' }))).toBe(1);
    expect(loadSpeed(() => store({ [SPEED_STORAGE_KEY]: 'abc' }))).toBe(1);
    expect(loadSpeed(() => { throw new Error('private'); })).toBe(1);
  });
  it('合法值照讀；saveSpeed 寫入', () => {
    expect(loadSpeed(() => store({ [SPEED_STORAGE_KEY]: '0.85' }))).toBe(0.85);
    const s = store();
    saveSpeed(() => s, 0.75);
    expect(s.m.get(SPEED_STORAGE_KEY)).toBe('0.75');
    expect(() => saveSpeed(() => { throw new Error('x'); }, 0.75)).not.toThrow();
  });
});

describe('放慢後的原音長度（驗收 2、3）', () => {
  it('3 秒 × 0.75 → 4 秒', () => {
    expect(effectiveOriginalSec(3, 0.75)).toBeCloseTo(4);
    expect(effectiveOriginalSec(3, 1)).toBe(3);
  });
  it('applyPlaybackSpeed 設定速度並保持音高', () => {
    const el: any = { playbackRate: 1 };
    applyPlaybackSpeed(el, 0.75);
    expect(el.playbackRate).toBe(0.75);
    expect(el.preservesPitch).toBe(true);
    expect(el.webkitPreservesPitch).toBe(true);
  });
});

describe('評分用錄音當下的速度（驗收 4）', () => {
  const sentence = { text: 'She sells sea shells by the sea shore', startTime: 10, endTime: 13 };
  const said = 'She sells sea shells by the sea shore';
  it('0.75 倍速錄音講 4 秒（原音 3 秒）→ 流暢度 100；同樣 4 秒在 1 倍速 → 不是 100', () => {
    expect(scoreShadowingAttempt(said, sentence, { speechSec: 4, speed: 0.75 }).fluency).toBe(100);
    expect(scoreShadowingAttempt(said, sentence, { speechSec: 4, speed: 1 }).fluency).toBeLessThan(100);
  });
  it('重試評分用同一個快照：之後設定改成 1 倍也不影響', () => {
    const attempt = { speechSec: 4, speed: 0.75 };
    const first = scoreShadowingAttempt(said, sentence, attempt);
    const retry = scoreShadowingAttempt(said, sentence, attempt);
    expect(retry).toEqual(first);
  });
});

// ── 聽聽看 ──
class FakeMedia implements MediaLike {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  rateAtPlay: number[] = [];
  private listeners = new Map<string, Set<() => void>>();
  play() { this.paused = false; this.rateAtPlay.push(this.playbackRate); return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  emit(type: string) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
}

describe('聽聽看用錄音時的速度（驗收 5）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const setup = (rate: () => number) => {
    const recording = new FakeMedia();
    const original = new FakeMedia();
    const player = createListenPlayer({
      recording, original, setOriginalVolume: () => {}, segment: () => ({ start: 10, end: 13 }), offsetMs: () => 0, rate,
    });
    return { recording, original, player };
  };
  it('「原音」以錄音時速度播放；停止後速度回 1', () => {
    const { original, player } = setup(() => 0.75);
    player.toggle('original');
    expect(original.rateAtPlay).toEqual([0.75]);
    player.stop();
    expect(original.playbackRate).toBe(1);
  });
  it('0.75 倍速：保險計時依速度延長，3 秒的句子到 3.5 秒時不提早停', () => {
    const { original, player } = setup(() => 0.75);
    player.toggle('original');
    original.currentTime = 10;   // 卡住沒前進
    vi.advanceTimersByTime(3600);
    expect(player.playing()).toBe('original');   // 1 倍速會在 3.5 秒停，0.75 倍速要到 4.5 秒
    vi.advanceTimersByTime(1000);
    expect(player.playing()).toBeNull();
  });
  it('重疊播放：原音用錄音時速度，使用者錄音維持 1 倍', () => {
    const { recording, original, player } = setup(() => 0.85);
    player.toggle('overlay');
    vi.advanceTimersByTime(1);
    expect(original.rateAtPlay).toEqual([0.85]);
    expect(recording.rateAtPlay).toEqual([1]);
  });
  it('下一次改用 1 倍錄音 → 用 1 倍', () => {
    let r = 0.75;
    const { original, player } = setup(() => r);
    player.toggle('original');
    player.stop();
    r = 1;
    player.toggle('original');
    expect(original.rateAtPlay).toEqual([0.75, 1]);
  });
  it('沒有傳 rate → 照舊 1 倍', () => {
    const recording = new FakeMedia();
    const original = new FakeMedia();
    const player = createListenPlayer({ recording, original, setOriginalVolume: () => {}, segment: () => ({ start: 10, end: 13 }), offsetMs: () => 0 });
    player.toggle('original');
    expect(original.rateAtPlay).toEqual([1]);
  });
});

describe('跟讀畫面接線（驗收 6）', () => {
  const v = read('src/components/ShadowingPracticeView.tsx');
  it('速度選擇與記住設定', () => {
    expect(v).toContain('原音速度');
    expect(v).toMatch(/loadSpeed\(/);
    expect(v).toMatch(/saveSpeed\(/);
  });
  it('播原音前（含解鎖預播放）套用速度', () => {
    expect((v.match(/applyPlaybackSpeed\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('評分與聽聽看讀錄音快照', () => {
    expect(v).toMatch(/scoreShadowingAttempt\(/);
    expect(v).toMatch(/rate: \(\) => lastRecordingRef\.current\?\.speed \?\? 1/);
    expect(v).not.toMatch(/calculateShadowingScores\(transcribedText, sentence\.text, speechSec, originalSec\)/);
  });
});
