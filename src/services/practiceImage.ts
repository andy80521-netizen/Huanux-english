import { auth } from '../firebase';
import { updatePatternSentences } from './sentenceWrites';
import { PatternExampleSentence } from '../types';

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_PER_REQUEST = 10;

function needsImage(s: PatternExampleSentence, now: number): boolean {
  const text = (s.text || '').trim();
  if (!s.checked || !text || text.length > 500 || s.imageUrl) return false;
  if (s.imageRequestedAt && now - s.imageRequestedAt < RETRY_AFTER_MS) return false;
  return true;
}

// 幫指定句子送出產圖請求（背景執行，不等待結果）
export async function requestPracticeImages(patternId: string, sentenceIds: string[]): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user || sentenceIds.length === 0) return;

    const idSet = new Set(sentenceIds);
    const now = Date.now();
    let toRequest: { id: string; text: string }[] = [];

    // mutate 可能因 transaction 重試被呼叫多次；每次都重新計算 toRequest，以最後一次為準
    await updatePatternSentences(patternId, (sentences) => {
      toRequest = sentences
        .filter(s => idSet.has(s.id) && needsImage(s, now))
        .slice(0, MAX_PER_REQUEST)
        .map(s => ({ id: s.id, text: s.text.trim() }));
      if (toRequest.length === 0) return null;
      const markIds = new Set(toRequest.map(t => t.id));
      return sentences.map(s => (markIds.has(s.id) ? { ...s, imageRequestedAt: now } : s));
    });

    if (toRequest.length === 0) return;

    const idToken = await user.getIdToken();
    for (const item of toRequest) {
      fetch('/.netlify/functions/generate-practice-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, patternId, sentenceId: item.id, sentenceText: item.text })
      }).catch(err => console.error('[看圖題] 送出產圖請求失敗:', err));
    }
    console.log(`[看圖題] 已送出 ${toRequest.length} 句產圖請求`);
  } catch (err) {
    console.error('[看圖題] 產圖請求流程失敗:', err);
  }
}
