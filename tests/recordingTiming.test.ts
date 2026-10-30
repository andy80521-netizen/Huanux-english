import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playAfterRecordingStarts, practiceDurationSec, LEGACY_TAIL_SEC } from '../src/utils/recordingTiming';

// PR A 審查第 1 輪（Codex）：以行為驗證「錄音真正開始後再等 300ms 才播原音」，以及流暢度時長不因自動停止等待變長

class FakeRecorder {
  state = 'inactive';
  private fns: Array<() => void> = [];
  addEventListener(_t: 'start', fn: () => void) { this.fns.push(fn); }
  start() { this.state = 'recording'; }
  fireStart() { this.fns.splice(0).forEach((f) => f()); }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('playAfterRecordingStarts', () => {
  it('收到 start 之前、以及之後未滿 300ms 都不播放；滿 300ms 才播放', async () => {
    const rec = new FakeRecorder();
    const play = vi.fn();
    const done = playAfterRecordingStarts(rec, { leadMs: 300, fallbackMs: 800, isCancelled: () => false, play });
    rec.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(play).not.toHaveBeenCalled();
    rec.fireStart();
    await vi.advanceTimersByTimeAsync(299);
    expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(play).toHaveBeenCalledTimes(1);
    await expect(done).resolves.toBe(true);
  });
  it('start 事件沒來：保險時間到後再等 300ms 播放', async () => {
    const rec = new FakeRecorder();
    const play = vi.fn();
    playAfterRecordingStarts(rec, { leadMs: 300, fallbackMs: 800, isCancelled: () => false, play });
    rec.start();
    await vi.advanceTimersByTimeAsync(1099);
    expect(play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('等待期間被取消或錄音已停止 → 不播放', async () => {
    const rec = new FakeRecorder();
    const play = vi.fn();
    let cancelled = false;
    const done = playAfterRecordingStarts(rec, { leadMs: 300, isCancelled: () => cancelled, play });
    rec.start(); rec.fireStart();
    cancelled = true;
    await vi.advanceTimersByTimeAsync(400);
    expect(play).not.toHaveBeenCalled();
    await expect(done).resolves.toBe(false);

    const rec2 = new FakeRecorder();
    const play2 = vi.fn();
    playAfterRecordingStarts(rec2, { leadMs: 300, isCancelled: () => false, play: play2 });
    rec2.start(); rec2.fireStart(); rec2.state = 'inactive';
    await vi.advanceTimersByTimeAsync(400);
    expect(play2).not.toHaveBeenCalled();
  });
});

describe('practiceDurationSec', () => {
  it('最後出聲時間 + 1.5 秒（等同舊版自動停止的長度），不受新的 2.5 秒等待影響', () => {
    expect(LEGACY_TAIL_SEC).toBe(1.5);
    // 4 秒念完，舊版約 5.5 秒停；新版約 6.5 秒停 → 仍以 5.5 秒評分
    expect(practiceDurationSec(0, 4000, 6500)).toBe(5.5);
  });
  it('不超過實際錄音長度；沒偵測到聲音時用實際長度', () => {
    expect(practiceDurationSec(0, 4000, 4800)).toBe(4.8);
    expect(practiceDurationSec(1000, 0, 6000)).toBe(5);
  });
});
