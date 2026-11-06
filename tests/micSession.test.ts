import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMicSession, waitForMicLive, MicReleasedError, KEEP_MIC_OPEN, type MicSample } from '../src/utils/micSession';
import { playAfterRecordingStarts } from '../src/utils/recordingTiming';

// 規劃：docs/plans/mic-warmup.md
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

// ── 假時鐘：sample(t) 依時間回傳取樣；sleep 推進時間 ──
const clock = (sampleAt: (t: number) => MicSample) => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    sample: () => sampleAt(t),
  };
};
const running = (t: number, db: number): MicSample => ({ db, state: 'running', audioTime: t / 1000 });

describe('waitForMicLive（驗收 1）', () => {
  it('一開始 -90 dB（暖機中），0.4 秒後變 -60 dB → 連續 60ms 後才回傳 live', async () => {
    const c = clock((t) => running(t, t < 400 ? -90 : -60));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => false });
    expect(r).toBe('live');
    expect(c.now()).toBeGreaterThanOrEqual(460);
    expect(c.now()).toBeLessThan(560);
  });
  it('一直 -90 dB → 1.5 秒後逾時', async () => {
    const c = clock((t) => running(t, -90));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => false });
    expect(r).toBe('timeout');
    expect(c.now()).toBeGreaterThanOrEqual(1500);
    expect(c.now()).toBeLessThan(1600);
  });
  it('取消 → cancelled', async () => {
    const c = clock((t) => running(t, -90));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => c.now() > 100 });
    expect(r).toBe('cancelled');
    expect(c.now()).toBeLessThan(200);
  });
  it('AudioContext 暫停時，一直讀到同一份高音量的舊資料 → 不可判定為收音', async () => {
    const c = clock(() => ({ db: -20, state: 'suspended', audioTime: 0.5 }));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => false });
    expect(r).toBe('timeout');
  });
  it('running 但 currentTime 沒有前進（沒有新資料）→ 不可判定為收音', async () => {
    const c = clock(() => ({ db: -20, state: 'running', audioTime: 1 }));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => false });
    expect(r).toBe('timeout');
  });
  it('高於門檻中途掉回 -90 → 重新累積', async () => {
    const c = clock((t) => running(t, (t >= 100 && t < 140) || t >= 300 ? -50 : -90));
    const r = await waitForMicLive({ sample: c.sample, now: c.now, sleep: c.sleep, isCancelled: () => false });
    expect(r).toBe('live');
    expect(c.now()).toBeGreaterThanOrEqual(360);
  });
});

describe('playAfterRecordingStarts 帶 waitLive（驗收 2）', () => {
  it('start 事件先到、麥克風還沒收音 → 不播；兩者都完成再過 300ms 才播', async () => {
    vi.useFakeTimers();
    try {
      let onStart: (() => void) | null = null;
      const rec = { state: 'recording', addEventListener: (_t: 'start', fn: () => void) => { onStart = fn; } };
      let liveResolve!: () => void;
      const live = new Promise<void>((r) => { liveResolve = r; });
      const play = vi.fn();
      const p = playAfterRecordingStarts(rec, { leadMs: 300, isCancelled: () => false, play, waitLive: () => live });
      onStart!();
      await vi.advanceTimersByTimeAsync(1000);
      expect(play).not.toHaveBeenCalled();
      liveResolve();
      await vi.advanceTimersByTimeAsync(299);
      expect(play).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toBe(true);
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('等待中被取消 → 不播', async () => {
    vi.useFakeTimers();
    try {
      const rec = { state: 'recording', addEventListener: (_t: 'start', fn: () => void) => { fn(); } };
      let cancelled = false;
      const play = vi.fn();
      const p = playAfterRecordingStarts(rec, { leadMs: 300, isCancelled: () => cancelled, play, waitLive: async () => { cancelled = true; } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toBe(false);
      expect(play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 假的麥克風與 AudioContext ──
const fakeTrack = () => ({ readyState: 'live' as string, enabled: true, muted: false, stop: vi.fn(function (this: any) { this.readyState = 'ended'; }) });
const fakeStream = () => {
  const t = fakeTrack();
  return { track: t, stream: { getAudioTracks: () => [t], getTracks: () => [t] } as unknown as MediaStream };
};
const fakeCtx = () => {
  const ctx: any = {
    state: 'running', currentTime: 0,
    resume: vi.fn(async () => { ctx.state = 'running'; }),
    close: vi.fn(async () => { ctx.state = 'closed'; }),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createAnalyser: vi.fn(() => ({ fftSize: 0, getFloatTimeDomainData: vi.fn(), getByteFrequencyData: vi.fn(), frequencyBinCount: 128, disconnect: vi.fn() })),
  };
  return ctx;
};

describe('createMicSession（驗收 3）', () => {
  it('第二次 acquire 沿用同一個麥克風，不再呼叫 getUserMedia', async () => {
    const s = fakeStream();
    const getUserMedia = vi.fn(async () => s.stream);
    const mic = createMicSession({ getUserMedia, createAudioContext: () => fakeCtx() });
    const a = await mic.acquire();
    const b = await mic.acquire();
    expect(a).toBe(b);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('同時呼叫兩次只取得一次', async () => {
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const mic = createMicSession({ getUserMedia, createAudioContext: () => fakeCtx() });
    const [a, b] = await Promise.all([mic.acquire(), mic.acquire()]);
    expect(a).toBe(b);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('軌道已結束（例如切到背景）→ 重新取得', async () => {
    const first = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(fakeStream().stream);
    const mic = createMicSession({ getUserMedia, createAudioContext: () => fakeCtx() });
    await mic.acquire();
    first.track.readyState = 'ended';
    await mic.acquire();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
  it('release 停止軌道並關閉 AudioContext', async () => {
    const s = fakeStream();
    const ctx = fakeCtx();
    const mic = createMicSession({ getUserMedia: async () => s.stream, createAudioContext: () => ctx });
    await mic.acquire();
    mic.release();
    expect(s.track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });
  it('取得中途 release（權限視窗還沒按完就離開）→ 晚到的麥克風立刻停止、不建立 AudioContext', async () => {
    const s = fakeStream();
    let resolveGum!: (m: MediaStream) => void;
    const createAudioContext = vi.fn(() => fakeCtx());
    const mic = createMicSession({ getUserMedia: () => new Promise((r) => { resolveGum = r; }), createAudioContext });
    const p = mic.acquire();
    mic.release();
    resolveGum(s.stream);
    await expect(p).rejects.toBeInstanceOf(MicReleasedError);
    expect(s.track.stop).toHaveBeenCalled();
    expect(createAudioContext).not.toHaveBeenCalled();
  });
  it('resume 同步呼叫 AudioContext.resume', async () => {
    const ctx = fakeCtx();
    const mic = createMicSession({ getUserMedia: async () => fakeStream().stream, createAudioContext: () => ctx });
    await mic.acquire();
    ctx.state = 'suspended';
    mic.resume();
    expect(ctx.resume).toHaveBeenCalled();
  });
  it('整頁共用麥克風（擁有者決定）', () => {
    expect(KEEP_MIC_OPEN).toBe(true);
  });
});

describe('三個畫面接線（驗收 4、5）', () => {
  const views = ['src/components/ShadowingPracticeView.tsx', 'src/components/PatternPracticeSessionView.tsx', 'src/components/RetellView.tsx'];
  for (const f of views) {
    it(`${f}：用共用麥克風、進頁面暖機、點擊當下 resume、等收音`, () => {
      const src = read(f);
      expect(src).toContain('useMicSession');
      expect(src).not.toMatch(/navigator\.mediaDevices\.getUserMedia/);
      expect(src).toMatch(/mic\.resume\(\)/);
      expect(src).toMatch(/waitForMicLive\(/);
    });
  }
  it('影子跟讀：原音要等收音確認後才播', () => {
    expect(read('src/components/ShadowingPracticeView.tsx')).toMatch(/playAfterRecordingStarts\([^)]*\{[\s\S]*?waitLive:/);
  });
  it('準備中的文案', () => {
    expect(read('src/components/ShadowingPracticeView.tsx')).toContain('準備麥克風…');
    expect(read('src/components/PatternPracticeSessionView.tsx')).toContain('準備中…');
    expect(read('src/components/RetellView.tsx')).toContain('準備中…');
  });
  it('語言模型練習：計時在收音確認之後才開始', () => {
    const src = read('src/components/PatternPracticeSessionView.tsx');
    const wait = src.indexOf('waitForMicLive(');
    const timerStart = src.indexOf('recordingStartTimeRef.current = Date.now()');
    expect(wait).toBeGreaterThan(-1);
    expect(timerStart).toBeGreaterThan(wait);
  });
});

describe('審查修正（Codex 第 1 輪）', () => {
  it('音訊分析初始化失敗 → 已取得的麥克風停止、AudioContext 關閉', async () => {
    const s = fakeStream();
    const ctx = fakeCtx();
    ctx.createMediaStreamSource = vi.fn(() => { throw new Error('boom'); });
    const mic = createMicSession({ getUserMedia: async () => s.stream, createAudioContext: () => ctx });
    await expect(mic.acquire()).rejects.toThrow('boom');
    expect(s.track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(mic.peek()).toBeNull();
  });
  it('建立 AudioContext 本身失敗 → 麥克風停止，下次可重新取得', async () => {
    const s = fakeStream();
    const getUserMedia = vi.fn(async () => s.stream);
    const createAudioContext = vi.fn().mockImplementationOnce(() => { throw new Error('no ctx'); }).mockImplementation(() => fakeCtx());
    const mic = createMicSession({ getUserMedia, createAudioContext });
    await expect(mic.acquire()).rejects.toThrow('no ctx');
    expect(s.track.stop).toHaveBeenCalled();
    getUserMedia.mockResolvedValueOnce(fakeStream().stream);
    await expect(mic.acquire()).resolves.toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
