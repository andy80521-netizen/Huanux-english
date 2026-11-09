import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { watchSegmentEnd, seekSegmentStart, type SegmentMedia } from '../src/utils/segmentEnd';

// 規劃：docs/plans/import-timestamp-accuracy.md（PR-A 播放停止精準化）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

/** 假的播放元素：依假時鐘前進；timeupdate 只每 250ms 觸發一次（模擬瀏覽器） */
class ClockMedia implements SegmentMedia {
  playbackRate = 1;
  paused = true;
  readyState = 4;
  private pos = 0;
  private playedAt = 0;
  private listeners = new Map<string, Set<() => void>>();
  private tu: ReturnType<typeof setInterval> | null = null;
  pausedAt: number | null = null;
  get currentTime() {
    return this.paused ? this.pos : this.pos + ((Date.now() - this.playedAt) / 1000) * this.playbackRate;
  }
  set currentTime(t: number) {
    this.pos = t;
    this.playedAt = Date.now();
    this.emit('seeked');
  }
  play() {
    this.paused = false;
    this.playedAt = Date.now();
    this.tu = setInterval(() => this.emit('timeupdate'), 250);
    this.emit('playing');
  }
  pause() {
    if (this.paused) return;
    this.pos = this.currentTime;
    this.paused = true;
    this.pausedAt = this.pos;
    if (this.tu) clearInterval(this.tu);
    this.emit('pause');
  }
  setRate(r: number) {
    this.pos = this.currentTime;
    this.playedAt = Date.now();
    this.playbackRate = r;
    this.emit('ratechange');
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  emit(type: string) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

// 逐格檢查用 16ms 計時器模擬 requestAnimationFrame
const deps = () => {
  let hiddenFn: (() => void) | null = null;
  return {
    requestFrame: (fn: () => void) => setTimeout(fn, 16),
    cancelFrame: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onHidden: (fn: () => void) => { hiddenFn = fn; return () => { hiddenFn = null; }; },
    hide: () => hiddenFn?.(),
  };
};

describe('watchSegmentEnd 準時停止（驗收 1、2）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  for (const rate of [1, 0.75, 1.25]) {
    it(`${rate} 倍速：句尾 10.00 → 暫停在 10.05 以內`, () => {
      const m = new ClockMedia();
      m.currentTime = 7;
      m.playbackRate = rate;
      const onEnd = vi.fn();
      const d = deps();
      m.play();
      watchSegmentEnd(m, 10, onEnd, d);
      vi.advanceTimersByTime(((10 - 7) / rate) * 1000 + 300);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledWith('end');
      expect(m.pausedAt).not.toBeNull();
      expect(m.pausedAt!).toBeGreaterThanOrEqual(10);
      expect(m.pausedAt!).toBeLessThanOrEqual(10.05);
    });
  }
  it('播放中改速度 → 依新速度重排，仍準時', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 10, onEnd, deps());
    vi.advanceTimersByTime(1000);
    m.setRate(0.75);
    vi.advanceTimersByTime((2 / 0.75) * 1000 + 300);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeLessThanOrEqual(10.05);
    expect(m.pausedAt!).toBeGreaterThanOrEqual(10);
  });
});

describe('暫停、seek、取消、ended（驗收 3、4、5）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('播放中暫停（緩衝）→ 不提早結束；恢復後準時停', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 10, onEnd, deps());
    vi.advanceTimersByTime(1000);   // 8.0
    m.pause();
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();
    m.play();
    vi.advanceTimersByTime(2300);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeLessThanOrEqual(10.05);
  });
  it('往回 seek → 舊計時作廢，依新位置重排', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 10, onEnd, deps());
    vi.advanceTimersByTime(2000);   // 9.0
    m.currentTime = 5;              // 往回 4 秒
    vi.advanceTimersByTime(2000);   // 7.0：舊計時原本會在這附近觸發
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3300);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeLessThanOrEqual(10.05);
  });
  it('取消 → 不暫停、不回報、監聽都移除', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    const cancel = watchSegmentEnd(m, 10, onEnd, deps());
    cancel();
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(m.paused).toBe(false);
    for (const t of ['timeupdate', 'playing', 'seeked', 'ratechange', 'pause', 'ended']) expect(m.count(t)).toBe(0);
  });
  it('ended 事件 → 視為結束（只回報一次）', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 100, onEnd, deps());
    m.emit('ended');
    m.emit('ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('end');
  });
  it('已經超過句尾才開始監看 → 立刻停止', () => {
    const m = new ClockMedia();
    m.currentTime = 12;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 10, onEnd, deps());
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.paused).toBe(true);
  });
  it('沒有傳 requestFrame（或背景環境）→ 用計時器逐步檢查，仍準時', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, 10, onEnd, { onHidden: () => () => {} });
    vi.advanceTimersByTime(3300);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeLessThanOrEqual(10.05);
  });
});

describe('頁面隱藏時暫停（驗收 6，擁有者決定）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('隱藏 → 暫停並回報 hidden', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    const onEnd = vi.fn();
    const d = deps();
    m.play();
    watchSegmentEnd(m, 10, onEnd, d);
    vi.advanceTimersByTime(500);
    d.hide();
    expect(m.paused).toBe(true);
    expect(onEnd).toHaveBeenCalledWith('hidden');
    vi.advanceTimersByTime(5000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('seekSegmentStart（驗收 7）', () => {
  it('已載入時間資訊 → 立刻設定', () => {
    const m = new ClockMedia();
    seekSegmentStart(m, 12.5);
    expect(m.currentTime).toBe(12.5);
  });
  // 擁有者 2026-11-09 同意修改：原本「沒載入時不設定、等 loadedmetadata」讓 iPhone 每一句跟讀都從頭播（docs/plans/ios-seek-fix.md）
  it('還沒載入（readyState 0）→ 立刻設定（預設起點），loadedmetadata 時被重設就再設一次', () => {
    const m = new ClockMedia();
    m.readyState = 0;
    seekSegmentStart(m, 12.5);
    expect(m.currentTime).toBe(12.5);
    m.currentTime = 0;            // 載入時被重設
    m.readyState = 1;
    m.emit('loadedmetadata');
    expect(m.currentTime).toBe(12.5);
    expect(m.count('loadedmetadata')).toBe(0);
  });
  it('等待中又要求別的起點 → 只套用最後一次', () => {
    const m = new ClockMedia();
    m.readyState = 0;
    seekSegmentStart(m, 12.5);
    seekSegmentStart(m, 20);
    m.readyState = 1;
    m.emit('loadedmetadata');
    expect(m.currentTime).toBe(20);
  });
});

describe('六個播放入口接線（驗收 8）', () => {
  const files = [
    'src/components/ShadowingPracticeView.tsx',
    'src/components/MaterialDetailView.tsx',
    'src/components/MaterialReviewPanel.tsx',
    'src/components/RetellView.tsx',
    'src/components/PatternSightingsSection.tsx',
    'src/utils/shadowingPlayback.ts',
  ];
  for (const f of files) {
    it(`${f} 用 watchSegmentEnd 停止`, () => {
      expect(read(f)).toMatch(/watchSegmentEnd\(/);
    });
  }
  it('教材詳情與校對畫面用 seekSegmentStart 設定起點', () => {
    expect(read('src/components/MaterialDetailView.tsx')).toMatch(/seekSegmentStart\(/);
    expect(read('src/components/MaterialReviewPanel.tsx')).toMatch(/seekSegmentStart\(/);
  });
});

describe('審查修正（Codex 第 1 輪）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('句尾用函式傳入：播放中延長 → 照新的句尾停', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    let end = 10;
    const onEnd = vi.fn();
    m.play();
    watchSegmentEnd(m, () => end, onEnd, deps());
    vi.advanceTimersByTime(1500);
    end = 11;
    vi.advanceTimersByTime(4000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeGreaterThanOrEqual(11);
    expect(m.pausedAt!).toBeLessThanOrEqual(11.05);
  });
  it('句尾用函式傳入：播放中縮短並呼叫 refresh → 照新的句尾準時停（Codex 第 2 輪）', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    let end = 12;
    const onEnd = vi.fn();
    m.play();
    const w = watchSegmentEnd(m, () => end, onEnd, deps());
    vi.advanceTimersByTime(1500);   // 8.5
    end = 9.1;
    w.refresh();
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(m.pausedAt!).toBeGreaterThanOrEqual(9.1);
    expect(m.pausedAt!).toBeLessThanOrEqual(9.15);
  });
  it('縮短到目前位置之前 → refresh 立刻停', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    let end = 12;
    const onEnd = vi.fn();
    m.play();
    const w = watchSegmentEnd(m, () => end, onEnd, deps());
    vi.advanceTimersByTime(1500);   // 8.5
    end = 8;
    w.refresh();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
  it('教材詳情頁：新增的 Hooks 在提早 return 之前', () => {
    const src = read('src/components/MaterialDetailView.tsx');
    expect(src.indexOf('const segWatchRef = useRef')).toBeGreaterThan(-1);
    expect(src.indexOf('const segWatchRef = useRef')).toBeLessThan(src.indexOf('    if (!material) {'));
  });
  it('校對畫面：監看讀最新的句尾，句子變更時 refresh', () => {
    const src = read('src/components/MaterialReviewPanel.tsx');
    expect(src).toMatch(/watchSegmentEnd\(el, endNow,/);
    expect(src).toMatch(/useEffect\(\(\) => \{ segWatchRef\.current\?\.refresh\(\); \}, \[sentences\]\)/);
  });
});

describe('審查修正（Codex 第 3 輪：排程不可累積）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('重複 refresh、seeked、ratechange 後只留一組排程；取消後沒有剩餘排程', () => {
    const m = new ClockMedia();
    m.currentTime = 7;
    m.play();
    const base = vi.getTimerCount();   // 假播放元素自己的 timeupdate 計時
    const w = watchSegmentEnd(m, 10, () => {}, deps());
    expect(vi.getTimerCount()).toBe(base + 1);
    for (let i = 0; i < 5; i++) w.refresh();
    m.emit('seeked');
    m.emit('ratechange');
    m.emit('playing');
    expect(vi.getTimerCount()).toBe(base + 1);
    w();
    expect(vi.getTimerCount()).toBe(base);
  });
  it('跟讀用 seekSegmentStart 設定起點', () => {
    expect(read('src/components/ShadowingPracticeView.tsx')).toMatch(/seekSegmentStart\(audioRef\.current, sentence\.startTime\)/);
  });
});
