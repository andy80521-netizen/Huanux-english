import { doc, runTransaction } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { LanguagePattern, PatternExampleSentence } from '../types';
import { getMasteredCount } from '../utils/patternStage';
import { addSydneyCalendarDays, getSydneyDateString, isSydneyDateReached } from '../utils/sydneyTime';

export const MAINTENANCE_SIZE = 3;       // 每次維持題抽 3 句
export const MAINTENANCE_PASS_COUNT = 2; // 3 句中至少 2 句全對才算通過（v3.11 起以一字不差判斷）
const START_MASTERED = 10;               // 精熟 10 句（達到「可用」）後開始維持複習
const POSTPONE_DAYS = 30;
const FAILED_MASTERY = 750;

export interface MaintenanceOutcome {
  passed: boolean;
  passCount: number;
  failedCount: number;
  level: number;
  dueAt: number;
}

// 通過後的新 level 對應下次間隔：0 → 30 天、1 → 90 天、2 以上 → 180 天
export function maintenanceIntervalDays(level: number): number {
  if (level <= 0) return 30;
  if (level === 1) return 90;
  return 180;
}

const patternDocRef = (uid: string, patternId: string) =>
  doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, patternId);

// 已達「可用」但還沒有維持複習排程
export function needsMaintenanceInit(p: LanguagePattern): boolean {
  return !p.maintenance && getMasteredCount(p) >= START_MASTERED;
}

// 今天要做維持題：已到期，而且至少還有 3 句精熟句可以抽
export function isMaintenanceDue(p: LanguagePattern, now: number = Date.now()): boolean {
  return !!p.maintenance && isSydneyDateReached(p.maintenance.dueAt, now) && getMasteredCount(p) >= MAINTENANCE_SIZE;
}

// 開始維持複習：30 個雪梨日後第一次到期（交易內再確認一次，避免重複設定）
export async function initMaintenance(patternId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = patternDocRef(uid, patternId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as LanguagePattern;
    if (data.maintenance || getMasteredCount(data) < START_MASTERED) return;
    tx.update(ref, { maintenance: { level: 0, dueAt: addSydneyCalendarDays(Date.now(), maintenanceIntervalDays(0)) } });
  });
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 從已精熟句子中依「句子 id＋當天日期」固定抽 3 句（同一天重新進入抽到同一組）
export function pickMaintenanceSentences(p: LanguagePattern, now: number = Date.now()): PatternExampleSentence[] {
  const today = getSydneyDateString(now);
  return (p.exampleSentences || [])
    .filter(s => s.checked && (s.mastery || 0) >= 1000)
    .map(s => ({ s, h: hashString(`${s.id}|${today}`) }))
    .sort((a, b) => a.h - b.h || a.s.id.localeCompare(b.s.id))
    .slice(0, MAINTENANCE_SIZE)
    .map(x => x.s);
}

// 套用維持題結果：results 為每句（最後一次錄音）是否一字不差。
// 已經不是到期狀態（做過了或被延後）時不重複套用，回傳 null。
export async function applyMaintenanceResult(patternId: string, results: Record<string, boolean>): Promise<MaintenanceOutcome | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  const ref = patternDocRef(uid, patternId);
  const now = Date.now();
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as LanguagePattern;
    const m = data.maintenance;
    if (!m || !isSydneyDateReached(m.dueAt, now)) return null;

    const ids = Object.keys(results);
    const passCount = ids.filter(id => results[id]).length;
    const failedIds = new Set(ids.filter(id => !results[id]));
    const passed = passCount >= MAINTENANCE_PASS_COUNT;
    const level = passed ? (m.level || 0) + 1 : 0;
    const dueAt = addSydneyCalendarDays(now, maintenanceIntervalDays(level));

    // 沒有全對的句子：熟練度降為 750、移除等待時間，立即回到一般複習
    const sentences = (data.exampleSentences || []).map(s => {
      if (!failedIds.has(s.id)) return s;
      const { nextAvailableAt, ...rest } = s;
      return { ...rest, mastery: FAILED_MASTERY };
    });

    tx.update(ref, {
      maintenance: { level, dueAt, lastReviewedAt: now },
      exampleSentences: sentences
    });
    return { passed, passCount, failedCount: failedIds.size, level, dueAt };
  });
}

// 主動重逢（跟讀念過）或複述中用對時呼叫：到期日延到至少 30 天後
export async function postponeMaintenance(patternId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ref = patternDocRef(uid, patternId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const m = (snap.data() as LanguagePattern).maintenance;
      if (!m) return;
      const target = addSydneyCalendarDays(Date.now(), POSTPONE_DAYS);
      if (m.dueAt >= target) return;
      tx.update(ref, { 'maintenance.dueAt': target });
    });
  } catch (err) {
    console.warn('[維持複習] 延後失敗:', err);
  }
}
