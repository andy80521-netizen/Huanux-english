import { OVERLAY_ORIGINAL_VOLUME } from './shadowingAudio';
import { watchSegmentEnd, guardSegmentStart, pauseSafely, recoverIfEnded, cancelPendingPause } from './segmentEnd';

// 跟讀結果頁「聽聽看」的播放控制器（PR #20）：注入播放元素與音量設定，不直接碰 DOM，方便用替身測試

export interface MediaLike {
  currentTime: number;
  /** 播放速度（原音放慢用；docs/plans/shadowing-speed.md） */
  playbackRate?: number;
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
  /** 原音播放速度（這次錄音當下的速度）；不傳＝1 倍。使用者錄音一律 1 倍 */
  rate?: () => number;
  /** 原音沒辦法跳到這一句的開頭（iPhone 長教材，docs/plans/ios-seek-fix.md）：已停止播放，附診斷文字 */
  onStartFail?: (diag: string) => void;
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
  const { recording, original, setOriginalVolume, segment, offsetMs, onChange, rate, onStartFail } = opts;
  const setOriginalRate = (r: number) => {
    original.playbackRate = r;
    const a = original as { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
  };
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
    try { pauseSafely(original); } catch { /* 忽略 */ }
    setOriginalVolume(1);
    if (rate) setOriginalRate(1);
    originalDone = true;
    setMode(null);
  };

  /** 播原音這一句；播到句尾（或保險計時到）就停，回呼 onDone */
  const playOriginal = (gen: number, volume: number, onDone: () => void) => {
    const { start, end } = segment();
    const r = rate ? rate() : 1;
    if (rate) setOriginalRate(r);
    setOriginalVolume(volume);
    cancelPendingPause(original);   // 切換模式時 stop() 留下的延遲暫停不可中斷這次播放（Codex）
    recoverIfEnded(original);   // iPhone：播放器已處於「已播完」→ 重新載入，否則會從頭播（docs/plans/ios-ended-fix.md）
    original.currentTime = start;
    originalDone = false;
    const finish = () => {
      if (gen !== generation || originalDone) return;
      originalDone = true;
      try { pauseSafely(original); } catch { /* 忽略 */ }
      onDone();
    };
    listen(original, 'ended', finish);
    // 保險計時：timeupdate 沒來時也要停。到期時若原音「有在前進」但還沒到句尾（例如等緩衝延後才開始），
    // 繼續每 500ms 檢查，不提早截斷；完全沒前進（卡住、播放失敗）就停止。最多再等 30 秒
    let lastPos = start;
    let extraChecks = 0;
    const check = () => {
      if (gen !== generation || originalDone) return;
      const pos = original.currentTime;
      if (pos >= end) { finish(); return; }
      const progressed = pos > lastPos + 0.05;
      lastPos = pos;
      if (!progressed || extraChecks >= 60) { finish(); return; }
      extraChecks += 1;
      later(500, check);
    };
    later(((end - start) / (r > 0 ? r : 1)) * 1000 + 500, check);
    safePlay(original);
    // 確認真的從句子開頭播（iPhone 長教材會跳不過去，docs/plans/ios-seek-fix.md）；跳不過去就停，不從音檔開頭播
    // 失敗時整個停止（重疊播放不留下只有錄音在播）並回報，讓畫面顯示診斷（Codex）
    cleanups.push(guardSegmentStart(original, start, (diag) => {
      if (gen !== generation) return;
      stop();
      onStartFail?.(diag);
    }));
    // 準時停在句尾（docs/plans/import-timestamp-accuracy.md PR-A）；頁面隱藏時整個停止（擁有者決定）
    cleanups.push(watchSegmentEnd(original, end, (reason) => {
      if (gen !== generation) return;
      if (reason === 'hidden') { stop(); return; }
      finish();
    }));
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
