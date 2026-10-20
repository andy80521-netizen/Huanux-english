import { verifyRealUserToken } from '../shared/auth';
import { callGeminiFreeThenPaid } from '../shared/aiKeys';
import { buildDetectSightingsPrompt, cleanAndParseJSON } from '../shared/prompts';

export const config = { background: true };

const APP_ID = 'huan-power-english';
const PROJECT_ID = 'huanux-english';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const CHUNK_SIZE = 40;
const MAX_PATTERNS = 2000;

// Firestore REST 的值轉成一般 JS 值
function fromValue(v: any): any {
    if (!v || typeof v !== 'object') return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromValue);
    if ('mapValue' in v) {
        const out: Record<string, any> = {};
        for (const [k, x] of Object.entries(v.mapValue?.fields || {})) out[k] = fromValue(x);
        return out;
    }
    return undefined;
}

function fieldsToObject(fields: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(fields || {})) out[k] = fromValue(x);
    return out;
}

async function fsGet(path: string, idToken: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${FS_BASE}/${path}`, { headers: { 'Authorization': `Bearer ${idToken}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`讀取 ${path} 失敗 (${res.status})`);
    const data = await res.json();
    return fieldsToObject(data.fields);
}

async function fsList(collectionPath: string, maskFields: string[], idToken: string): Promise<{ id: string; data: Record<string, any> }[]> {
    const results: { id: string; data: Record<string, any> }[] = [];
    let pageToken = '';
    do {
        const mask = maskFields.map(f => `mask.fieldPaths=${f}`).join('&');
        const url = `${FS_BASE}/${collectionPath}?pageSize=300&${mask}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (!res.ok) throw new Error(`讀取清單 ${collectionPath} 失敗 (${res.status})`);
        const data = await res.json();
        for (const d of data.documents || []) {
            const id = String(d.name || '').split('/').pop() || '';
            results.push({ id, data: fieldsToObject(d.fields) });
        }
        pageToken = data.nextPageToken || '';
    } while (pageToken && results.length < MAX_PATTERNS);
    return results;
}

async function fsPatch(path: string, fields: Record<string, any>, idToken: string): Promise<void> {
    const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
    const res = await fetch(`${FS_BASE}/${path}?${mask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ fields })
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`寫入 ${path} 失敗 (${res.status}): ${errText.slice(0, 200)}`);
    }
}

async function fsDelete(path: string, idToken: string): Promise<void> {
    const res = await fetch(`${FS_BASE}/${path}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${idToken}` } });
    if (!res.ok && res.status !== 404) {
        console.warn(`[重逢] 刪除 ${path} 失敗 (${res.status})`);
    }
}

const str = (s: string) => ({ stringValue: s });
const num = (n: number) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });

export default async (req: Request) => {
    // Background Function 一律回傳 200
    if (req.method !== 'POST') {
        return new Response(null, { status: 200 });
    }

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        console.error('[重逢] 解析 JSON 失敗');
        return new Response(null, { status: 200 });
    }

    const { idToken, materialId } = payload || {};
    if (typeof idToken !== 'string' || !idToken || typeof materialId !== 'string' || !ID_PATTERN.test(materialId)) {
        console.error('[重逢] 參數不符合規定');
        return new Response(null, { status: 200 });
    }

    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error('[重逢] 登入驗證失敗:', authResult.error);
        return new Response(null, { status: 200 });
    }
    const uid = authResult.uid;
    const userBase = `artifacts/${APP_ID}/users/${uid}`;
    const sightingsDocPath = `${userBase}/materialSightings/${materialId}`;

    console.log(`[重逢] 開始比對教材 ${materialId}`);

    try {
        const material = await fsGet(`${userBase}/materials/${materialId}`, idToken);
        if (!material) {
            throw new Error('找不到這份教材');
        }
        const allSentences: any[] = Array.isArray(material.sentences) ? material.sentences : [];
        const sentences = allSentences.filter(s => s && !s.deleted && typeof s.id === 'string' && ID_PATTERN.test(s.id) && typeof s.text === 'string' && s.text.trim());

        const patternDocs = await fsList(`${userBase}/languagePatterns`, ['text', 'meaningZh', 'sourceMaterialId', 'sourceSentenceId', 'sourceLabel'], idToken);
        const patterns = patternDocs
            .filter(p => ID_PATTERN.test(p.id) && typeof p.data.text === 'string' && p.data.text.trim())
            .map(p => ({
                id: p.id,
                text: String(p.data.text).slice(0, 300),
                meaningZh: String(p.data.meaningZh || '').slice(0, 500),
                sourceMaterialId: p.data.sourceMaterialId as string | undefined,
                sourceSentenceId: p.data.sourceSentenceId as string | undefined,
                sourceLabel: p.data.sourceLabel as string | undefined
            }));
        const patternById = new Map(patterns.map(p => [p.id, p]));

        // 判斷某個句型是不是從這一句萃取出來的（來源句不算重逢）
        const isSourceSentence = (p: typeof patterns[number], s: any): boolean => {
            if (p.sourceMaterialId !== materialId) return false;
            if (p.sourceSentenceId) return p.sourceSentenceId === s.id;
            const prefix = String(p.sourceLabel || '').replace(/\.\.\.$/, '');
            return !!prefix && String(s.text).startsWith(prefix);
        };

        const bySentence: Record<string, string[]> = {};

        if (patterns.length > 0 && sentences.length > 0) {
            for (let start = 0; start < sentences.length; start += CHUNK_SIZE) {
                const chunk = sentences.slice(start, start + CHUNK_SIZE);
                const prompt = buildDetectSightingsPrompt(
                    chunk.map(s => String(s.text).slice(0, 1000)),
                    patterns.map(p => ({ id: p.id, text: p.text, meaningZh: p.meaningZh }))
                );
                const response = await callGeminiFreeThenPaid('detectSightings', (ai, model) =>
                    ai.models.generateContent({ model, contents: prompt, config: { temperature: 0.1 } })
                );
                const text = response.text;
                if (!text) {
                    throw new Error('無法從 Gemini 取得內容');
                }
                const parsed = cleanAndParseJSON(text);
                const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
                for (const r of rawResults) {
                    if (!r || !Number.isInteger(r.index) || r.index < 0 || r.index >= chunk.length) continue;
                    const sentence = chunk[r.index];
                    const ids: string[] = Array.isArray(r.patternIds) ? r.patternIds : [];
                    const valid = Array.from(new Set(ids.filter(id => typeof id === 'string' && patternById.has(id))))
                        .filter(id => !isSourceSentence(patternById.get(id)!, sentence));
                    if (valid.length > 0) {
                        bySentence[sentence.id] = valid;
                    }
                }
            }
        }

        // 寫入（或更新）句型端的重逢紀錄；只更新教材資訊，不動 activeCount／lastActiveAt
        const newKeys = new Set<string>();
        const audioUrl = String(material.audioUrl || '');
        const title = String(material.title || '');
        for (const s of sentences) {
            for (const pid of bySentence[s.id] || []) {
                newKeys.add(`${pid}|${s.id}`);
                await fsPatch(`${userBase}/languagePatterns/${pid}/sightings/${materialId}_${s.id}`, {
                    materialId: str(materialId),
                    materialTitle: str(title),
                    sentenceId: str(s.id),
                    text: str(String(s.text)),
                    translation: str(String(s.translation || '')),
                    audioUrl: str(audioUrl),
                    startTime: num(Number(s.startTime) || 0),
                    endTime: num(Number(s.endTime) || 0),
                    updatedAt: num(Date.now())
                }, idToken);
            }
        }

        // 重新比對時，刪除這次已不成立的舊紀錄
        const previous = await fsGet(sightingsDocPath, idToken);
        const prevBySentence: Record<string, string[]> = previous?.bySentence && typeof previous.bySentence === 'object' ? previous.bySentence : {};
        for (const [sentenceId, pids] of Object.entries(prevBySentence)) {
            if (!ID_PATTERN.test(sentenceId) || !Array.isArray(pids)) continue;
            for (const pid of pids) {
                if (typeof pid !== 'string' || !ID_PATTERN.test(pid)) continue;
                if (!newKeys.has(`${pid}|${sentenceId}`)) {
                    await fsDelete(`${userBase}/languagePatterns/${pid}/sightings/${materialId}_${sentenceId}`, idToken);
                }
            }
        }

        const bySentenceFields: Record<string, any> = {};
        for (const [sentenceId, pids] of Object.entries(bySentence)) {
            bySentenceFields[sentenceId] = { arrayValue: { values: pids.map(str) } };
        }
        await fsPatch(sightingsDocPath, {
            status: str('done'),
            bySentence: { mapValue: { fields: bySentenceFields } },
            checkedAt: num(Date.now()),
            error: str('')
        }, idToken);

        const total = Object.values(bySentence).reduce((sum, ids) => sum + ids.length, 0);
        console.log(`[重逢] 完成教材 ${materialId}：${Object.keys(bySentence).length} 句、共 ${total} 筆重逢`);
    } catch (err: any) {
        console.error('[重逢] 比對失敗:', err?.message || err);
        try {
            await fsPatch(sightingsDocPath, {
                status: str('error'),
                error: str(String(err?.message || '比對失敗').slice(0, 300)),
                checkedAt: num(Date.now())
            }, idToken);
        } catch (writeErr: any) {
            console.error('[重逢] 寫入錯誤狀態失敗:', writeErr?.message || writeErr);
        }
    }

    return new Response(null, { status: 200 });
};
