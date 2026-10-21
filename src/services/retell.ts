import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, increment, query, where } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { Material, LanguagePattern } from '../types';
import { segmentMaterial, reviewRetellWithAi, RetellFeedback } from './gemini';
import { getMasteredCount } from '../utils/patternStage';
import { postponeMaintenance } from './maintenance';

export interface RetellSegment {
  title: string;
  sentenceIds: string[];
}

export interface MaterialSegments {
  segments: RetellSegment[];
  createdAt: number;
}

export interface RetellTargetPattern {
  id: string;
  text: string;
  meaningZh: string;
}

export interface RetellRecord {
  id: string;
  materialId: string;
  segmentIndex: number;
  segmentTitle: string;
  transcript: string;
  feedback: RetellFeedback;
  targetPatterns: RetellTargetPattern[];
  createdAt: number;
}

const userBase = (uid: string) => `artifacts/${appId}/users/${uid}`;

const activeSentencesOf = (material: Material) => material.sentences.filter(s => !s.deleted && (s.text || '').trim());

// 分段結果是否仍適用：每段的句子都還存在且未刪除，且涵蓋全部未刪除句子
export function isSegmentsValid(material: Material, data: MaterialSegments | null): boolean {
  if (!data || !Array.isArray(data.segments) || data.segments.length === 0) return false;
  const activeIds = activeSentencesOf(material).map(s => s.id);
  const covered = data.segments.reduce<string[]>((acc, seg) => acc.concat(seg.sentenceIds || []), []);
  return covered.length === activeIds.length && covered.every((id, i) => id === activeIds[i]);
}

// 由 AI 依主題分段並存檔；AI 失敗時改為每 8 句一段
export async function createSegments(material: Material): Promise<MaterialSegments> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  const active = activeSentencesOf(material);
  let segments: RetellSegment[] = [];
  try {
    const result = await segmentMaterial(active.map(s => s.text.slice(0, 1000)));
    segments = result.map(seg => ({
      title: seg.title,
      sentenceIds: active.slice(seg.start, seg.end + 1).map(s => s.id)
    }));
  } catch (err) {
    console.warn('[複述] AI 分段失敗，改為每 8 句一段:', err);
  }
  if (segments.length === 0 || segments.reduce((n, seg) => n + seg.sentenceIds.length, 0) !== active.length) {
    segments = [];
    for (let i = 0; i < active.length; i += 8) {
      segments.push({ title: `第 ${segments.length + 1} 段`, sentenceIds: active.slice(i, i + 8).map(s => s.id) });
    }
  }
  const data: MaterialSegments = { segments, createdAt: Date.now() };
  await setDoc(doc(db, `${userBase(uid)}/materialSegments`, material.id), data);
  return data;
}

// 挑選提示句型：這份教材萃取出的句型＋這一段重逢到的句型；優先在本段出現、已達「可用」、還沒自發使用過的；最多 3 個
export async function pickTargetPatterns(
  material: Material,
  segment: RetellSegment,
  bySentence: Record<string, string[]> | undefined
): Promise<RetellTargetPattern[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const patternsRef = collection(db, `${userBase(uid)}/languagePatterns`);
  const candidates = new Map<string, { pattern: LanguagePattern; inSegment: boolean }>();

  const sourceSnap = await getDocs(query(patternsRef, where('sourceMaterialId', '==', material.id)));
  for (const d of sourceSnap.docs) {
    const p = { ...(d.data() as LanguagePattern), id: d.id };
    candidates.set(d.id, { pattern: p, inSegment: !!p.sourceSentenceId && segment.sentenceIds.includes(p.sourceSentenceId) });
  }

  const sightedIds = Array.from(new Set(segment.sentenceIds.reduce<string[]>((acc, sid) => acc.concat(bySentence?.[sid] || []), [])));
  for (const pid of sightedIds) {
    const existing = candidates.get(pid);
    if (existing) {
      existing.inSegment = true;
      continue;
    }
    const snap = await getDoc(doc(patternsRef, pid)).catch(() => null);
    if (snap && snap.exists()) {
      candidates.set(pid, { pattern: { ...(snap.data() as LanguagePattern), id: pid }, inSegment: true });
    }
  }

  const score = (c: { pattern: LanguagePattern; inSegment: boolean }) =>
    (c.inSegment ? 4 : 0) + (getMasteredCount(c.pattern) >= 10 ? 2 : 0) + (((c.pattern as any).spontaneousUseCount || 0) === 0 ? 1 : 0);

  return Array.from(candidates.values())
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
    .map(c => ({ id: c.pattern.id, text: (c.pattern.text || '').slice(0, 300), meaningZh: (c.pattern.meaningZh || '').slice(0, 500) }));
}

export async function reviewRetell(segmentText: string, transcript: string, targetPatterns: RetellTargetPattern[]): Promise<RetellFeedback> {
  return reviewRetellWithAi(segmentText.slice(0, 8000), transcript.slice(0, 5000), targetPatterns);
}

// 存下這次複述；用對的句型記一次「自發使用」
export async function saveRetell(record: Omit<RetellRecord, 'id'>): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('請先登入');
  await addDoc(collection(db, `${userBase(uid)}/retells`), record);
  const now = Date.now();
  for (const usage of record.feedback.patternUsage || []) {
    if (usage.status !== 'correct') continue;
    try {
      await updateDoc(doc(db, `${userBase(uid)}/languagePatterns`, usage.id), {
        spontaneousUseCount: increment(1),
        lastSpontaneousUseAt: now
      });
      await postponeMaintenance(usage.id);
    } catch (err) {
      console.warn('[複述] 記錄自發使用失敗:', err);
    }
  }
}

export async function listRetells(materialId: string): Promise<RetellRecord[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, `${userBase(uid)}/retells`), where('materialId', '==', materialId)));
  return snap.docs
    .map(d => ({ ...(d.data() as Omit<RetellRecord, 'id'>), id: d.id }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
