import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as seg from '../src/utils/segmentEnd';

// 規劃：docs/plans/shadowing-stable-playback.md（擁有者 2026-11-10 核准）
// 回報：iPhone 跟讀一按就結束、第三次才成功；第二句原音沒停在句尾；調整時間與跟讀範圍要一致
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const S = seg as any;

/** 會隨時間前進的假播放器：tick() 模擬播放中每 0.25 秒一次 timeupdate */
class Media {
  paused = true;
  seeking = false;
  readyState = 4;
  playbackRate = 1;
  duration = 550;
  src = 'https://example.test/a.mp3?alt=media';
  currentSrc = 'https://example.test/a.mp3?alt=media';
  pos = 0;
  sets: number[] = [];
  /** 設定位置後是否非同步跳轉（seeking=true，直到 finishSeek） */
  asyncSeek = false;
  /** 設定位置是否被忽略 */
  ignoreSets = 0;
  pauses = 0;
  private ls = new Map<string, Set<() => void>>();
  get currentTime() { return this.pos; }
  set currentTime(t: number) {
    this.sets.push(t);
    if (this.ignoreSets > 0) { this.ignoreSets--; return; }
    if (this.asyncSeek) { this.seeking = true; this.pending = t; return; }
    this.pos = t;
    this.emit('seeked');
  }
  pending: number | null = null;
  finishSeek() { if (this.pending === null) return; this.pos = this.pending; this.pending = null; this.seeking = false; this.emit('seeked'); }
  play() { this.paused = false; this.emit('playing'); return Promise.resolve(); }
  pause() { if (this.paused) return; this.paused = true; this.pauses++; this.emit('pause'); }
  tick(dt = 0.25) { if (!this.paused && !this.seeking) this.pos += dt * this.playbackRate; this.emit('timeupdate'); }
  addEventListener(t: string, f: () => void) { if (!this.ls.has(t)) this.ls.set(t, new Set()); this.ls.get(t)!.add(f); }
  removeEventListener(t: string, f: () => void) { this.ls.get(t)?.delete(f); }
  emit(t: string) { [...(this.ls.get(t) ?? [])].forEach(f => f()); }
  count() { let n = 0; this.ls.forEach(s => (n += s.size)); return n; }
}

afterEach(() => { vi.useRealTimers(); });

describe('prepareSegmentStart：原音先就位才錄音', () => {
  it('匯出 prepareSegmentStart 與 6 秒上限（擁有者決定）', () => {
    expect(typeof S.prepareSegmentStart).toBe('function');
    expect(S.PREPARE_TIMEOUT_MS).toBe(6000);
  });

  it('跳轉中（seeking）不算就位；跳轉完成且在起點 → ready，監聽拆乾淨', async () => {
    const m = new Media();
    m.asyncSeek = true;
    m.currentTime = 45.2;
    const p = S.prepareSegmentStart(m, 45.2, { isCancelled: () => false });
    let done: string | null = null;
    p.then((r: string) => (done = r));
    await Promise.resolve();
    expect(done).toBe(null);
    m.finishSeek();
    expect(await p).toBe('ready');
    expect(m.count()).toBe(0);
  });

  it('解鎖播放往前走了 0.4 秒 → 拉回起點才 ready', async () => {
    const m = new Media();
    m.pos = 45.6;
    const r = await S.prepareSegmentStart(m, 45.2, { isCancelled: () => false });
    expect(r).toBe('ready');
    expect(m.sets).toContain(45.2);
    expect(Math.abs(m.currentTime - 45.2)).toBeLessThanOrEqual(0.25);
  });

  it('還沒載入時間資訊（readyState 0）→ 等 loadedmetadata', async () => {
    const m = new Media();
    m.readyState = 0;
    m.pos = 45.2;   // 依規範：未載入時讀到的是預設起點
    const p = S.prepareSegmentStart(m, 45.2, { isCancelled: () => false });
    let done: string | null = null;
    p.then((r: string) => (done = r));
    await Promise.resolve();
    expect(done).toBe(null);
    m.readyState = 1;
    m.emit('loadedmetadata');
    expect(await p).toBe('ready');
  });

  it('一直沒就位 → 6 秒後 timeout，監聽與計時都清掉', async () => {
    vi.useFakeTimers();
    const m = new Media();
    m.readyState = 0;
    const p = S.prepareSegmentStart(m, 45.2, { isCancelled: () => false });
    let done: string | null = null;
    p.then((r: string) => (done = r));
    await vi.advanceTimersByTimeAsync(5900);
    expect(done).toBe(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe('timeout');
    expect(m.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('等待中換句或離開（isCancelled）→ cancelled', async () => {
    vi.useFakeTimers();
    const m = new Media();
    m.readyState = 0;
    let stale = false;
    const p = S.prepareSegmentStart(m, 45.2, { isCancelled: () => stale });
    stale = true;
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toBe('cancelled');
    expect(m.count()).toBe(0);
  });

  it('等待中頁面被隱藏（鎖屏、切 App）→ cancelled', async () => {
    const m = new Media();
    m.readyState = 0;
    let hide: () => void = () => {};
    const p = S.prepareSegmentStart(m, 45.2, { isCancelled: () => false, onHidden: (fn: () => void) => { hide = fn; return () => {}; } });
    hide();
    expect(await p).toBe('cancelled');
  });
});

describe('guardSegmentStart：位置確實在前進才判斷（不誤判）', () => {
  it('播放初期回報 0 秒、沒在跳轉但位置沒前進 → 不補跳、不失敗', () => {
    const m = new Media();
    const onFail = vi.fn();
    m.paused = false;
    S.guardSegmentStart(m, 300, onFail, { allowReload: false });
    m.emit('playing');
    m.emit('timeupdate');
    m.emit('timeupdate');
    expect(m.sets).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('載入狀態不足（readyState < 2）時不判斷', () => {
    const m = new Media();
    m.readyState = 1;
    m.play();
    const onFail = vi.fn();
    S.guardSegmentStart(m, 300, onFail, { allowReload: false });
    for (let i = 0; i < 5; i++) m.tick();
    expect(m.sets).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('之後才套用起點、從起點往前播 → 不補跳', () => {
    const m = new Media();
    m.play();
    const onFail = vi.fn();
    S.guardSegmentStart(m, 300, onFail, { allowReload: false });
    m.tick(0);
    m.pos = 300;
    for (let i = 0; i < 4; i++) m.tick();
    expect(m.sets).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('真的從 0 秒往前播 → 補跳回起點', () => {
    const m = new Media();
    m.play();
    const onFail = vi.fn();
    S.guardSegmentStart(m, 300, onFail, { allowReload: false });
    for (let i = 0; i < 3; i++) m.tick();
    expect(m.sets).toEqual([300]);
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe('跟讀流程（ShadowingPracticeView）', () => {
  const src = () => read('src/components/ShadowingPracticeView.tsx');
  const body = () => src().slice(src().indexOf('const handleStart'), src().indexOf('const enterBufferPhase'));

  it('原音就位（prepareSegmentStart）之後才開始錄音', () => {
    const b = body();
    const prep = b.indexOf('await prepareSegmentStart(');
    expect(prep).toBeGreaterThan(-1);
    expect(b.indexOf('mediaRecorder.start()')).toBeGreaterThan(prep);
  });

  it('就位逾時：顯示「原音載入失敗」、不開始錄音', () => {
    const b = body();
    expect(b).toContain('原音載入失敗，請檢查網路後再試');
    expect(b).toMatch(/PREPARE_TIMEOUT_MS/);
  });

  it('解鎖播放結束（最多等 1.5 秒）後先暫停再拉回起點', () => {
    const b = body();
    expect(b).toMatch(/UNLOCK_WAIT_MS/);
    expect(src()).toMatch(/UNLOCK_WAIT_MS\s*=\s*1500/);
  });

  it('不再換音檔網址（每次按跟讀整份重新下載）、也沒有「請再按一次」', () => {
    const s = src();
    expect(s).not.toMatch(/useStartFragmentRef/);
    expect(s).not.toMatch(/\.src = withStartFragment/);
    expect(s).not.toContain('請再按一次');
  });

  it('錄音中起點確認失敗：不重新載入、停止並提示複製診斷紀錄', () => {
    const b = body();
    expect(b).toMatch(/guardSegmentStart\([\s\S]*?\{ allowReload: false/);
    expect(b).toContain('複製診斷紀錄');
  });

  it('原音每次開始播放（playing）都掛上精準句尾監看', () => {
    const s = src();
    expect(s).toMatch(/const armEndWatch = /);
    expect(s).toMatch(/addEventListener\('playing', onPlaying\)/);
  });

  it('安全網：原音播過句尾，不論什麼狀態都暫停（不只錄音中）', () => {
    const s = src();
    const h = s.slice(s.indexOf('const handleTimeUpdate'), s.indexOf('const handleRetry'));
    expect(h).not.toMatch(/if \(practiceState !== 'recording'/);
    expect(h).toMatch(/\.pause\(\)/);
  });

  it('跟讀畫面顯示播放範圍（與調整時間一致）', () => {
    expect(src()).toMatch(/播放範圍/);
    expect(src()).toMatch(/formatPlayRange\(/);
  });

  it('有「複製診斷紀錄」按鈕並記錄播放事件', () => {
    expect(src()).toContain('複製診斷紀錄');
    expect(src()).toMatch(/createPlaybackTrace\(/);
  });
});

describe('原音停在句尾：誤差 ≤ 0.1 秒（擁有者決定）', () => {
  for (const rate of [1, 0.75]) {
    it(`語速 ${rate}：timeupdate 稀疏時仍準時停（計時器）`, () => {
      vi.useFakeTimers();
      const m = new Media();
      m.playbackRate = rate;
      m.pos = 10;
      m.play();
      const onEnd = vi.fn();
      const started = Date.now();
      const realNow = () => 10 + ((Date.now() - started) / 1000) * rate;
      Object.defineProperty(m, 'currentTime', { get: () => (m.paused ? m.pos : realNow()), set: () => {}, configurable: true });
      const origPause = m.pause.bind(m);
      let stoppedAt = -1;
      m.pause = () => { if (stoppedAt < 0) stoppedAt = realNow(); origPause(); };
      seg.watchSegmentEnd(m as any, 12, onEnd, {});
      vi.advanceTimersByTime(4000);
      expect(onEnd).toHaveBeenCalledWith('end');
      expect(stoppedAt).toBeGreaterThanOrEqual(12);
      expect(stoppedAt - 12).toBeLessThanOrEqual(0.1);
    });
  }
});

describe('播放診斷紀錄', () => {
  it('記錄事件與自己的動作，保留最新 N 筆，輸出文字', async () => {
    const { createPlaybackTrace } = await import('../src/utils/playbackTrace');
    const m = new Media();
    const trace = createPlaybackTrace(m as any, { limit: 5 });
    trace.mark('按下跟讀');
    m.play();
    for (let i = 0; i < 10; i++) m.tick();
    const text = trace.text();
    expect(text.split('\n').length).toBeLessThanOrEqual(6);
    expect(text).toMatch(/timeupdate/);
    expect(text).toMatch(/ct=/);
    expect(text).toMatch(/rs=/);
    trace.dispose();
    expect(m.count()).toBe(0);
  });
});

describe('調整時間：未儲存提醒（擁有者決定：儲存／不儲存）', () => {
  it('SentenceTimeEditor 回報是否有未儲存的修改', () => {
    expect(read('src/components/SentenceTimeEditor.tsx')).toMatch(/onDirtyChange/);
  });

  it('詳情頁在按跟讀、開另一句調整時間、返回時攔截', () => {
    const d = read('src/components/MaterialDetailView.tsx');
    expect(d).toContain('這句的時間還沒儲存');
    expect(d).toMatch(/guardUnsaved\(\(\) => setPracticeIndex\(i\)\)/);
    expect(d).toMatch(/guardUnsaved\(\(\) => \{ handlePause\(\); setEditingTimeId/);
    expect(d).toMatch(/guardUnsaved\(onBack\)/);
    expect(d).toContain('不儲存');
  });

  it('按「儲存」後等教材資料更新成新時間才繼續', () => {
    const d = read('src/components/MaterialDetailView.tsx');
    expect(d).toMatch(/saveSentenceTime\(/);
    expect(d).toMatch(/pendingAfterSave/);
  });

  it('formatPlayRange 顯示到小數點後 2 位', async () => {
    const { formatPlayRange } = await import('../src/utils/timeEdit');
    expect(formatPlayRange(12.4, 15.8)).toBe('12.40s ～ 15.80s');
  });
});
