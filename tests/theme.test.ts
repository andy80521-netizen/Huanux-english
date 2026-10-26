import { describe, it, expect } from 'vitest';
import {
  parseThemeMode,
  resolveIsDark,
  readThemeMode,
  writeThemeMode,
  THEME_STORAGE_KEY,
  LEGACY_DARK_KEY,
  type ThemeMode,
} from '../src/utils/theme';

/** 模擬 localStorage，可設定為讀寫時拋錯（Safari 無痕、配額滿） */
function makeStorage(initial: Record<string, string> = {}, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key: string) {
      if (opts.throwOnGet) throw new Error('SecurityError');
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem(key: string) {
      if (opts.throwOnSet) throw new Error('SecurityError');
      data.delete(key);
    },
  };
}

describe('parseThemeMode：只接受三個合法值，其他一律跟隨系統', () => {
  it.each(['system', 'light', 'dark'] as const)('合法值 %s 原樣回傳', (v) => {
    expect(parseThemeMode(v)).toBe(v);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空字串', ''],
    ['舊版布林字串 true', 'true'],
    ['舊版布林字串 false', 'false'],
    ['大寫 Dark', 'Dark'],
    ['JSON 字串 "dark"', '"dark"'],
    ['尾端空白', 'system '],
    ['其他文字', 'blue'],
  ])('%s → system', (_label, raw) => {
    expect(parseThemeMode(raw as string | null | undefined)).toBe('system');
  });
});

describe('resolveIsDark：三種模式 × 系統深淺', () => {
  const cases: Array<[ThemeMode, boolean, boolean]> = [
    ['system', true, true],
    ['system', false, false],
    ['light', true, false],
    ['light', false, false],
    ['dark', true, true],
    ['dark', false, true],
  ];
  it.each(cases)('模式 %s、系統深色 %s → %s', (mode, systemDark, expected) => {
    expect(resolveIsDark(mode, systemDark)).toBe(expected);
  });
});

describe('readThemeMode / writeThemeMode', () => {
  it('沒有存過 → system', () => {
    expect(readThemeMode(makeStorage())).toBe('system');
  });

  it('舊版的 isDarkMode 不沿用 → system', () => {
    expect(readThemeMode(makeStorage({ [LEGACY_DARK_KEY]: 'true' }))).toBe('system');
  });

  it('寫入後讀回相同值', () => {
    const s = makeStorage();
    writeThemeMode(s, 'dark');
    expect(readThemeMode(s)).toBe('dark');
    writeThemeMode(s, 'light');
    expect(readThemeMode(s)).toBe('light');
  });

  it('寫入純字串（不是 JSON 字串），鍵名為 themeMode', () => {
    const s = makeStorage();
    writeThemeMode(s, 'dark');
    expect(THEME_STORAGE_KEY).toBe('themeMode');
    expect(s.data.get('themeMode')).toBe('dark');
  });

  it('寫入時移除舊版 isDarkMode，其他鍵不受影響', () => {
    const s = makeStorage({ [LEGACY_DARK_KEY]: 'true', voicePrefs: '{"zh":"","en":""}', guest_vocab: '[]' });
    writeThemeMode(s, 'system');
    expect(s.data.has(LEGACY_DARK_KEY)).toBe(false);
    expect(s.data.get('voicePrefs')).toBe('{"zh":"","en":""}');
    expect(s.data.get('guest_vocab')).toBe('[]');
  });

  it('讀取拋錯時不拋出，回傳 system', () => {
    expect(() => readThemeMode(makeStorage({}, { throwOnGet: true }))).not.toThrow();
    expect(readThemeMode(makeStorage({}, { throwOnGet: true }))).toBe('system');
  });

  it('寫入拋錯時不拋出', () => {
    expect(() => writeThemeMode(makeStorage({}, { throwOnSet: true }), 'dark')).not.toThrow();
  });

  it('沒有 storage（例如被瀏覽器封鎖）時不拋出', () => {
    expect(readThemeMode(null)).toBe('system');
    expect(() => writeThemeMode(null, 'dark')).not.toThrow();
  });
});
