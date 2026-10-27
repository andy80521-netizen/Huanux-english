/** 熟練度達到這個值的句子算「畢業」 */
export const MASTERY_MAX = 1000;

type SentenceLike = { mastery?: number; deleted?: boolean };

/**
 * 教材進度：只算未刪除的句子；熟練度 ≥ 1000 算畢業。
 * 教材列表與詳情頁共用，確保兩邊數字一致。
 */
export function materialProgress(sentences: ReadonlyArray<SentenceLike> | null | undefined): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const s of sentences ?? []) {
    if (s.deleted) continue;
    total += 1;
    const m = Number.isFinite(s.mastery) ? (s.mastery as number) : 0;
    if (m >= MASTERY_MAX) completed += 1;
  }
  return { total, completed };
}
