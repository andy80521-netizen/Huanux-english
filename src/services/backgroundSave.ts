import { collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { auth, db, appId, storage } from '../firebase';
import type { CoverStyle } from '../types';
import type { ReviewSentence } from '../components/MaterialReviewPanel';
import { canStartSave, type SaveJobDoc } from '../utils/saveJob';

// 匯入教材交給伺服器背景存檔（前端：交接、重試、回到校對、放棄、監聽）
// 規劃：docs/plans/background-material-save.md（擁有者 2026-11-09 核准）

/** 等背景函式接受（202）的上限；不等翻譯完成 */
export const DISPATCH_TIMEOUT_MS = 10_000;
/** 任務文件大小上限（Firestore 1MiB，留安全空間） */
export const MAX_JOB_BYTES = 900_000;

export type SaveJob = SaveJobDoc & {
    id: string;
    audioUrl?: string;
    coverChoice?: CoverStyle | 'none';
    reviewed?: ReviewSentence[];
};

const userBase = (uid: string) => `artifacts/${appId}/users/${uid}`;
const jobRef = (uid: string, id: string) => doc(db, `${userBase(uid)}/transcriptionJobs`, id);
const requireUid = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入');
    return uid;
};

const LEASE_RESET = { leaseId: deleteField(), leaseUntil: deleteField(), heartbeatAt: deleteField(), errorMessage: deleteField() };

/** 呼叫背景函式並等它接受；沒叫到 → 把這次送出標成失敗（可重試），再丟錯 */
async function dispatchSave(uid: string, materialId: string, saveAttempt: number): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
    try {
        // 強制換新 Token：背景流程與後續封面、重逢都用這一顆（效期 1 小時）
        const idToken = await auth.currentUser!.getIdToken(true);
        const res = await fetch('/.netlify/functions/save-material', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, materialId, saveAttempt }),
            keepalive: true,
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
        console.warn('[背景存檔] 沒有叫到背景函式:', err?.message || err);
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(jobRef(uid, materialId));
            const d = snap.data();
            // 只在還沒有任何背景執行認領時才標失敗（避免蓋掉已經開始的執行）
            if (d && d.status === 'saving' && d.saveAttempt === saveAttempt && !d.leaseId) {
                tx.update(jobRef(uid, materialId), { status: 'saveError', errorMessage: '沒有叫到背景存檔，請重試' });
            }
        }).catch(() => { /* 忽略：提示會以「可能中斷了」顯示 */ });
        throw new Error('沒有成功交給伺服器儲存，請檢查網路後再按一次「確認儲存」');
    } finally {
        clearTimeout(timer);
    }
}

/** 校對完按「確認儲存」：寫入校對內容並交給伺服器（翻譯、建立教材、封面、重逢都在背景完成） */
export async function startBackgroundSave(p: {
    materialId: string;
    title: string;
    audioUrl: string;
    coverChoice: CoverStyle | 'none';
    reviewed: ReviewSentence[];
}): Promise<void> {
    const uid = requireUid();
    const reviewed = p.reviewed.map(s => ({
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(s.lowConfidence ? { lowConfidence: true } : {}),
        ...(s.needsReview ? { needsReview: true } : {}),
    }));
    if (new TextEncoder().encode(JSON.stringify(reviewed)).length * 2.2 > MAX_JOB_BYTES) {
        throw new Error('教材太長，超過資料庫單一文件的上限，請把音檔分段匯入');
    }
    const ref = jobRef(uid, p.materialId);
    const saveAttempt = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('找不到這次匯入的任務，請重新匯入');
        const d = snap.data();
        if (!canStartSave(d.status)) {
            throw new Error(d.status === 'saving' ? '這份教材已經在儲存中' : '這份教材目前無法儲存，請重新匯入');
        }
        const next = (typeof d.saveAttempt === 'number' ? d.saveAttempt : 0) + 1;
        tx.update(ref, {
            status: 'saving',
            saveAttempt: next,
            title: p.title,
            audioUrl: p.audioUrl,
            coverChoice: p.coverChoice,
            reviewed,
            progress: { done: 0, total: reviewed.length },
            saveRequestedAt: Date.now(),
            results: deleteField(),        // 原始轉錄結果不再需要，避免兩份全文超過文件上限
            translations: deleteField(),   // 校對內容可能改過，翻譯檢查點作廢
            ...LEASE_RESET,
        });
        return next;
    });
    await dispatchSave(uid, p.materialId, saveAttempt);
}

/** 重試／繼續：沿用校對內容與翻譯檢查點，讓舊執行失效後重新交給伺服器 */
export async function retryBackgroundSave(materialId: string): Promise<void> {
    const uid = requireUid();
    const ref = jobRef(uid, materialId);
    const saveAttempt = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data();
        if (!d || !(d.status === 'saveError' || d.status === 'paused' || d.status === 'saving')) {
            throw new Error('這份教材目前無法重試');
        }
        const next = (d.saveAttempt || 0) + 1;
        tx.update(ref, { status: 'saving', saveAttempt: next, saveRequestedAt: Date.now(), ...LEASE_RESET });
        return next;
    });
    await dispatchSave(uid, materialId, saveAttempt);
}

/** 回到校對：讓舊執行失效（attempt + 1）並取回校對內容 */
export async function reopenReview(materialId: string): Promise<{ title: string; audioUrl: string; coverChoice: CoverStyle | 'none'; reviewed: ReviewSentence[] }> {
    const uid = requireUid();
    const ref = jobRef(uid, materialId);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data();
        if (!d || d.status === 'saved') throw new Error('這份教材已經儲存好了');
        if (!Array.isArray(d.reviewed) || !d.audioUrl) throw new Error('找不到校對內容');
        tx.update(ref, { status: 'reviewing', saveAttempt: (d.saveAttempt || 0) + 1, ...LEASE_RESET });
        return { title: d.title || '教材', audioUrl: d.audioUrl, coverChoice: d.coverChoice || 'none', reviewed: d.reviewed };
    });
}

/**
 * 放棄：先讓舊執行失效，再確認教材不存在才刪音檔；教材已經建立 → 只清掉任務並回報已儲存
 */
export async function abandonBackgroundSave(materialId: string): Promise<'abandoned' | 'alreadySaved'> {
    const uid = requireUid();
    const ref = jobRef(uid, materialId);
    const st = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data();
        if (!d) return 'gone' as const;
        if (d.status === 'saved') return 'saved' as const;
        tx.update(ref, { status: 'abandoning', saveAttempt: (d.saveAttempt || 0) + 1, ...LEASE_RESET });
        return 'ok' as const;
    });
    const material = await getDoc(doc(db, `${userBase(uid)}/materials`, materialId));
    if (st === 'saved' || material.exists()) {
        await deleteDoc(ref).catch(() => {});
        return 'alreadySaved';
    }
    try {
        await deleteObject(ref_(uid, materialId));
    } catch (e) {
        console.warn('[背景存檔] 刪除音檔失敗或不存在:', e);
    }
    await deleteDoc(ref).catch(() => {});
    return 'abandoned';
}
const ref_ = (uid: string, materialId: string) => ref(storage, `${userBase(uid)}/materials/${materialId}.mp3`);

/** 已存好但任務文件沒刪掉（背景刪除失敗）時由前端清理 */
export async function clearSavedJob(materialId: string): Promise<void> {
    const uid = requireUid();
    await deleteDoc(jobRef(uid, materialId)).catch(() => {});
}

export async function materialExists(materialId: string): Promise<boolean> {
    const uid = requireUid();
    return (await getDoc(doc(db, `${userBase(uid)}/materials`, materialId))).exists();
}

/** 監聽需要顯示的背景存檔任務 */
export function subscribeSaveJobs(uid: string, cb: (jobs: SaveJob[]) => void): () => void {
    const q = query(
        collection(db, `${userBase(uid)}/transcriptionJobs`),
        where('status', 'in', ['saving', 'saveError', 'paused', 'reviewing', 'saved']),
    );
    return onSnapshot(q, (snap) => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as SaveJobDoc) }))), (err) => {
        console.warn('[背景存檔] 監聽任務失敗:', err);
    });
}
