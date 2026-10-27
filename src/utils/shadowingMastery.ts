import { isShadowingPass } from './scoring';
import { MASTERY_MAX } from './materialProgress';

/**
 * 跟讀評分後的新熟練度（v3.11 規則，與改版前的寫入完全相同）：
 * 內容 ≥ 70 且總分 ≥ 70 才累加，上限 1000；gain 是新舊值的差。
 * 評分時只算一次，寫入 Firestore 與畫面顯示都用這份結果。
 */
export function nextShadowingMastery<S extends { content: number; total: number }>(
  current: number,
  scores: S,
): { mastery: number; gain: number } {
  const base = Number.isFinite(current) ? current : 0;
  if (!isShadowingPass(scores)) return { mastery: base, gain: 0 };
  const mastery = Math.min(MASTERY_MAX, base + scores.total);
  return { mastery, gain: mastery - base };
}
