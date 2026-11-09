import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as seg from '../src/utils/segmentEnd';

// 規劃：docs/plans/ios-seek-fix.md
// 擁有者 2026-11-09：iPhone 上長教材（9 分鐘）每次都從音檔開頭播（跟讀、詳情頁、聽句尾）；短教材正常
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const guardSegmentStart = (seg as any).guardSegmentStart as (m: any, s: number, f: (d: string) => void) => () => void;

/** 假的播放元素：ignoreSeeks 次數內設定位置會被忽略（模擬 iPhone）；fragmentWorks 決定 #t= 是否有效 */
class FakeMedia {
  paused = true;
  seeking = false;
  readyState = 4;
  duration = 550;
  src = 'https://example.test/a.mp3?alt=media';
  currentSrc = 'https://example.test/a.mp3?alt=media';
  seekable = { length: 1, start: () => 0, end: () => 35 };
  buffered = { length: 1, start: () => 0, end: () => 35 };
  pos = 0;
  seekCalls = 0;
  loads = 0;
  plays = 0;
  private ls = new Map<string, Set<() => void>>();
  constructor(public ignoreSeeks = 0, public fragmentWorks = false) {}
  get currentTime() { return this.pos; }
  set currentTime(t: number) {
    this.seekCalls++;
    if (this.seekCalls > this.ignoreSeeks) this.pos = t;
    this.emit('seeked');
  }
  play() {
    this.plays++;
    this.paused = false;
    this.emit('playing');
    return Promise.resolve();
  }
  pause() { if (this.paused) return; this.paused = true; this.emit('pause'); }
  load() {
    this.loads++;
    this.paused = true;
    const m = /#t=([\d.]+)/.exec(this.src);
    this.pos = m && this.fragmentWorks ? Number(m[1]) : 0;
  }
  /** 播放中前進 0.25 秒並觸發 timeupdate（2026-11-10 起，起點確認要看到位置在前進才判斷） */
  tick() { if (!this.paused) this.pos += 0.25; this.emit('timeupdate'); }
  addEventListener(t: string, f: () => void) { if (!this.ls.has(t)) this.ls.set(t, new Set()); this.ls.get(t)!.add(f); }
  removeEventListener(t: string, f: () => void) { this.ls.get(t)?.delete(f); }
  emit(t: string) { [...(this.ls.get(t) ?? [])].forEach(f => f()); }
  count() { let n = 0; this.ls.forEach(s => (n += s.size)); return n; }
}

// 擁有者 2026-11-10 同意：起點確認改成「位置確實在前進後才判斷」（docs/plans/shadowing-stable-playback.md），
// 以下測試由「emit 一次 timeupdate 就判斷」改成「播放前進幾次（run）後判斷」，補跳／失敗回報／拆監聽的檢查保留
const run = (m: { tick(): void }, n: number) => { for (let i = 0; i < n; i++) m.tick(); };

describe('guardSegmentStart：確認真的從起點播放', () => {
  it('匯出 guardSegmentStart', () => {
    expect(typeof guardSegmentStart).toBe('function');
  });

  it('第一次設定被忽略（還在 0 秒）→ 再跳一次就成功，不回報失敗', () => {
    const m = new FakeMedia(1);
    const onFail = vi.fn();
    m.currentTime = 300;          // 呼叫端的 seekSegmentStart（被忽略）
    m.play();
    guardSegmentStart(m, 300, onFail);
    run(m, 6);
    expect(m.currentTime).toBeGreaterThanOrEqual(300);
    expect(m.currentTime).toBeLessThanOrEqual(301);
    expect(onFail).not.toHaveBeenCalled();
    expect(m.paused).toBe(false);
  });

  it('開始播放後被重設回 0 → 拉回起點', () => {
    const m = new FakeMedia(0);
    const onFail = vi.fn();
    m.currentTime = 120;
    m.play();
    guardSegmentStart(m, 120, onFail);
    run(m, 3);
    m.pos = 0.3;                  // 播放開始時被重設
    run(m, 4);
    expect(m.currentTime).toBeGreaterThanOrEqual(120);
    expect(m.currentTime).toBeLessThan(121);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('設定位置一直被忽略 → 改用網址指定起點（#t=）重新載入並播放', () => {
    const m = new FakeMedia(99, true);
    const onFail = vi.fn();
    m.currentTime = 300;
    m.play();
    guardSegmentStart(m, 300, onFail);
    run(m, 6);
    expect(m.src).toBe('https://example.test/a.mp3?alt=media#t=300.00');
    expect(m.loads).toBe(1);
    expect(m.paused).toBe(false);
    expect(m.currentTime).toBe(300);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('#t= 也沒用 → 暫停並回報診斷文字（不默默從頭播）', () => {
    const m = new FakeMedia(99, false);
    const onFail = vi.fn();
    m.currentTime = 300;
    m.play();
    guardSegmentStart(m, 300, onFail);
    run(m, 12);
    expect(onFail).toHaveBeenCalledTimes(1);
    const diag = onFail.mock.calls[0][0] as string;
    expect(diag).toContain('目標 300.0 秒');
    expect(diag).toContain('可跳轉 0.0～35.0');
    expect(m.paused).toBe(true);
    expect(m.count()).toBe(0);    // 監聽都拆掉
  });

  it('跳轉中（seeking）或暫停中不判斷', () => {
    const m = new FakeMedia(99);
    const onFail = vi.fn();
    guardSegmentStart(m, 300, onFail);       // 暫停中
    m.paused = false;
    m.seeking = true;
    m.emit('timeupdate');
    expect(m.seekCalls).toBe(0);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('起點在開頭附近（≤ 0.5 秒）→ 不處理', () => {
    const m = new FakeMedia(99);
    m.play();
    const onFail = vi.fn();
    guardSegmentStart(m, 0.4, onFail);
    m.emit('timeupdate');
    expect(m.seekCalls).toBe(0);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('取消後不再處理，監聽都拆掉', () => {
    const m = new FakeMedia(99);
    m.play();
    const onFail = vi.fn();
    const cancel = guardSegmentStart(m, 300, onFail);
    const before = m.seekCalls;
    cancel();
    m.emit('timeupdate');
    expect(m.seekCalls).toBe(before);
    expect(m.count()).toBe(0);
  });
});

describe('接線：所有直接跳位置的播放入口都確認起點', () => {
  for (const f of [
    'src/components/ShadowingPracticeView.tsx',
    'src/components/MaterialDetailView.tsx',
    'src/components/MaterialReviewPanel.tsx',
    'src/utils/shadowingPlayback.ts',
  ]) {
    it(`${f} 呼叫 guardSegmentStart`, () => {
      expect(read(f)).toMatch(/guardSegmentStart\(/);
    });
  }

  it('跟讀：按下時先設定起點，再做靜音解鎖播放', () => {
    const src = read('src/components/ShadowingPracticeView.tsx');
    const body = src.slice(src.indexOf('const handleStart'));
    const seekAt = body.indexOf('seekSegmentStart(org, sentence.startTime)');
    const unlockAt = body.indexOf('org.play()');
    expect(seekAt).toBeGreaterThan(-1);
    expect(unlockAt).toBeGreaterThan(seekAt);
  });

  it('聽句尾維持句尾後多播 0.5 秒（擁有者 2026-11-09：不要拿掉）', () => {
    expect(read('src/utils/timeEdit.ts')).toMatch(/TAIL_AFTER_SEC\s*=\s*0\.5/);
  });
});

describe('審查第 1 輪補充', () => {
  it('#t= 重新載入時 play() 被拒 → 暫停並回報（Codex）', async () => {
    const m = new FakeMedia(99, true);
    m.currentTime = 300;
    m.play();
    m.play = () => { m.plays++; return Promise.reject(new Error('NotAllowedError')); };
    const onFail = vi.fn();
    guardSegmentStart(m, 300, onFail);   // 播放前進 → 補跳 2 次無效 → #t= 重新載入 → play 被拒
    run(m, 9);
    await Promise.resolve(); await Promise.resolve();
    expect(m.loads).toBe(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(m.count()).toBe(0);
  });

  it('#t= 重新載入後音檔載入失敗（error）→ 回報', () => {
    const m = new FakeMedia(99, true);
    m.currentTime = 300;
    m.play();
    const onFail = vi.fn();
    guardSegmentStart(m, 300, onFail);
    run(m, 9);
    expect(m.loads).toBe(1);
    m.emit('error');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('allowReload: false → 不重新載入，直接回報（跟讀錄音中，Gemini）', () => {
    const m = new FakeMedia(99, true);
    m.currentTime = 300;
    m.play();
    const onFail = vi.fn();
    (seg as any).guardSegmentStart(m, 300, onFail, { allowReload: false });
    run(m, 12);
    expect(m.loads).toBe(0);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(m.paused).toBe(true);
  });

  it('withStartFragment：去掉舊的 #t= 再加新的', () => {
    expect((seg as any).withStartFragment('https://x/a.mp3?alt=media#t=300.00', 12.5)).toBe('https://x/a.mp3?alt=media#t=12.50');
    expect((seg as any).withStartFragment('https://x/a.mp3#t=3', 0)).toBe('https://x/a.mp3');
  });

  // 擁有者 2026-11-10 核准規劃：拿掉「跳不過去後每次按跟讀都換網址」（整份重新下載、造成連續誤判），錄音中仍不重新載入
  it('跟讀：不換音檔網址；錄音中不重新載入', () => {
    const src = read('src/components/ShadowingPracticeView.tsx');
    expect(src).not.toMatch(/\.src = withStartFragment/);
    expect(src).toMatch(/\{ allowReload: false/);
  });

  it('聽聽看：跳不過去時回報給畫面（Codex）', async () => {
    const { createListenPlayer } = await import('../src/utils/shadowingPlayback');
    const original = new FakeMedia(99, false);
    const recording = new FakeMedia(0);
    const onStartFail = vi.fn();
    const player = createListenPlayer({
      recording: recording as any, original: original as any, setOriginalVolume: () => {},
      segment: () => ({ start: 300, end: 303 }), offsetMs: () => 0, onStartFail,
    } as any);
    player.toggle('original');
    run(original, 12);
    expect(onStartFail).toHaveBeenCalledTimes(1);
    expect(player.playing()).toBe(null);
    player.dispose();
    expect(read('src/components/ShadowingPracticeView.tsx')).toMatch(/onStartFail: \(diag\) =>/);
  });
});
