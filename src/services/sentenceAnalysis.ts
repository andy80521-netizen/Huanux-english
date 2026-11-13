// 句子全面解析：讀取、呼叫 AI、交易寫入、刪除教材時一併刪除
// 規劃：docs/plans/sentence-analysis.md（擁有者 2026-11-13 核准）；修正：docs/plans/review-fixes-50-51.md
import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { analyzeSentence } from './gemini';
import {
    SentenceAnalysisRecord, AnalysisInput, analysisDocId, decideAnalysisWrite, planMaterialDelete, sanitizeStoredAnalysis,
} from '../utils/sentenceAnalysis';

/** 前端最多等這麼久（後端 50 秒截止＋網路）；手機斷網時不會永遠卡在「解析中」（#4） */
export const ANALYSIS_CLIENT_TIMEOUT_MS = 65_000;
const MAX_SENTENCE_CHARS = 1000;

/** 可分類的錯誤（#6）：面板依 code 顯示對應提示 */
export class SentenceAnalysisError extends Error {
    constructor(public code: 'auth' | 'id' | 'tooLong' | 'timeout', message: string) {
        super(message);
        this.name = 'SentenceAnalysisError';
    }
}

const requireUid = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new SentenceAnalysisError('auth', '請先登入');
    return uid;
};
const docIdOf = (materialId: string, sentenceId: string) => {
    try {
        return analysisDocId(materialId, sentenceId);
    } catch {
        throw new SentenceAnalysisError('id', '教材或句子編號格式不正確');
    }
};
const analysisPath = (uid: string, materialId: string, sentenceId: string) =>
    `artifacts/${appId}/users/${uid}/sentenceAnalyses/${docIdOf(materialId, sentenceId)}`;
const materialPath = (uid: string, materialId: string) => `artifacts/${appId}/users/${uid}/materials/${materialId}`;

// 這次開啟 App 期間的記憶體快取；key 含 uid，同分頁換帳號不會讀到別人的（#8）
const memoryKey = (uid: string, materialId: string, sentenceId: string) => `${uid}__${materialId}__${sentenceId}`;
const keyFor = (materialId: string, sentenceId: string) => {
    const uid = auth.currentUser?.uid;
    return uid ? memoryKey(uid, materialId, sentenceId) : null;
};
/** 讀過或剛解析的結果（同一句在 idle 與結果頁兩處顯示時不再讀一次） */
const memory = new Map<string, SentenceAnalysisRecord>();

export type SaveResult = 'saved' | 'missing-material' | 'missing-sentence' | 'changed';
export type AnalyzeOutcome = { rec: SentenceAnalysisRecord; result: SaveResult | 'saveFailed' };
export type UnsavedResult = 'saveFailed' | 'missing-sentence' | 'changed';

/** AI 成功但沒存起來的結果（面板卸載也保留；審查第 1 輪 Codex）。教材已刪除不放進來（#9） */
const unsavedMemory = new Map<string, SentenceAnalysisRecord>();
/** 沒存起來的原因（#5；擁有者決定與結果分開存）：重新掛載後仍能顯示正確提示 */
const unsavedReasons = new Map<string, UnsavedResult>();
const rememberUnsaved = (key: string, rec: SentenceAnalysisRecord, result: UnsavedResult) => {
    unsavedMemory.set(key, rec);
    unsavedReasons.set(key, result);
};
const forgetUnsaved = (key: string) => {
    unsavedMemory.delete(key);
    unsavedReasons.delete(key);
};
/** 進行中的解析（同一句不重複送出；面板重新掛載時接回同一個請求） */
const inflight = new Map<string, Promise<AnalyzeOutcome>>();

export function unsavedSentenceAnalysis(materialId: string, sentenceId: string): { rec: SentenceAnalysisRecord; result: UnsavedResult } | null {
    const k = keyFor(materialId, sentenceId);
    const rec = k ? unsavedMemory.get(k) : undefined;
    return k && rec ? { rec, result: unsavedReasons.get(k) ?? 'saveFailed' } : null;
}

export function inflightSentenceAnalysis(materialId: string, sentenceId: string): Promise<AnalyzeOutcome> | null {
    const k = keyFor(materialId, sentenceId);
    return (k && inflight.get(k)) || null;
}

export function cachedSentenceAnalysis(materialId: string, sentenceId: string): SentenceAnalysisRecord | null {
    const k = keyFor(materialId, sentenceId);
    return (k && memory.get(k)) || null;
}

/** 記下或清掉未存結果（面板「再存一次」後同步） */
export function setUnsavedSentenceAnalysis(rec: SentenceAnalysisRecord, result: SaveResult | 'saveFailed'): void {
    const k = keyFor(rec.materialId, rec.sentenceId);
    if (!k) return;
    if (result === 'saved' || result === 'missing-material') forgetUnsaved(k);
    else rememberUnsaved(k, rec, result);
}

/** 呼叫 AI 並存檔；同一句進行中就回傳同一個請求。AI 失敗或逾時會丟出；存檔失敗回傳 saveFailed（結果保留） */
export function analyzeAndSaveSentence(
    materialId: string,
    sentenceId: string,
    input: AnalysisInput & { materialTitle: string },
): Promise<AnalyzeOutcome> {
    const uid = requireUid();
    docIdOf(materialId, sentenceId);
    if (input.text.length > MAX_SENTENCE_CHARS) return Promise.reject(new SentenceAnalysisError('tooLong', '這句太長，無法解析（上限 1000 字）'));
    const key = memoryKey(uid, materialId, sentenceId);
    const running = inflight.get(key);
    if (running) return running;
    const job = (async (): Promise<AnalyzeOutcome> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new SentenceAnalysisError('timeout', '解析逾時，請再試一次')), ANALYSIS_CLIENT_TIMEOUT_MS);
        });
        let rec: SentenceAnalysisRecord;
        try {
            rec = await Promise.race([requestSentenceAnalysis(materialId, sentenceId, input), timeout]);
        } finally {
            clearTimeout(timer);
        }
        try {
            const result = await saveSentenceAnalysis(rec);
            // 教材已刪除：不留下孤兒的未存結果（#9）；句子變了或刪了：記下原因（#5）
            if (result === 'missing-sentence' || result === 'changed') {
                unsavedMemory.set(key, rec);
                unsavedReasons.set(key, result);
            } else if (result === 'missing-material') forgetUnsaved(key);
            return { rec, result };
        } catch (e) {
            console.warn('[句子解析] 存檔失敗', e);
            unsavedMemory.set(key, rec);
            unsavedReasons.set(key, 'saveFailed');
            return { rec, result: 'saveFailed' };
        }
    })();
    inflight.set(key, job);
    // 只在紀錄仍是這個請求時才清（不會清掉之後的重試，Codex）
    const clear = () => { if (inflight.get(key) === job) inflight.delete(key); };
    job.then(clear, clear);
    return job;
}

/** 讀存好的解析；沒有或格式壞掉回傳 null（壞資料不寫回，讓使用者重新解析；#2） */
export async function loadSentenceAnalysis(materialId: string, sentenceId: string): Promise<SentenceAnalysisRecord | null> {
    const uid = requireUid();
    const key = memoryKey(uid, materialId, sentenceId);
    const hit = memory.get(key);
    if (hit) return hit;
    const snap = await getDoc(doc(db, analysisPath(uid, materialId, sentenceId)));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<SentenceAnalysisRecord> | undefined;
    const analysis = sanitizeStoredAnalysis(data?.analysis);
    if (!data || !analysis) return null;
    const rec: SentenceAnalysisRecord = {
        materialId,
        sentenceId,
        text: typeof data.text === 'string' ? data.text : '',
        translation: typeof data.translation === 'string' ? data.translation : '',
        prevText: typeof data.prevText === 'string' ? data.prevText : '',
        nextText: typeof data.nextText === 'string' ? data.nextText : '',
        version: Number(data.version) || 0,
        model: typeof data.model === 'string' ? data.model : '',
        createdAt: Number(data.createdAt) || 0,
        analysis,
    };
    memory.set(key, rec);
    return rec;
}

/** 呼叫 AI 產生解析（不存檔） */
export async function requestSentenceAnalysis(
    materialId: string,
    sentenceId: string,
    input: AnalysisInput & { materialTitle: string },
): Promise<SentenceAnalysisRecord> {
    const r = await analyzeSentence({
        sentenceText: input.text,
        sentenceTranslation: input.translation,
        materialTitle: input.materialTitle.slice(0, 300),
        prevText: input.prevText.slice(0, 1000),
        nextText: input.nextText.slice(0, 1000),
    });
    const analysis = sanitizeStoredAnalysis(r?.analysis);
    if (!analysis) throw new Error('解析結果格式不正確');
    return {
        materialId,
        sentenceId,
        text: input.text,
        translation: input.translation,
        prevText: input.prevText,
        nextText: input.nextText,
        version: r.version,
        model: r.model || '',
        createdAt: Date.now(),
        analysis,
    };
}

/**
 * 存檔：交易內讀教材，教材與句子仍在、原句沒變才寫入（擋住晚到寫入，Codex）。
 * 回傳 'saved' 或不寫入的原因；網路或權限錯誤會丟出（呼叫端顯示「沒有存起來」，再試一次只重存）
 */
export async function saveSentenceAnalysis(rec: SentenceAnalysisRecord): Promise<SaveResult> {
    const uid = requireUid();
    const materialRef = doc(db, materialPath(uid, rec.materialId));
    const analysisRef = doc(db, analysisPath(uid, rec.materialId, rec.sentenceId));
    const outcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(materialRef);
        const decision = decideAnalysisWrite(snap.exists() ? (snap.data() as any) : null, rec.sentenceId, rec.text);
        if (decision !== 'ok') return decision;
        tx.set(analysisRef, JSON.parse(JSON.stringify(rec)));   // 清掉 undefined（Firestore 不接受）
        return 'saved' as const;
    });
    const key = memoryKey(uid, rec.materialId, rec.sentenceId);
    if (outcome === 'saved') {
        memory.set(key, rec);
        forgetUnsaved(key);
    }
    return outcome;
}

/**
 * 刪除教材並一併刪除每句的解析（文件 ID 可由句子 ID 算出，不需查詢）。
 * 句數不多：同一筆交易（寫入解析的交易也讀教材，刪除會讓在途的寫入重試並放棄）；
 * 句數太多：教材刪除成功後再分批刪，清理失敗只記錄、不把教材刪除判成失敗
 */
export async function deleteMaterialWithAnalyses(materialId: string): Promise<void> {
    const uid = requireUid();
    const materialRef = doc(db, materialPath(uid, materialId));
    let leftovers: string[] = [];
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(materialRef);
        if (!snap.exists()) { leftovers = []; return; }
        const ids: string[] = ((snap.data() as any).sentences || []).map((s: any) => String(s?.id || ''));
        let plan: ReturnType<typeof planMaterialDelete>;
        try {
            plan = planMaterialDelete(materialId, ids);
        } catch {
            plan = { inTransaction: true, analysisIds: [] };   // 編號格式異常的舊教材：只刪教材
        }
        if (plan.inTransaction) {
            plan.analysisIds.forEach(id => tx.delete(doc(db, `artifacts/${appId}/users/${uid}/sentenceAnalyses/${id}`)));
            leftovers = [];
        } else {
            leftovers = plan.analysisIds;
        }
        tx.delete(materialRef);
    });
    const prefix = `${uid}__${materialId}__`;
    for (const m of [memory, unsavedMemory, unsavedReasons]) for (const key of [...m.keys()]) if (key.startsWith(prefix)) m.delete(key);
    if (leftovers.length === 0) return;
    try {
        for (let i = 0; i < leftovers.length; i += 400) {
            const batch = writeBatch(db);
            leftovers.slice(i, i + 400).forEach(id => batch.delete(doc(db, `artifacts/${appId}/users/${uid}/sentenceAnalyses/${id}`)));
            await batch.commit();
        }
    } catch (err) {
        console.error('[句子解析] 教材已刪除，但部分解析沒有刪掉（不影響使用）', leftovers.length, err);
    }
}
