// 維持複習的判斷邏輯（純函式，不碰 Firestore；由 services/maintenance.ts 在交易中呼叫）
import { LanguagePattern, PatternExampleSentence } from '../types';
import { addSydneyCalendarDays, isSydneyDateReached } from './sydneyTime';

export const MAINTENANCE_PASS_COUNT = 2; // 3 句中至少 2 句全對才算通過（v3.11 起以一字不差判斷）
export const FAILED_MASTERY = 750;       // 沒全對的句子降到這個熟練度，回到一般複習

// 通過後的新 level 對應下次間隔：0 → 30 天、1 → 90 天、2 以上 → 180 天
export function maintenanceIntervalDays(level: number): number {
  if (level <= 0) return 30;
  if (level === 1) return 90;
  return 180;
}

export interface MaintenanceComputation {
  passed: boolean;
  passCount: number;
  failedCount: number;
  level: number;
  dueAt: number;
  maintenance: { level: number; dueAt: number; lastReviewedAt: number };
  exampleSentences: PatternExampleSentence[];
}

// results：每句（最後一次錄音）是否一字不差。沒有維持排程或還沒到期時回傳 null（不重複套用）。
export function computeMaintenanceOutcome(
  data: LanguagePattern,
  results: Record<string, boolean>,
  now: number
): MaintenanceComputation | null {
  const m = data.maintenance;
  if (!m || !isSydneyDateReached(m.dueAt, now)) return null;

  const ids = Object.keys(results);
  const passCount = ids.filter(id => results[id]).length;
  const failedIds = new Set(ids.filter(id => !results[id]));
  const passed = passCount >= MAINTENANCE_PASS_COUNT;
  const level = passed ? (m.level || 0) + 1 : 0;
  const dueAt = addSydneyCalendarDays(now, maintenanceIntervalDays(level));

  // 沒有全對的句子：熟練度降為 750、移除等待時間，立即回到一般複習
  const exampleSentences = (data.exampleSentences || []).map(s => {
    if (!failedIds.has(s.id)) return s;
    const { nextAvailableAt, ...rest } = s;
    return { ...rest, mastery: FAILED_MASTERY } as PatternExampleSentence;
  });

  return {
    passed, passCount, failedCount: failedIds.size, level, dueAt,
    maintenance: { level, dueAt, lastReviewedAt: now },
    exampleSentences,
  };
}
