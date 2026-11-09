// 匯入教材在伺服器背景存檔（Background Function，最多 15 分鐘）
// 規劃：docs/plans/background-material-save.md（擁有者 2026-11-09 核准）
// 流程與所有權規則見 netlify/shared/saveMaterial.ts
import { verifyRealUserToken } from '../shared/auth';
import { runOptimistic, patchFields, APP_ID } from '../shared/firestoreRest';
import { translateBatch } from '../shared/translate';
import { runSaveMaterial } from '../shared/saveMaterial';
import { randomUUID } from 'node:crypto';

export const config = { background: true };

const BUCKET = 'huanux-english.firebasestorage.app';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const DISPATCH_TIMEOUT_MS = 8_000;

/**
 * 派工呼叫自己網站的其他背景函式時用的網址：請求的 origin 必須是本專案的正式站或預覽網址，
 * 否則改用平台提供的 URL（不把 ID Token 送到不認得的主機）
 */
function isAllowedOrigin(origin: string): boolean {
    return /^https:\/\/([a-z0-9-]+--)?huanuxenglish\.netlify\.app$/.test(origin)
        || (!!process.env.URL && origin === new URL(process.env.URL).origin);
}

function siteOrigin(req: Request): string | null {
    try {
        const origin = new URL(req.url).origin;
        if (isAllowedOrigin(origin)) return origin;
    } catch { /* 忽略 */ }
    try {
        return process.env.URL ? new URL(process.env.URL).origin : null;
    } catch {
        return null;
    }
}

export default async (req: Request) => {
    // Background Function 一律回傳 200（平台不重試）
    if (req.method !== 'POST') return new Response(null, { status: 200 });

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        console.error('[背景存檔] 解析 JSON 失敗');
        return new Response(null, { status: 200 });
    }
    const { idToken, materialId, saveAttempt } = payload || {};
    if (typeof idToken !== 'string' || !idToken || typeof materialId !== 'string' || !ID_PATTERN.test(materialId)
        || typeof saveAttempt !== 'number' || !Number.isInteger(saveAttempt)) {
        console.error('[背景存檔] 參數不符合規定');
        return new Response(null, { status: 200 });
    }

    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error(`[背景存檔] 驗證失敗：${authResult.error}`);
        return new Response(null, { status: 200 });
    }

    // 診斷：把每次執行的結果寫回任務（saveDiag），全域提示在「可能中斷了」時顯示，方便找出原因
    const jobPath = `artifacts/${APP_ID}/users/${authResult.uid}/transcriptionJobs/${materialId}`;
    const diag = (text: string) => patchFields(idToken, jobPath, { saveDiag: `第 ${saveAttempt} 次：${text}`.slice(0, 300), saveDiagAt: Date.now() })
        .catch((e) => { console.error('[背景存檔] 寫入診斷失敗：', e?.message); return false; });
    await diag('伺服器已收到');

    const origin = siteOrigin(req);
    const started = Date.now();
    const outcome = await runSaveMaterial({
        // 不可用 REST beginTransaction（使用者 Token 會 403），改用 updateTime 前置條件＋批次 commit
        tx: (fn) => runOptimistic(idToken, fn),
        translate: translateBatch,
        dispatch: async (fn, body) => {
            if (!origin) return false;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
            try {
                const res = await fetch(`${origin}/.netlify/functions/${fn}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: ctrl.signal,
                });
                return res.ok;
            } catch {
                return false;
            } finally {
                clearTimeout(timer);
            }
        },
        now: () => Date.now(),
        newId: () => randomUUID(),
        log: (msg) => console.log(`[背景存檔] ${msg}`),   // 只記流程，不記句子內容與 Token
    }, { uid: authResult.uid, materialId, saveAttempt, idToken, appId: APP_ID, bucket: BUCKET })
        .catch(async (e) => {
            console.error('[背景存檔] 未預期的錯誤：', e?.message);
            await diag(`出錯：${e?.message || e}`);
            return 'error' as const;
        });

    console.log(`[背景存檔] 結果：${outcome}，${Date.now() - started}ms`);
    if (outcome === 'stale' || outcome === 'busy' || outcome === 'lost') await diag(`結束（${outcome}）`);
    return new Response(null, { status: 200 });
};
