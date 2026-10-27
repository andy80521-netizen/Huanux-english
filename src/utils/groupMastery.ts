import type { PatternExampleSentence } from '../types';

// 組別 10 格熟練度（UI 改版 ③a）：今日複習的小長條與「本組練習完成」的大長條共用。
// 只做顯示用的計算，不改任何熟練度規則。

export const GROUP_SIZE = 10;
const MASTERY_MAX = 1000;

export interface GroupMasteryBar {
  /** 對應句子 id：p_<組>_<i>（與 GroupDetailView、造句寫入相同的編號規則） */
  id: string;
  /** 該句存在且已通過造句檢查（checked） */
  created: boolean;
  /** 目前熟練度，夾在 0～1000；未造句為 0 */
  mastery: number;
  /** 這次增加量：只有傳入起始值的句子才計算，且不為負 */
  gain: number;
  /** 熟練度已滿 1000 */
  mastered: boolean;
}

const clamp = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(MASTERY_MAX, Math.max(0, n));
};

/**
 * @param sentences      句型的 exampleSentences（可為 undefined）
 * @param groupIndex     組別（0 起算）
 * @param startMastery   句子 id → 練習開始時的熟練度；沒有起始值的句子 gain 為 0
 * @param currentOverride 句子 id → 練習期間記下的最新熟練度（優先於資料中的值，避免監聽延遲）
 */
export function groupMasteryBars(
  sentences: PatternExampleSentence[] | undefined | null,
  groupIndex: number,
  startMastery?: Record<string, number>,
  currentOverride?: Record<string, number>,
): GroupMasteryBar[] {
  const byId = new Map<string, PatternExampleSentence>();
  for (const s of sentences || []) {
    if (s && typeof s.id === 'string') byId.set(s.id, s);
  }

  return Array.from({ length: GROUP_SIZE }, (_, i) => {
    const id = `p_${groupIndex}_${i}`;
    const s = byId.get(id);
    const created = !!s && s.checked === true;
    if (!created) return { id, created: false, mastery: 0, gain: 0, mastered: false };

    const override = currentOverride?.[id];
    const mastery = clamp(override !== undefined ? override : s!.mastery);
    const start = startMastery?.[id];
    const gain = start !== undefined ? Math.max(0, mastery - clamp(start)) : 0;
    return { id, created: true, mastery, gain, mastered: mastery >= MASTERY_MAX };
  });
}

// ── ③b：句型的 10×10 熟練度地圖 ──────────────────────────────

/** 10 組 × 10 格；第 g 列是 groupMasteryBars(sentences, g) */
export function patternMasteryMap(sentences: PatternExampleSentence[] | undefined | null): GroupMasteryBar[][] {
  return Array.from({ length: GROUP_SIZE }, (_, g) => groupMasteryBars(sentences, g));
}

/** 每組已精熟句數（0～10），由地圖推出，與地圖用同一套編號規則 */
export function groupMasteredCounts(sentences: PatternExampleSentence[] | undefined | null): number[] {
  return patternMasteryMap(sentences).map((row) => row.filter((c) => c.mastered).length);
}

/** 地圖格子深淺：0＝0、1＝1～399、2＝400～699、3＝700～999、4＝1000（只給畫面用） */
export function masteryLevel(mastery: number): 0 | 1 | 2 | 3 | 4 {
  const m = clamp(mastery);
  if (m >= MASTERY_MAX) return 4;
  if (m >= 700) return 3;
  if (m >= 400) return 2;
  if (m > 0) return 1;
  return 0;
}
