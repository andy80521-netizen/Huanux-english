// 錄音時序（PR A 審查第 1 輪，Codex）：抽成可測試的小函式

export interface RecorderLike {
  state: string;
  addEventListener(type: 'start', fn: () => void, opts?: { once?: boolean }): void;
}

/**
 * 影子跟讀：等錄音真正啟動（start 事件，或保險時間到）後再等 leadMs，才呼叫 play。
 * start 事件是非同步發出的，在呼叫 recorder.start() 之後立刻呼叫本函式也收得到；收不到時有保險時間。
 * 等待期間被取消（換句、重錄、離開）或錄音已停止 → 不播放，回傳 false。
 */
export async function playAfterRecordingStarts(
  recorder: RecorderLike,
  opts: { leadMs: number; fallbackMs?: number; isCancelled: () => boolean; play: () => void },
): Promise<boolean> {
  const { leadMs, fallbackMs = 800, isCancelled, play } = opts;
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, fallbackMs);
    recorder.addEventListener('start', () => { clearTimeout(fallback); resolve(); }, { once: true });
  });
  await new Promise((r) => setTimeout(r, leadMs));
  if (isCancelled() || recorder.state !== 'recording') return false;
  play();
  return true;
}

/** 舊版「講完自動停止」的結尾等待（秒）；流暢度的時長以此為準，避免改長自動停止的等待後同樣的朗讀分數變低 */
export const LEGACY_TAIL_SEC = 1.5;

/**
 * 語言模型複習評分用的錄音時長（秒）：最後出聲時間 + 舊版的 1.5 秒，等同舊版自動停止時的長度；
 * 不超過實際錄音長度；沒偵測到聲音時用實際錄音長度
 */
export function practiceDurationSec(startedAt: number, lastSoundAt: number, stoppedAt: number): number {
  const actual = Math.max(0, (stoppedAt - startedAt) / 1000);
  if (!(lastSoundAt > startedAt)) return actual;
  return Math.min(actual, (lastSoundAt - startedAt) / 1000 + LEGACY_TAIL_SEC);
}
