import { describe, expect, it } from 'vitest';
import {
  addSydneyCalendarDays,
  getSydneyCalendarDaysDiff,
  getSydneyDateString,
  isSydneyDateReached,
} from '../src/utils/sydneyTime';

// 2026-10-24 13:30 UTC = 2026-10-25 00:30 雪梨（夏令時間 UTC+11）
const AFTER_MIDNIGHT_SYD = Date.UTC(2026, 9, 24, 13, 30);
// 2026-10-24 12:30 UTC = 2026-10-24 23:30 雪梨
const BEFORE_MIDNIGHT_SYD = Date.UTC(2026, 9, 24, 12, 30);

describe('getSydneyDateString', () => {
  it('依雪梨時區換日，不是 UTC', () => {
    expect(getSydneyDateString(AFTER_MIDNIGHT_SYD)).toBe('2026-10-25');
    expect(getSydneyDateString(BEFORE_MIDNIGHT_SYD)).toBe('2026-10-24');
  });
});

describe('getSydneyCalendarDaysDiff', () => {
  it('跨過雪梨午夜只差一小時也算差 1 天', () => {
    expect(getSydneyCalendarDaysDiff(BEFORE_MIDNIGHT_SYD, AFTER_MIDNIGHT_SYD)).toBe(1);
  });

  it('跨越日光節約時間開始（2026-10-04）仍是整數天', () => {
    const before = Date.UTC(2026, 9, 2, 2, 0);
    const after = Date.UTC(2026, 9, 6, 2, 0);
    expect(getSydneyCalendarDaysDiff(before, after)).toBe(4);
  });
});

describe('addSydneyCalendarDays', () => {
  it('加 N 天後落在正確的雪梨日期', () => {
    expect(getSydneyDateString(addSydneyCalendarDays(AFTER_MIDNIGHT_SYD, 7))).toBe('2026-11-01');
    expect(getSydneyDateString(addSydneyCalendarDays(AFTER_MIDNIGHT_SYD, 0))).toBe('2026-10-25');
  });
});

describe('isSydneyDateReached', () => {
  it('同一個雪梨日期即算到達', () => {
    expect(isSydneyDateReached(AFTER_MIDNIGHT_SYD, AFTER_MIDNIGHT_SYD + 3600_000)).toBe(true);
  });

  it('目標日期在明天時尚未到達', () => {
    expect(isSydneyDateReached(AFTER_MIDNIGHT_SYD, BEFORE_MIDNIGHT_SYD)).toBe(false);
  });
});
