// Firestore REST：值轉換與交易（使用者自己的 ID Token；不使用服務帳號）
// 規劃：docs/plans/background-material-save.md

export const PROJECT_ID = 'huanux-english';
export const APP_ID = 'huan-power-english';
export const DOCS_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
export const FS_BASE = `https://firestore.googleapis.com/v1/${DOCS_ROOT}`;

/** 一般 JS 值 → Firestore REST 值；undefined 由呼叫端省略 */
export function toValue(v: any): any {
    if (v === null) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.filter(x => x !== undefined).map(toValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
    throw new Error(`無法轉換的值型別：${typeof v}`);
}

export function toFields(obj: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
    return out;
}

export function fromValue(v: any): any {
    if (!v || typeof v !== 'object') return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromValue);
    if ('mapValue' in v) return fieldsToObject(v.mapValue?.fields);
    return undefined;
}

export function fieldsToObject(fields: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(fields || {})) out[k] = fromValue(x);
    return out;
}

/** 交易內可用的操作；寫入收集後在 commit 一次原子送出 */
export interface TxApi {
    /** 讀文件（不存在 → null） */
    get(path: string): Promise<Record<string, any> | null>;
    /** 更新既有文件的欄位（文件必須存在）；deleteFields 會從文件移除 */
    update(path: string, data: Record<string, any>, deleteFields?: string[]): void;
    /** 合併寫入（文件不存在時建立） */
    set(path: string, data: Record<string, any>): void;
    /** 建立（文件必須不存在） */
    create(path: string, data: Record<string, any>): void;
    delete(path: string): void;
}

const isRetryable = (status: number, body: string) =>
    status === 409 || /ABORTED|FAILED_PRECONDITION/.test(body);

export class FirestoreRestError extends Error {
    constructor(message: string, public status: number, public body: string) {
        super(message);
        this.name = 'FirestoreRestError';
    }
}

/**
 * 執行一筆讀寫交易：開交易 → fn（交易內讀取、收集寫入）→ commit。
 * 衝突（ABORTED／前置條件失敗）時整筆重跑，最多 maxAttempts 次。fn 可能被執行多次，不可有其他副作用。
 */
export async function runTransaction<T>(
    idToken: string,
    fn: (tx: TxApi) => Promise<T>,
    opts: { fetchImpl?: typeof fetch; maxAttempts?: number } = {},
): Promise<T> {
    const doFetch = opts.fetchImpl ?? fetch;
    const maxAttempts = opts.maxAttempts ?? 5;
    const headers = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    const name = (path: string) => `${DOCS_ROOT}/${path}`;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const begin = await doFetch(`${FS_BASE}:beginTransaction`, { method: 'POST', headers, body: JSON.stringify({ options: { readWrite: {} } }) });
        if (!begin.ok) { const b = await begin.text(); throw new FirestoreRestError(`開始交易失敗 (HTTP ${begin.status}) ${b.slice(0, 160)}`, begin.status, b); }
        const { transaction } = await begin.json() as { transaction: string };
        const writes: any[] = [];

        const api: TxApi = {
            get: async (path) => {
                const res = await doFetch(`${FS_BASE}/${path}?transaction=${encodeURIComponent(transaction)}`, { headers });
                if (res.status === 404) return null;
                if (!res.ok) { const b = await res.text(); throw new FirestoreRestError(`讀取失敗 (HTTP ${res.status}) ${b.slice(0, 160)}`, res.status, b); }
                const doc = await res.json() as { fields?: any };
                return fieldsToObject(doc.fields);
            },
            update: (path, data, deleteFields = []) => {
                writes.push({
                    update: { name: name(path), fields: toFields(data) },
                    updateMask: { fieldPaths: [...Object.keys(data).filter(k => data[k] !== undefined), ...deleteFields] },
                    currentDocument: { exists: true },
                });
            },
            set: (path, data) => {
                writes.push({
                    update: { name: name(path), fields: toFields(data) },
                    updateMask: { fieldPaths: Object.keys(data).filter(k => data[k] !== undefined) },
                });
            },
            create: (path, data) => {
                writes.push({ update: { name: name(path), fields: toFields(data) }, currentDocument: { exists: false } });
            },
            delete: (path) => { writes.push({ delete: name(path) }); },
        };

        const result = await fn(api);
        const commit = await doFetch(`${FS_BASE}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes, transaction }) });
        if (commit.ok) return result;
        const body = await commit.text();
        lastErr = new FirestoreRestError(`寫入失敗 (HTTP ${commit.status}) ${body.slice(0, 160)}`, commit.status, body);
        if (!isRetryable(commit.status, body)) throw lastErr;
    }
    throw lastErr ?? new Error('交易重試次數已用完');
}

/**
 * 診斷用：直接 PATCH 任務文件的幾個欄位（不經交易），文件不存在就不寫。
 * 只用來寫 saveDiag 等說明，不可用來改變所有權相關欄位。
 */
export async function patchFields(idToken: string, path: string, data: Record<string, any>, opts: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
    const doFetch = opts.fetchImpl ?? fetch;
    const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const res = await doFetch(`${FS_BASE}/${path}?${mask}&currentDocument.exists=true`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFields(data) }),
    });
    return res.ok;
}
