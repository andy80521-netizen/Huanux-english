import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareSegmentStart } from '../src/utils/segmentEnd';

// 規劃：docs/plans/ios-ended-fix.md（擁有者 2026-11-10 同意）
// iPhone 診斷紀錄（Safari 18.7、Chrome iOS）：設定 19.90 秒（跳轉中）→ 靜音 play() → 馬上 pause()
// → suspend、ct=0.00、ended；之後每次設定位置，seeked 後仍是 0.00 → 就位 6 秒逾時「原音載入失敗」
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

/** 依紀錄重現 WebKit 行為的假播放器 */
class WebKitMedia {
  paused = true;
  seeking = false;
  ended = false;
  readyState = 4;
  duration = 550;
  pos = 0;
  pendingSeek: number | null = null;
  loads = 0;
  private ls = new Map<string, Set<() => void>>();
  get currentTime() { return this.pos; }
  set currentTime(t: number) {
    this.seeking = true;
    this.pendingSeek = t;
    this.emit('seeking');
  }
  /** 跳轉完成：壞掉（ended）時一律落在 0 */
  finishSeek() {
    if (this.pendingSeek === null) return;
    this.pos = this.ended ? 0 : this.pendingSeek;
    this.pendingSeek = null;
    this.seeking = false;
    this.emit('seeked');
  }
  play() {
    if (this.ended) { this.pos = 0; }        // 已播完時 play() 從頭播
    this.paused = false;
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.seeking) {                        // 跳轉中暫停 → 回到 0 並宣告已播完（紀錄第 15～21 行）
      this.pendingSeek = null;
      this.seeking = false;
      this.pos = 0;
      this.ended = true;
      this.emit('pause');
      this.emit('ended');
      return;
    }
    this.emit('pause');
  }
  load() {
    this.loads++;
    this.ended = false;
    this.seeking = false;
    this.pendingSeek = null;
    this.paused = true;
    this.pos = 0;
    this.readyState = 0;
  }
  metadataLoaded() { this.readyState = 4; this.emit('loadedmetadata'); this.emit('canplay'); }
  addEventListener(t: string, f: () => void) { if (!this.ls.has(t)) this.ls.set(t, new Set()); this.ls.get(t)!.add(f); }
  removeEventListener(t: string, f: () => void) { this.ls.get(t)?.delete(f); }
  emit(t: string) { [...(this.ls.get(t) ?? [])].forEach(f => f()); }
  count() { let n = 0; this.ls.forEach(s => (n += s.size)); return n; }
}

afterEach(() => { vi.useRealTimers(); });

describe('假播放器重現紀錄', () => {
  it('跳轉中暫停 → 0 秒、已播完；之後跳轉都落在 0', () => {
    const m = new WebKitMedia();
    m.currentTime = 19.9;
    m.play();
    m.pause();
    expect(m.ended).toBe(true);
    m.currentTime = 19.9;
    m.finishSeek();
    expect(m.currentTime).toBe(0);
  });
});

describe('prepareSegmentStart：播放器壞掉時自動重新載入', () => {
  it('已處於 ended → 重新載入一次，載入後跳到起點 → ready', async () => {
    const m = new WebKitMedia();
    m.currentTime = 19.9; m.play(); m.pause();          // 壞掉
    const p = prepareSegmentStart(m as any, 19.9, { isCancelled: () => false });
    await Promise.resolve();
    expect(m.loads).toBe(1);
    m.metadataLoaded();
    m.finishSeek();
    expect(await p).toBe('ready');
    expect(m.currentTime).toBe(19.9);
    expect(m.count()).toBe(0);
  });

  it('沒有 ended 旗標但跳轉完成仍停在錯的位置（兩次）→ 重新載入', async () => {
    const m = new WebKitMedia();
    // 模擬只有「跳轉無效」：ended 不可見
    let broken = true;
    Object.defineProperty(m, 'ended', { get: () => false, set: () => {}, configurable: true });
    const origFinish = m.finishSeek.bind(m);
    m.finishSeek = () => { if (broken && m.pendingSeek !== null) { m.pendingSeek = 0; } origFinish(); };
    const origLoad = m.load.bind(m);
    m.load = () => { broken = false; origLoad(); };
    const p = prepareSegmentStart(m as any, 19.9, { isCancelled: () => false });
    m.finishSeek();   // 第 1 次：落在 0
    m.finishSeek();   // 第 2 次：落在 0 → 重新載入
    expect(m.loads).toBe(1);
    m.metadataLoaded();
    m.finishSeek();
    expect(await p).toBe('ready');
    expect(m.currentTime).toBe(19.9);
  });

  it('重新載入只做一次；仍不行 → 6 秒 timeout', async () => {
    vi.useFakeTimers();
    const m = new WebKitMedia();
    m.load = () => { m.loads++; };                   // 重新載入也救不回來
    m.currentTime = 19.9; m.play(); m.pause();
    const p = prepareSegmentStart(m as any, 19.9, { isCancelled: () => false });
    let done: string | null = null;
    p.then(r => (done = r));
    for (let i = 0; i < 5; i++) { m.finishSeek(); await vi.advanceTimersByTimeAsync(250); }
    await vi.advanceTimersByTimeAsync(6000);
    expect(m.loads).toBe(1);
    expect(done).toBe('timeout');
  });

  it('正常（沒壞）：暫停中跳轉完成就 ready，不重新載入', async () => {
    const m = new WebKitMedia();
    m.currentTime = 19.9;
    const p = prepareSegmentStart(m as any, 19.9, { isCancelled: () => false });
    m.finishSeek();
    expect(await p).toBe('ready');
    expect(m.loads).toBe(0);
  });
});

describe('跟讀流程：每個播放器只解鎖一次，解鎖不跳位置', () => {
  const src = () => read('src/components/ShadowingPracticeView.tsx');
  const body = () => src().slice(src().indexOf('const handleStart'), src().indexOf('const enterBufferPhase'));

  it('記住已解鎖（unlockedRef），解鎖過就不再靜音播放', () => {
    expect(src()).toMatch(/const unlockedRef = useRef\(false\)/);
    expect(body()).toMatch(/if \(org && !unlockedRef\.current\)/);
  });

  it('解鎖結束（暫停）在設定起點之前；就位之後才開始錄音', () => {
    const b = body();
    const end = b.indexOf('endUnlock();');
    const seek = b.indexOf('seekSegmentStart(audioRef.current, sentence.startTime)');
    const prep = b.indexOf('await prepareSegmentStart(');
    const rec = b.indexOf('mediaRecorder.start()');
    expect(end).toBeGreaterThan(-1);
    expect(seek).toBeGreaterThan(end);
    expect(prep).toBeGreaterThan(seek);
    expect(rec).toBeGreaterThan(prep);
  });

  // 語速（playbackRate）不是跳轉，可以在解鎖時套用（tests/shadowingSpeed.test.ts 驗收 6 要求解鎖預播放也套用速度）
  it('解鎖時不設定起點（避免跳轉中暫停）', () => {
    const b = body();
    const unlockBlock = b.slice(b.indexOf('if (org && !unlockedRef.current)'), b.indexOf('await Promise.all('));
    expect(unlockBlock).not.toMatch(/seekSegmentStart|currentTime\s*=/);
  });
});

describe('診斷紀錄多記「是否已播完」與音檔長度', () => {
  it('state 含 ended 與 dur', async () => {
    const { createPlaybackTrace } = await import('../src/utils/playbackTrace');
    const m = new WebKitMedia();
    const t = createPlaybackTrace(m as any);
    t.mark('x');
    expect(t.text()).toMatch(/ended=0/);
    expect(t.text()).toMatch(/dur=550/);
    t.dispose();
  });
});

describe('審查第 1 輪（Codex）：延遲暫停可被新的播放取消', () => {
  it('跳轉中 pauseSafely → 隨即 seekSegmentStart 開始新播放 → 跳轉完成時不暫停', async () => {
    const { pauseSafely, seekSegmentStart } = await import('../src/utils/segmentEnd');
    const m = new WebKitMedia();
    m.play();
    m.currentTime = 19.9;          // 跳轉中
    pauseSafely(m as any);         // 延遲到 seeked
    expect(m.paused).toBe(false);
    seekSegmentStart(m as any, 30);
    m.finishSeek();
    expect(m.paused).toBe(false);
    expect(m.ended).toBe(false);
    expect(m.count()).toBe(0);
  });

  it('沒有新的播放 → 跳轉完成後才暫停（不在跳轉中暫停，播放器不壞）', async () => {
    const { pauseSafely } = await import('../src/utils/segmentEnd');
    const m = new WebKitMedia();
    m.play();
    m.currentTime = 19.9;
    pauseSafely(m as any);
    m.finishSeek();
    expect(m.paused).toBe(true);
    expect(m.ended).toBe(false);
    expect(m.currentTime).toBe(19.9);
  });

  it('聽聽看播原音前取消舊的延遲暫停', () => {
    expect(read('src/utils/shadowingPlayback.ts')).toMatch(/cancelPendingPause\(original\)/);
  });
});
