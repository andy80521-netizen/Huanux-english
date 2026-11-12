// 時間軸診斷（Background Function，最多 15 分鐘）：同一份教材音檔同時取得 OpenAI 與 Groq 的原始時間
// 只寫入 transcriptionDiagnostics，不改教材；規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准）
import { verifyRealUserToken } from '../shared/auth';
import { toFields, fieldsToObject, FS_BASE, APP_ID, runOptimistic } from '../shared/firestoreRest';
import {
    runDiagnostic, fetchDiagnosticAudio, callOpenAIDiagnostic, callGroqDiagnostic, diagnosticDocPath, canStartDiagnostic,
} from '../shared/transcribeDiagnostic';

export const config = { background: true };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

async function readDoc(idToken: string, path: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${FS_BASE}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`讀取資料失敗 (HTTP ${res.status})`);
    const doc = await res.json() as { fields?: any };
    return fieldsToObject(doc.fields || {});
}

/** 寫入（文件不存在就建立）：預設只更新給定的欄位；replace＝整份覆寫 */
async function mergeDoc(idToken: string, path: string, data: Record<string, any>, replace = false): Promise<void> {
    const mask = replace ? '' : Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`${FS_BASE}/${path}${mask ? `?${mask}` : ''}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFields(data) }),
    });
    if (!res.ok) throw new Error(`寫入失敗 (HTTP ${res.status})`);
}

export default async (req: Request) => {
    // Background Function 一律回傳 200（平台不重試）
    if (req.method !== 'POST') return new Response(null, { status: 200 });
    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return new Response(null, { status: 200 });
    }
    const { idToken, materialId } = payload || {};
    if (typeof idToken !== 'string' || !idToken || typeof materialId !== 'string' || !ID_PATTERN.test(materialId)) {
        console.error('[時間軸診斷] 參數不符合規定');
        return new Response(null, { status: 200 });
    }
    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error(`[時間軸診斷] 驗證失敗：${authResult.error}`);
        return new Response(null, { status: 200 });
    }
    // 路徑一律用 token 的 uid，不信任前端
    const uid = authResult.uid;
    const openaiKey = process.env.OPENAI_API_KEY || '';
    const groqKey = process.env.GROQ_API_KEY || '';
    const missing = async (name: string) => ({ status: 'error' as const, model: '', notes: [], error: `伺服器沒有設定 ${name}` });

    const result = await runDiagnostic({
        uid,
        materialId,
        appId: APP_ID,
        readMaterial: () => readDoc(idToken, `artifacts/${APP_ID}/users/${uid}/materials/${materialId}`),
        readDiagnostic: () => readDoc(idToken, diagnosticDocPath(APP_ID, uid, materialId)) as any,
        fetchAudio: (url) => fetchDiagnosticAudio(url),
        openai: (audio) => (openaiKey ? callOpenAIDiagnostic(audio, openaiKey) : missing('OPENAI_API_KEY')),
        groq: (audio) => (groqKey ? callGroqDiagnostic(audio, groqKey) : missing('GROQ_API_KEY')),
        write: (path, data, opts) => mergeDoc(idToken, path, data, !!opts?.replace),
        // 同一份教材同時觸發（兩個分頁、連按）時只有一個能執行：讀取、檢查冷卻、寫入 running 一次完成（Codex）
        claim: (running) => runOptimistic(idToken, async (t) => {
            const path = diagnosticDocPath(APP_ID, uid, materialId);
            const cur = await t.get(path);
            if (!canStartDiagnostic(cur as any, Date.now())) return false;
            if (cur) t.update(path, running); else t.create(path, running);
            return true;
        }),
    }).catch((e) => {
        console.error('[時間軸診斷] 失敗：', e?.message || e);
        return 'error';
    });
    console.log(`[時間軸診斷] ${materialId}：${result}`);
    return new Response(null, { status: 200 });
};
