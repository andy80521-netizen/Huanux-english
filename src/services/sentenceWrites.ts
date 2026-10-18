import { doc, runTransaction } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { PatternExampleSentence } from '../types';

// 注意：mutate 可能因 transaction 重試而被呼叫多次，mutate 不可有副作用
export async function updatePatternSentences(
  patternId: string,
  mutate: (sentences: PatternExampleSentence[]) => PatternExampleSentence[] | null
): Promise<PatternExampleSentence[] | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('請先登入');
  }

  const patternRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns/${patternId}`);

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(patternRef);
    if (!snap.exists()) {
      throw new Error('找不到這個句型');
    }

    const data = snap.data();
    const current: PatternExampleSentence[] = (data?.exampleSentences || []).map((s: PatternExampleSentence) => ({ ...s }));
    const next = mutate(current);

    if (next === null) {
      return null;
    }

    tx.update(patternRef, { exampleSentences: next });
    return next;
  });
}
