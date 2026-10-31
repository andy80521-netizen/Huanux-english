import { doc, runTransaction } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { generatePracticeCue, checkPracticeCue } from './gemini';
import { prefetchSpeech } from './speech';
import { PatternExampleSentence } from '../types';
import { createVerifiedCue, applyCueToSentence, englishCueUsable, PracticeCue } from '../utils/practiceCue';

// 產生並儲存練習題目（v2：中文情境＋完整中文意思），取代舊版題目
// 規劃：docs/plans/practice-prompt-design.md
export async function generateAndSavePracticeCue(
  patternId: string,
  sentenceId: string,
  sentenceText: string,
  patternText: string
): Promise<PracticeCue & { cueVerified: boolean }> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('請先登入');
  }

  const verified = await createVerifiedCue({
    sentenceText,
    generate: async () => {
      const c = await generatePracticeCue(sentenceText, patternText);
      if (!c || typeof c.situationZh !== 'string' || typeof c.meaningZh !== 'string' || !c.meaningZh.trim()) {
        throw new Error('產生的題目格式不正確，請再試一次');
      }
      return { situationZh: c.situationZh, meaningZh: c.meaningZh, partnerLineZh: c.partnerLineZh || '', partnerLineEn: c.partnerLineEn || '', meaningEn: c.meaningEn || '' };
    },
    check: (c) => checkPracticeCue({ situationZh: c.situationZh, partnerLineZh: c.partnerLineZh || undefined, meaningZh: c.meaningZh }, patternText),
  });
  // 英文題目（熟練度 500 以上用）太接近原句或用了句型時不存，改用中文題目
  const cue = englishCueUsable(verified, sentenceText, patternText)
    ? verified
    : { situationZh: verified.situationZh, meaningZh: verified.meaningZh, partnerLineZh: verified.partnerLineZh, cueVerified: verified.cueVerified };

  const patternRef = doc(db, `artifacts/${appId}/users/${uid}/languagePatterns/${patternId}`);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(patternRef);
    if (!snap.exists()) {
      throw new Error('找不到這個句型');
    }

    const data = snap.data();
    const sentences: PatternExampleSentence[] = data?.exampleSentences || [];
    const target = sentences.find((s) => s.id === sentenceId);
    if (!target) {
      throw new Error('找不到這個句子');
    }

    if (target.text !== sentenceText) {
      throw new Error('句子內容已變更，請重新進入練習');
    }

    const updatedSentences = sentences.map((s) => (s.id === sentenceId ? applyCueToSentence(s, cue) : s));
    tx.update(patternRef, { exampleSentences: updatedSentences });
  });

  // 題目存好後，背景預先產生題目與答案原句的語音
  void prefetchSpeech([cue.partnerLineZh || '', cue.meaningZh, cue.partnerLineEn || '', cue.meaningEn || '', sentenceText]);

  return cue;
}
