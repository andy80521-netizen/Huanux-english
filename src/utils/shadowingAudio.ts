// 跟讀辨識改善（PR #20）：音量、對齊、句子範圍、耳機提醒。純函式，不碰 DOM，方便測試

/** 錄音時原音音量（擁有者 2026-10-28 決定先用 50%，試用後再調） */
export const RECORDING_ORIGINAL_VOLUME = 0.5;
/** 結果頁重疊播放時原音音量 */
export const OVERLAY_ORIGINAL_VOLUME = 0.5;
/** 重疊播放對齊延遲上限：只用來擋壞掉的時間戳 */
export const OVERLAY_OFFSET_MAX_MS = 3000;
/** 「不再提醒」記在瀏覽器（帶版本，日後改提醒內容可再顯示一次） */
export const HEADPHONE_TIP_KEY = 'huanux_headphone_tip_dismissed_v1';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 這台裝置能不能用 audio.volume 調音量。iPhone／iPad 的 volume 是唯讀（設了讀回仍是 1）。
 * 請傳一個「沒有載入任何音檔」的暫時元素（例如 new Audio()），不要用正在播放的元素，避免聽得到音量跳動。
 */
export function canSetElementVolume(probe: { volume: number } | null | undefined): boolean {
  if (!probe) return false;
  try {
    probe.volume = 0.5;
    const ok = Math.abs(probe.volume - 0.5) < 0.01;
    probe.volume = 1;
    return ok;
  } catch {
    return false;
  }
}

/** 原音實際開始播放比錄音開始晚多少毫秒（夾在 0～上限；缺值為 0） */
export function overlayOffsetMs(recordStartAt: number | null | undefined, originalPlayingAt: number | null | undefined): number {
  if (!finite(recordStartAt) || !finite(originalPlayingAt)) return 0;
  return Math.min(OVERLAY_OFFSET_MAX_MS, Math.max(0, Math.round(originalPlayingAt - recordStartAt)));
}

/** 「原音」與重疊播放要播的範圍（秒）：只播這一句；結束時間無效時用錄音長度當上限，不會播到整份教材結尾 */
export function sentenceSegment(startTime: number, endTime: number, recordingSec: number): { start: number; end: number } {
  const start = finite(startTime) && startTime > 0 ? startTime : 0;
  if (finite(endTime) && endTime > start) return { start, end: endTime };
  const len = finite(recordingSec) && recordingSec > 0 ? recordingSec : 0;
  return { start, end: start + len };
}

type StorageGetter = () => Pick<Storage, 'getItem'> | null | undefined;
type StorageSetter = () => Pick<Storage, 'setItem'> | null | undefined;

/** 要不要顯示耳機提醒；瀏覽器儲存不可用時一律提醒（但不影響練習） */
export function shouldShowHeadphoneTip(getStorage: StorageGetter): boolean {
  try {
    return getStorage()?.getItem(HEADPHONE_TIP_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissHeadphoneTip(getStorage: StorageSetter): void {
  try {
    getStorage()?.setItem(HEADPHONE_TIP_KEY, '1');
  } catch {
    /* 無痕模式等情況存不了：下次再提醒即可 */
  }
}
