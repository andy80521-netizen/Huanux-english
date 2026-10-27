import type { PatternExampleSentence } from '../types';
import { BADGE_TIERS, BadgeTier } from './badges';
import { GROUP_SIZE } from './groupMastery';

// 高光時刻（UI 改版 ⑤）：本組練習完成時，這個句型是否跨過勳章門檻、本組是否剛好整組精熟。只讀計算

export interface SessionHighlights {
  /** 這次跨過的最高門檻；沒跨過為 null。mastered＝練習後整個句型的精熟句數 */
  newTier: { tier: BadgeTier; mastered: number } | null;
  /** 本組 10 句練習後全部 1000，且練習前不是 */
  groupCompleted: boolean;
}

const MASTERED = 1000;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * @param sentences  句型的全部 exampleSentences
 * @param groupIndex 這次練習的組別（0 起算）
 * @param startById  句子 id → 練習開始時的熟練度（沒有的句子視為沒變）
 * @param afterById  句子 id → 這次真的寫入的熟練度（沒有的句子用目前值）
 */
export function sessionHighlights(
  sentences: PatternExampleSentence[] | undefined | null,
  groupIndex: number,
  startById: Record<string, number> = {},
  afterById: Record<string, number> = {},
): SessionHighlights {
  let before = 0;
  let after = 0;
  const groupBefore = new Map<string, boolean>();
  const groupAfter = new Map<string, boolean>();
  const prefix = `p_${groupIndex}_`;

  for (const s of sentences || []) {
    if (!s || s.checked !== true || typeof s.id !== 'string') continue;
    const current = num(s.mastery);
    const b = s.id in startById ? num(startById[s.id]) : current;
    const a = s.id in afterById ? num(afterById[s.id]) : current;
    if (b >= MASTERED) before++;
    if (a >= MASTERED) after++;
    if (s.id.startsWith(prefix)) {
      groupBefore.set(s.id, b >= MASTERED);
      groupAfter.set(s.id, a >= MASTERED);
    }
  }

  let newTier: SessionHighlights['newTier'] = null;
  for (const t of BADGE_TIERS) {
    if (before < t.target && after >= t.target) newTier = { tier: t.tier, mastered: after };
  }

  const full = (m: Map<string, boolean>) => m.size >= GROUP_SIZE && [...m.values()].every(Boolean);
  const groupCompleted = full(groupAfter) && !full(groupBefore);

  return { newTier, groupCompleted };
}
