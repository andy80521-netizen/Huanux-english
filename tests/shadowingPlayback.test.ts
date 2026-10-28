import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createListenPlayer, type MediaLike, type ListenMode } from '../src/utils/shadowingPlayback';

// 結果頁「聽聽看」播放控制器的行為（替身播放器＋假計時器）

class FakeMedia implements MediaLike {
  currentTime = 0;
  paused = true;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();
  play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) { this.listeners.get(type)?.delete(fn); }
  emit(type: string) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
  listenerCount() { let n = 0; this.listeners.forEach((s) => { n += s.size; }); return n; }
}

const setup = (seg = { start: 10, end: 13 }, offset = 200) => {
  const recording = new FakeMedia();
  const original = new FakeMedia();
  const volumes: number[] = [];
  const changes: Array<ListenMode | null> = [];
  const player = createListenPlayer({
    recording, original,
    setOriginalVolume: (v) => { volumes.push(v); },
    segment: () => seg,
    offsetMs: () => offset,
    onChange: (m) => { changes.push(m); },
  });
  return { recording, original, volumes, changes, player };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('我的錄音', () => {
  it('從頭播放；播完回到沒在播', () => {
    const { recording, player, changes } = setup();
    recording.currentTime = 2.3;
    player.toggle('mine');
    expect(recording.currentTime).toBe(0);
    expect(recording.paused).toBe(false);
    expect(player.playing()).toBe('mine');
    recording.emit('ended');
    expect(player.playing()).toBeNull();
    expect(changes).toEqual(['mine', null]);
  });
  it('播放中再按一次 → 停止', () => {
    const { recording, player } = setup();
    player.toggle('mine');
    player.toggle('mine');
    expect(recording.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
});

describe('原音（只播這一句）', () => {
  it('從句子開始播，音量 1，播到句尾自動停', () => {
    const { original, player, volumes } = setup();
    player.toggle('original');
    expect(original.currentTime).toBe(10);
    expect(original.paused).toBe(false);
    expect(volumes.at(-1)).toBe(1);
    original.currentTime = 12.9; original.emit('timeupdate');
    expect(original.paused).toBe(false);
    original.currentTime = 13.05; original.emit('timeupdate');
    expect(original.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
  it('timeupdate 沒來也會在句子長度後停止（保險計時）', () => {
    const { original, player } = setup();
    player.toggle('original');
    vi.advanceTimersByTime(3000 + 600);
    expect(original.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
});

describe('重疊播放', () => {
  it('錄音先播；原音延後 offset 再播，音量 0.5，從句子開始', () => {
    const { recording, original, player, volumes } = setup({ start: 10, end: 13 }, 200);
    player.toggle('overlay');
    expect(recording.paused).toBe(false);
    expect(original.paused).toBe(true);
    vi.advanceTimersByTime(199);
    expect(original.paused).toBe(true);
    vi.advanceTimersByTime(1);
    expect(original.paused).toBe(false);
    expect(original.currentTime).toBe(10);
    expect(volumes.at(-1)).toBe(0.5);
  });
  it('原音到句尾先停，錄音繼續；錄音播完才結束並把音量還原為 1', () => {
    const { recording, original, player, volumes } = setup({ start: 10, end: 13 }, 0);
    player.toggle('overlay');
    vi.advanceTimersByTime(0);
    original.currentTime = 13.1; original.emit('timeupdate');
    expect(original.paused).toBe(true);
    expect(recording.paused).toBe(false);
    expect(player.playing()).toBe('overlay');
    recording.emit('ended');
    expect(player.playing()).toBeNull();
    expect(volumes.at(-1)).toBe(1);
  });
});

describe('互斥與失效', () => {
  it('按另一個按鈕 → 先停兩路再播新的', () => {
    const { recording, original, player } = setup();
    player.toggle('overlay');
    vi.advanceTimersByTime(200);
    player.toggle('mine');
    expect(original.paused).toBe(true);
    expect(recording.paused).toBe(false);
    expect(player.playing()).toBe('mine');
  });
  it('停止後，延遲中的原音不會再開始播放', () => {
    const { original, player } = setup({ start: 10, end: 13 }, 500);
    player.toggle('overlay');
    player.stop();
    vi.advanceTimersByTime(2000);
    expect(original.paused).toBe(true);
    expect(original.playCalls).toBe(0);
  });
  it('停止會清掉事件監聽並還原音量', () => {
    const { recording, original, player, volumes } = setup();
    player.toggle('overlay');
    vi.advanceTimersByTime(200);
    player.stop();
    expect(recording.listenerCount()).toBe(0);
    expect(original.listenerCount()).toBe(0);
    expect(volumes.at(-1)).toBe(1);
  });
  it('dispose 之後 toggle 不再播放', () => {
    const { recording, player } = setup();
    player.dispose();
    player.toggle('mine');
    expect(recording.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
  it('markPlaying：評分後自動播放錄音時，同步成「我的錄音」播放中，再按一次就是停止', () => {
    const { recording, player } = setup();
    recording.play();
    player.markPlaying('mine');
    expect(player.playing()).toBe('mine');
    player.toggle('mine');
    expect(recording.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
});

// 審查第 1 輪（Codex、Gemini）：等緩衝延後才開始播放時，不可在句尾前截斷
describe('原音延後開始或途中緩衝', () => {
  it('保險計時到期時原音有在前進但還沒到句尾 → 繼續播，到句尾才停', () => {
    const { original, player } = setup({ start: 10, end: 13 });
    player.toggle('original');
    vi.advanceTimersByTime(1500);
    original.currentTime = 10.4; // 緩衝後才開始
    vi.advanceTimersByTime(2000); // 已過 3500ms 保險時間
    original.currentTime = 11;
    vi.advanceTimersByTime(500);
    expect(original.paused).toBe(false);
    expect(player.playing()).toBe('original');
    original.currentTime = 12.5;
    vi.advanceTimersByTime(500);
    expect(original.paused).toBe(false);
    original.currentTime = 13.02; original.emit('timeupdate');
    expect(original.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
  it('前進後卡住不動 → 停止，不會無限等待', () => {
    const { original, player } = setup({ start: 10, end: 13 });
    player.toggle('original');
    original.currentTime = 11;
    vi.advanceTimersByTime(3500);
    expect(original.paused).toBe(false);
    vi.advanceTimersByTime(500);
    expect(original.paused).toBe(true);
    expect(player.playing()).toBeNull();
  });
});
