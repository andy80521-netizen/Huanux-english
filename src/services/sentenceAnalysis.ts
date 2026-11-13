// 句子全面解析：讀取、呼叫 AI、交易寫入、刪除教材時一併刪除
// 規劃：docs/plans/sentence-analysis.md（擁有者 2026-11-13 核准）
import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';
import { auth, db, appId } from '../firebase';
import { analyzeSentence } from './gemini';
import {
    SentenceAnalysisRecord, AnalysisInput, analysisDocId, decideAnalysisWrite, planMaterialDelete,
} from '../utils/sentenceAnalysis';

const requireUid = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入');
    return uid;
};
const analysisPath = (uid: string, materialId: string, sentenceId: string) =>
    `artifacts/${appId}/users/${uid}/sentenceAnalyses/${analysisDocId(materialId, sentenceId)}`;
const materialPath = (uid: string, materialId: string) => `artifacts/${appId}/users/${uid}/materials/${materialId}`;

/** 這次開啟 App 期間讀過或剛解析的結果（同一句在 idle 與結果頁兩處顯示時不再讀一次） */
const memory = new Map<string, SentenceAnalysisRecord>();
const memoryKey = (materialId: string, sentenceId: string) => `${materialId}__${sentenceId}`;

export function cachedSentenceAnalysis(materialId: string, sentenceId: string): SentenceAnalysisRecord | null {
    return memory.get(memoryKey(materialId, sentenceId)) ?? null;
}

/** 讀存好的解析；沒有回傳 null */
export async function loadSentenceAnalysis(materialId: string, sentenceId: string): Promise<SentenceAnalysisRecord | null> {
    const hit = memory.get(memoryKey(materialId, sentenceId));
    if (hit) return hit;
    const uid = requireUid();
    const snap = await getDoc(doc(db, analysisPath(uid, materialId, sentenceId)));
    if (!snap.exists()) return null;
    const rec = snap.data() as SentenceAnalysisRecord;
    if (!rec?.analysis || typeof rec.analysis.overview !== 'string') return null;
    memory.set(memoryKey(materialId, sentenceId), rec);
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
        analysis: r.analysis,
    };
}

/**
 * 存檔：交易內讀教材，教材與句子仍在、原句沒變才寫入（擋住晚到寫入，Codex）。
 * 回傳 'saved' 或不寫入的原因；網路或權限錯誤會丟出（呼叫端顯示「沒有存起來」，再試一次只重存）
 */
export async function saveSentenceAnalysis(rec: SentenceAnalysisRecord): Promise<'saved' | 'missing-material' | 'missing-sentence' | 'changed'> {
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
    if (outcome === 'saved') memory.set(memoryKey(rec.materialId, rec.sentenceId), rec);
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
    for (const key of [...memory.keys()]) if (key.startsWith(`${materialId}__`)) memory.delete(key);
    if (leftovers.length === 0) return;
    try {
        for (let i = 0; i < leftovers.length; i += 400) {
            const batch = writeBatch(db);
            leftovers.slice(i, i + 400).forEach(id => batch.delete(doc(db, `artifacts/${appId}/users/${uid}/sentenceAnalyses/${id}`)));
            await batch.commit();
        }
    } catch (err) {
        console.warn('[句子解析] 教材已刪除，但部分解析沒有刪掉（不影響使用）', err);
    }
}
