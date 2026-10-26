// 主題模式：跟隨系統／淺色／深色
// ⚠️ index.html 的行內腳本用同樣的規則在首屏決定深淺色，修改這裡的判斷時要一起改

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'themeMode';
/** 舊版的深色開關（每次開啟都會寫回，無法分辨是否為使用者選擇，所以不沿用） */
export const LEGACY_DARK_KEY = 'isDarkMode';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** 只接受完全相同的三個值，其他（null、舊版布林字串、帶引號、大小寫不同）一律視為跟隨系統 */
export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function resolveIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 讀取主題設定；storage 不存在或拋錯（Safari 無痕、被封鎖）時回傳跟隨系統 */
export function readThemeMode(storage: StorageLike | null | undefined): ThemeMode {
  try {
    return parseThemeMode(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** 儲存主題設定（純字串，不用 JSON），並移除舊版的 isDarkMode；失敗時靜默略過 */
export function writeThemeMode(storage: StorageLike | null | undefined, mode: ThemeMode): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 無法儲存時只影響下次開啟的預設值，不影響目前畫面
  }
  try {
    storage.removeItem(LEGACY_DARK_KEY);
  } catch {
    // 同上
  }
}

/** 取得瀏覽器的 localStorage；在被封鎖的環境存取 window.localStorage 本身就可能拋錯 */
export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
