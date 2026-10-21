import { doc, runTransaction } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { generatePracticePrompts } from './gemini';
import { prefetchSpeech } from './speech';
import { PatternExampleSentence } from '../types';

export async function generateAndSavePracticePrompts(
  patternId: string,
  sentenceId: string,
  sentenceText: string,
  patternText: string
): Promise<{ qaQuestion: string; situationalPrompt: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('請先登入');
  }

  const prompts = await generatePracticePrompts(sentenceText, patternText);

  if (
    !prompts ||
    typeof prompts.qaQuestion !== 'string' ||
    typeof prompts.situationalPrompt !== 'string' ||
    prompts.qaQuestion.trim() === '' ||
    prompts.situationalPrompt.trim() === ''
  ) {
    throw new Error('產生的題目格式不正確，請再試一次');
  }

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

    const updatedSentences = sentences.map((s) =>
      s.id === sentenceId
        ? {
            ...s,
            qaQuestion: prompts.qaQuestion,
            situationalPrompt: prompts.situationalPrompt
          }
        : s
    );

    tx.update(patternRef, { exampleSentences: updatedSentences });
  });

  // 題目存好後，背景預先產生兩種題目與答案原句的語音
  void prefetchSpeech([prompts.qaQuestion, prompts.situationalPrompt, sentenceText]);

  return prompts;
}
