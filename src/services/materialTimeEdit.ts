import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db, auth, appId } from '../firebase';
import { MaterialSentence } from '../types';
import { applySentenceTime, restoreSentenceTime } from '../utils/timeEdit';

// 已存教材修正一句的時間（擁有者 2026-11-08 決定）
// 規劃：docs/plans/import-timestamp-accuracy.md（PR-G）
// - 交易內讀最新的句子陣列、只改那一句：同時進行的跟讀寫入（熟練度、分數）不會被蓋掉
// - 第一次修改另存原始時間（applySentenceTime），可「還原原始時間」
// - 句型「在教材中出現」的重逢紀錄存有時間副本，一併更新（失敗不影響教材本身）

const userBase = (uid: string) => `artifacts/${appId}/users/${uid}`;

async function writeSentences(
    materialId: string,
    sentenceId: string,
    mutate: (sentences: MaterialSentence[]) => MaterialSentence[] | null,
): Promise<MaterialSentence> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入');
    const ref = doc(db, `${userBase(uid)}/materials`, materialId);
    const updated = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('找不到這份教材');
        const sentences: MaterialSentence[] = snap.data().sentences || [];
        const next = mutate(sentences);
        if (!next) throw new Error('時間不正確或找不到這一句，未儲存');
        tx.update(ref, { sentences: next });
        return next.find(s => s.id === sentenceId) as MaterialSentence;
    });
    await syncSightingTimes(uid, materialId, sentenceId, updated.startTime, updated.endTime);
    return updated;
}

/** 儲存一句的新時間 */
export function saveSentenceTime(materialId: string, sentenceId: string, startTime: number, endTime: number): Promise<MaterialSentence> {
    return writeSentences(materialId, sentenceId, (list) => applySentenceTime(list, sentenceId, startTime, endTime));
}

/** 還原一句的原始時間 */
export function restoreOriginalSentenceTime(materialId: string, sentenceId: string): Promise<MaterialSentence> {
    return writeSentences(materialId, sentenceId, (list) => restoreSentenceTime(list, sentenceId));
}

/** 更新各句型重逢紀錄裡這一句的時間副本；紀錄不存在或寫入失敗只記 log */
async function syncSightingTimes(uid: string, materialId: string, sentenceId: string, startTime: number, endTime: number): Promise<void> {
    try {
        const snap = await getDoc(doc(db, `${userBase(uid)}/materialSightings`, materialId));
        const pids = snap.exists() ? snap.data().bySentence?.[sentenceId] : null;
        for (const pid of Array.isArray(pids) ? pids : []) {
            await updateDoc(doc(db, `${userBase(uid)}/languagePatterns/${pid}/sightings`, `${materialId}_${sentenceId}`), { startTime, endTime })
                .catch((err) => console.warn('[時間修正] 更新重逢紀錄的時間失敗:', err));
        }
    } catch (err) {
        console.warn('[時間修正] 讀取重逢比對結果失敗:', err);
    }
}
