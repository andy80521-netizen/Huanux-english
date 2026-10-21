import { createHash } from 'crypto';
import { verifyRealUserToken } from '../shared/auth';

export const config = { background: true };

const APP_ID = 'huan-power-english';
const PROJECT_ID = 'huanux-english';
const BUCKET = 'huanux-english.firebasestorage.app';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const CACHE_VERSION = 'gcp1';
const MAX_TEXT_LENGTH = 500;
const MAX_BATCH = 30;
const GENERATING_STALE_MS = 2 * 60 * 1000;

type SpeechLang = 'zh' | 'en';

// 優先使用的聲音；Google 回覆找不到這個聲音時，改用「語言＋女聲」讓 Google 自動挑選
const VOICES: Record<SpeechLang, { languageCode: string; name: string }> = {
    en: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Aoede' },
    zh: { languageCode: 'cmn-TW', name: 'cmn-TW-Wavenet-A' }
};
const FALLBACK_VOICES: Record<SpeechLang, { languageCode: string; ssmlGender: string }> = {
    en: { languageCode: 'en-US', ssmlGender: 'FEMALE' },
    zh: { languageCode: 'cmn-TW', ssmlGender: 'FEMALE' }
};

// 含中文字用中文聲音，否則用英文聲音（src/services/speech.ts 有相同的判斷）
function speechLang(text: string): SpeechLang {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'zh' : 'en';
}

// 快取 key：前後端必須用同一套規則計算（src/services/speech.ts 有相同的實作）
function speechCacheKey(text: string): string {
    const clean = text.trim();
    return createHash('sha256').update(`${CACHE_VERSION}|${speechLang(clean)}|${clean}`, 'utf8').digest('hex').slice(0, 40);
}

async function callCloudTts(apiKey: string, text: string, voice: Record<string, string>): Promise<Response> {
    return fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: 'MP3' } })
    });
}

// Google Cloud Text-to-Speech：回傳 MP3
async function synthesize(text: string): Promise<Buffer> {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
        throw new Error('尚未設定 GOOGLE_TTS_API_KEY');
    }
    const lang = speechLang(text);
    let res = await callCloudTts(apiKey, text, VOICES[lang]);
    if (res.status === 400 || res.status === 404) {
        const errText = await res.text();
        console.warn(`[語音] 指定聲音 ${VOICES[lang].name} 失敗 (${res.status})，改用自動挑選:`, errText.slice(0, 200));
        res = await callCloudTts(apiKey, text, FALLBACK_VOICES[lang]);
    }
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cloud TTS 失敗 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data?.audioContent) {
        throw new Error('Cloud TTS 沒有回傳音訊資料');
    }
    return Buffer.from(data.audioContent, 'base64');
}

async function readCacheDoc(uid: string, key: string, idToken: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${FS_BASE}/artifacts/${APP_ID}/users/${uid}/ttsCache/${key}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.fields || {};
    return {
        status: f.status?.stringValue,
        audioUrl: f.audioUrl?.stringValue,
        requestedAt: f.requestedAt ? Number(f.requestedAt.integerValue ?? f.requestedAt.doubleValue) : undefined
    };
}

async function writeCacheDoc(uid: string, key: string, idToken: string, fields: Record<string, any>): Promise<void> {
    const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
    const res = await fetch(`${FS_BASE}/artifacts/${APP_ID}/users/${uid}/ttsCache/${key}?${mask}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ fields })
    });
    if (!res.ok) {
        const errText = await res.text();
        console.warn(`[語音] 寫入快取文件失敗 (${res.status}):`, errText.slice(0, 300));
    }
}

// 產生一段語音；已完成時略過。批次預先產生時，另一個請求正在產生的也略過
// （單段請求由前端先標記「產生中」再送來，所以單段不檢查產生中）
async function processOne(uid: string, idToken: string, cleanText: string, skipIfGenerating: boolean): Promise<void> {
    const key = speechCacheKey(cleanText);
    const existing = await readCacheDoc(uid, key, idToken);
    if (existing?.status === 'done' && existing.audioUrl) {
        return;
    }
    if (skipIfGenerating && existing?.status === 'generating' && typeof existing.requestedAt === 'number' && Date.now() - existing.requestedAt < GENERATING_STALE_MS) {
        return;
    }

    await writeCacheDoc(uid, key, idToken, {
        text: { stringValue: cleanText },
        status: { stringValue: 'generating' },
        requestedAt: { integerValue: String(Date.now()) }
    });

    try {
        const mp3 = await synthesize(cleanText);
        const storagePath = `artifacts/${APP_ID}/users/${uid}/ttsAudio/${key}.mp3`;
        const uploadRes = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`, {
            method: 'POST',
            headers: {
                'Authorization': `Firebase ${idToken}`,
                'Content-Type': 'audio/mpeg'
            },
            body: mp3
        });
        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`Storage 上傳失敗 (${uploadRes.status}): ${errText.slice(0, 300)}`);
        }
        const uploadData = await uploadRes.json();
        const token = String(uploadData?.downloadTokens || '').split(',')[0].trim();
        const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;

        await writeCacheDoc(uid, key, idToken, {
            text: { stringValue: cleanText },
            status: { stringValue: 'done' },
            audioUrl: { stringValue: audioUrl },
            audioPath: { stringValue: storagePath },
            error: { stringValue: '' },
            updatedAt: { integerValue: String(Date.now()) }
        });
        console.log(`[語音] 完成：${key}`);
    } catch (err: any) {
        console.error(`[語音] 產生失敗 ${key}:`, err?.message || err);
        await writeCacheDoc(uid, key, idToken, {
            text: { stringValue: cleanText },
            status: { stringValue: 'error' },
            error: { stringValue: String(err?.message || '語音產生失敗').slice(0, 300) },
            updatedAt: { integerValue: String(Date.now()) }
        });
    }
}

export default async (req: Request) => {
    // Background Function 一律回傳 200
    if (req.method !== 'POST') {
        return new Response(null, { status: 200 });
    }

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        console.error('[語音] 解析 JSON 失敗');
        return new Response(null, { status: 200 });
    }

    // 單段：{ idToken, text }；批次（預先產生）：{ idToken, texts: string[] }
    const { idToken, text, texts } = payload || {};
    const isBatch = Array.isArray(texts);
    const rawList: any[] = isBatch ? texts : [text];
    const list = Array.from(new Set(
        rawList
            .filter((t: any) => typeof t === 'string')
            .map((t: string) => t.trim())
            .filter((t: string) => t.length >= 1 && t.length <= MAX_TEXT_LENGTH)
    )).slice(0, MAX_BATCH);

    if (typeof idToken !== 'string' || !idToken || list.length === 0) {
        console.error('[語音] 參數不符合規定');
        return new Response(null, { status: 200 });
    }

    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error('[語音] 登入驗證失敗:', authResult.error);
        return new Response(null, { status: 200 });
    }
    const uid = authResult.uid;

    console.log(`[語音] 開始：${list.length} 段`);
    // 依序處理，避免同時大量請求
    for (const cleanText of list) {
        await processOne(uid, idToken, cleanText, isBatch);
    }

    return new Response(null, { status: 200 });
};
