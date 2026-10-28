import { OVERLAY_ORIGINAL_VOLUME } from './shadowingAudio';

// 跟讀結果頁「聽聽看」的播放控制器（PR #20）：注入播放元素與音量設定，不直接碰 DOM，方便用替身測試

export interface MediaLike {
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export type ListenMode = 'mine' | 'original' | 'overlay';

export interface ListenPlayerOptions {
  /** 使用者錄音（已載入這次的錄音） */
  recording: MediaLike;
  /** 教材原音（整份教材，用 segment 決定播哪一段） */
  original: MediaLike;
  /** 設定原音音量；裝置不能調音量時傳空函式 */
  setOriginalVolume: (v: number) => void;
  /** 這一句的範圍（秒） */
  segment: () => { start: number; end: number };
  /** 重疊播放時原音要延後幾毫秒 */
  offsetMs: () => number;
  onChange?: (mode: ListenMode | null) => void;
}

export interface ListenPlayer {
  toggle(mode: ListenMode): void;
  stop(): void;
  playing(): ListenMode | null;
  /** 播放是由外部啟動的（例如評分後自動播放錄音），只同步狀態 */
  markPlaying(mode: ListenMode): void;
  dispose(): void;
}

const safePlay = (m: MediaLike) => {
  try {
    const p = m.play();
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
  } catch {
    /* 播放被拒（例如 iPhone 沒有使用者手勢）：維持不中斷 */
  }
};

export function createListenPlayer(opts: ListenPlayerOptions): ListenPlayer {
  const { recording, original, setOriginalVolume, segment, offsetMs, onChange } = opts;
  let mode: ListenMode | null = null;
  let generation = 0;
  let disposed = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let cleanups: Array<() => void> = [];
  let originalDone = true;

  const setMode = (m: ListenMode | null) => {
    if (mode === m) return;
    mode = m;
    onChange?.(m);
  };

  const listen = (el: MediaLike, type: string, fn: () => void) => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };

  const later = (ms: number, fn: () => void) => {
    timers.push(setTimeout(fn, Math.max(0, ms)));
  };

  const stop = () => {
    generation += 1;
    timers.forEach(clearTimeout);
    timers = [];
    cleanups.forEach((c) => c());
    cleanups = [];
    try { recording.pause(); } catch { /* 忽略 */ }
    try { original.pause(); } catch { /* 忽略 */ }
    setOriginalVolume(1);
    originalDone = true;
    setMode(null);
  };

  /** 播原音這一句；播到句尾（或保險計時到）就停，回呼 onDone */
  const playOriginal = (gen: number, volume: number, onDone: () => void) => {
    const { start, end } = segment();
    setOriginalVolume(volume);
    original.currentTime = start;
    originalDone = false;
    const finish = () => {
      if (gen !== generation || originalDone) return;
      originalDone = true;
      try { original.pause(); } catch { /* 忽略 */ }
      onDone();
    };
    listen(original, 'timeupdate', () => {
      if (gen === generation && original.currentTime >= end) finish();
    });
    listen(original, 'ended', finish);
    later((end - start) * 1000 + 500, finish);
    safePlay(original);
  };

  const start = (m: ListenMode) => {
    const gen = generation;
    setMode(m);
    if (m === 'mine' || m === 'overlay') {
      recording.currentTime = 0;
      listen(recording, 'ended', () => {
        if (gen === generation) stop();
      });
      safePlay(recording);
    }
    if (m === 'original') {
      playOriginal(gen, 1, () => stop());
    }
    if (m === 'overlay') {
      later(offsetMs(), () => {
        if (gen !== generation) return;
        // 原音播完先停，錄音繼續；錄音播完才整個結束
        playOriginal(gen, OVERLAY_ORIGINAL_VOLUME, () => setOriginalVolume(1));
      });
    }
  };

  return {
    toggle(m) {
      if (disposed) return;
      if (mode === m) { stop(); return; }
      stop();
      start(m);
    },
    stop,
    playing: () => mode,
    markPlaying(m) {
      if (disposed) return;
      // 不暫停外部已啟動的播放，只清掉舊的計時與監聽、同步狀態
      generation += 1;
      timers.forEach(clearTimeout);
      timers = [];
      cleanups.forEach((c) => c());
      cleanups = [];
      const gen = generation;
      setMode(m);
      if (m === 'mine') {
        listen(recording, 'ended', () => {
          if (gen === generation) stop();
        });
      }
    },
    dispose() {
      stop();
      disposed = true;
    },
  };
}
