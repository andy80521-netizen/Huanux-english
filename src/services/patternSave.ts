import { collection, doc, getDocs, setDoc, updateDoc, arrayUnion, query, where } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { LanguagePattern } from '../types';
import { classifyPatterns, PatternRelation } from './gemini';

type PatternCandidate = Omit<LanguagePattern, 'id' | 'sourceMaterialId' | 'sourceLabel' | 'exampleSentences' | 'unlockedGroups'>;

export interface SavePatternsResult {
  created: number;
  duplicates: { text: string; matchText: string }[];
  related: number;
}

// 判斷句型是不是從某一句萃取出來的（新句型看 sourceSentenceId；舊句型看「同教材＋句子開頭等於 sourceLabel」，與 detect-sightings 相同）
export function isPatternFromSentence(
  p: Pick<LanguagePattern, 'sourceMaterialId' | 'sourceSentenceId' | 'sourceLabel'>,
  materialId: string | undefined,
  sentence: { id?: string; text?: string }
): boolean {
  if (!materialId || p.sourceMaterialId !== materialId) return false;
  if (p.sourceSentenceId) return !!sentence.id && p.sourceSentenceId === sentence.id;
  const prefix = String(p.sourceLabel || '').replace(/\.\.\.$/, '');
  return !!prefix && String(sentence.text || '').startsWith(prefix);
}

// 找出某一句已經萃取出的句型（重新萃取前使用）
export async function listPatternsFromSentence(materialId: string, sentence: { id: string; text: string }): Promise<LanguagePattern[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, `artifacts/${appId}/users/${uid}/languagePatterns`), where('sourceMaterialId', '==', materialId)));
  return snap.docs
    .map(d => ({ ...(d.data() as LanguagePattern), id: d.id }))
    .filter(p => isPatternFromSentence(p, materialId, sentence));
}

// 萃取後存檔：先與既有句型比對，重複的不建立（改把來源例句加進既有句型），變體／近義建立並互相記錄關係
export async function savePatternsWithDedup(
  candidates: PatternCandidate[],
  meta: { sourceMaterialId?: string; sourceSentenceId?: string; sourceLabel: string; sourceExample?: { en: string; zh: string } }
): Promise<SavePatternsResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  const patternsRef = collection(db, `artifacts/${appId}/users/${uid}/languagePatterns`);

  const snap = await getDocs(patternsRef);
  const existing = snap.docs.map(d => ({ ...(d.data() as LanguagePattern), id: d.id }));
  const existingById = new Map(existing.map(p => [p.id, p]));

  let relations: PatternRelation[] = candidates.map((_, i) => ({ index: i, relation: 'new' }));
  if (candidates.length > 0 && (existing.length > 0 || candidates.length > 1)) {
    try {
      relations = await classifyPatterns(
        candidates.map(c => ({ text: (c.text || '').slice(0, 300), meaningZh: (c.meaningZh || '').slice(0, 500) })),
        existing.map(p => ({ id: p.id, text: (p.text || '').slice(0, 300), meaningZh: (p.meaningZh || '').slice(0, 500) }))
      );
    } catch (err) {
      console.warn('[萃取] 句型比對失敗，全部照常存檔:', err);
    }
  }

  const result: SavePatternsResult = { created: 0, duplicates: [], related: 0 };

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let r: PatternRelation = relations.find(x => x.index === i) || { index: i, relation: 'new' };

    // 重新萃取同一句時：對到「來源就是這一句」的既有句型的變體，視為重複（避免同一句產生重疊的句型）
    if (r.relation === 'variant' && r.matchId) {
      const target = existingById.get(r.matchId);
      if (target && isPatternFromSentence(target, meta.sourceMaterialId, { id: meta.sourceSentenceId, text: meta.sourceExample?.en })) {
        r = { ...r, relation: 'duplicate' };
      }
    }

    if (r.relation === 'duplicate') {
      const target = r.matchId ? existingById.get(r.matchId) : undefined;
      if (target) {
        const example = meta.sourceExample || c.seedExamples?.[0];
        const exampleEn = (example?.en || '').trim();
        const alreadyHas = (target.seedExamples || []).some(e => (e.en || '').trim().toLowerCase() === exampleEn.toLowerCase());
        if (exampleEn && !alreadyHas) {
          await updateDoc(doc(patternsRef, target.id), {
            seedExamples: arrayUnion({ en: exampleEn, zh: example?.zh || '' })
          });
        }
        result.duplicates.push({ text: c.text, matchText: target.text });
      } else {
        const m = r.matchCandidateIndex;
        result.duplicates.push({ text: c.text, matchText: m !== undefined && candidates[m] ? candidates[m].text : '' });
      }
      continue;
    }

    const newRef = doc(patternsRef);
    const relatedTarget = (r.relation === 'variant' || r.relation === 'synonym') && r.matchId ? existingById.get(r.matchId) : undefined;
    await setDoc(newRef, {
      ...c,
      id: newRef.id,
      ...(meta.sourceMaterialId ? { sourceMaterialId: meta.sourceMaterialId } : {}),
      ...(meta.sourceSentenceId ? { sourceSentenceId: meta.sourceSentenceId } : {}),
      sourceLabel: meta.sourceLabel,
      exampleSentences: [],
      unlockedGroups: 0,
      ...(relatedTarget ? { related: [{ id: relatedTarget.id, type: r.relation }] } : {})
    });
    if (relatedTarget) {
      await updateDoc(doc(patternsRef, relatedTarget.id), {
        related: arrayUnion({ id: newRef.id, type: r.relation })
      });
      result.related++;
    }
    result.created++;
  }

  return result;
}

export function formatSaveResult(r: SavePatternsResult): string {
  if (r.created === 0 && r.duplicates.length === 0) {
    return '這次沒有找到值得萃取的句型';
  }
  const parts = [`新增 ${r.created} 個句型`];
  if (r.duplicates.length > 0) {
    const names = r.duplicates.map(d => `「${d.matchText || d.text}」`).join('、');
    parts.push(`${r.duplicates.length} 個與既有句型重複已略過（${names}）`);
  }
  if (r.related > 0) {
    parts.push(`${r.related} 個已標記為相關句型`);
  }
  return parts.join('；');
}
