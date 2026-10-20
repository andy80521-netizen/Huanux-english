import { doc, getDoc, setDoc, updateDoc, deleteDoc, increment } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { getSydneyDateString } from '../utils/sydneyTime';

export interface MaterialSightings {
  status?: 'processing' | 'done' | 'error';
  bySentence?: Record<string, string[]>;
  checkedAt?: number;
  requestedAt?: number;
  error?: string;
}

const userBase = (uid: string) => `artifacts/${appId}/users/${uid}`;

// 請後端比對這份教材含有哪些已學句型（背景執行，不等待結果）
export async function requestSightingDetection(materialId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, `${userBase(user.uid)}/materialSightings`, materialId);
  try {
    await setDoc(ref, { status: 'processing', requestedAt: Date.now(), error: '' }, { merge: true });
    const idToken = await user.getIdToken();
    const res = await fetch('/.netlify/functions/detect-sightings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, materialId })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err: any) {
    console.error('[重逢] 送出比對請求失敗:', err);
    try {
      await setDoc(ref, { status: 'error', error: err?.message || '送出比對請求失敗' }, { merge: true });
    } catch {}
  }
}

// 跟讀含已學句型的句子拿到 70 分以上時呼叫：每句每個雪梨日最多記一次
export async function recordActiveSighting(materialId: string, sentenceId: string, patternIds: string[]): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || patternIds.length === 0) return;
  const today = getSydneyDateString();
  for (const pid of patternIds) {
    try {
      const ref = doc(db, `${userBase(uid)}/languagePatterns/${pid}/sightings`, `${materialId}_${sentenceId}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const last = snap.data().lastActiveAt;
      if (typeof last === 'number' && getSydneyDateString(last) === today) continue;
      await updateDoc(ref, { activeCount: increment(1), lastActiveAt: Date.now() });
    } catch (err) {
      console.warn('[重逢] 記錄親口念過失敗:', err);
    }
  }
}

// 刪除教材時呼叫：刪掉這份教材的比對結果，以及各句型中對應的重逢紀錄
export async function deleteMaterialSightings(materialId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    const ref = doc(db, `${userBase(uid)}/materialSightings`, materialId);
    const snap = await getDoc(ref);
    const bySentence: Record<string, string[]> = snap.exists() ? (snap.data().bySentence || {}) : {};
    for (const [sentenceId, pids] of Object.entries(bySentence)) {
      for (const pid of Array.isArray(pids) ? pids : []) {
        await deleteDoc(doc(db, `${userBase(uid)}/languagePatterns/${pid}/sightings`, `${materialId}_${sentenceId}`)).catch(() => {});
      }
    }
    if (snap.exists()) await deleteDoc(ref);
  } catch (err) {
    console.warn('[重逢] 刪除教材的重逢紀錄失敗:', err);
  }
}
