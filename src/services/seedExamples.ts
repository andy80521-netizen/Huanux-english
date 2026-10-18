import { doc, updateDoc } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { regenerateSeedExamples } from './gemini';
import { LanguagePattern } from '../types';

export async function regenerateAndSaveSeedExamples(pattern: LanguagePattern): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('請先登入');
  }

  const avoidSentences = [
    ...(pattern.seedExamples || []).map(e => e.en),
    ...(pattern.exampleSentences || []).map(s => s.text)
  ]
    .map(s => (s || '').trim())
    .filter(Boolean);

  const examples = await regenerateSeedExamples(
    { text: pattern.text, meaningZh: pattern.meaningZh, usageContext: pattern.usageContext, category: pattern.category },
    avoidSentences
  );

  await updateDoc(doc(db, `artifacts/${appId}/users/${uid}/languagePatterns`, pattern.id), { seedExamples: examples });
}
