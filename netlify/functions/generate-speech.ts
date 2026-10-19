import { createHash } from 'crypto';
import { verifyRealUserToken } from '../shared/auth';
import { callGeminiFreeThenPaid } from '../shared/aiKeys';

export const config = { background: true };

const APP_ID = 'huan-power-english';
const PROJECT_ID = 'huanux-english';
const BUCKET = 'huanux-english.firebasestorage.app';

const VOICE_NAME = 'Aoede';
const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts'];
const MAX_TEXT_LENGTH = 500;

// 快取 key：前後端必須用同一套規則計算（src/services/speech.ts 有相同的實作）
function speechCacheKey(text: string): string {
    return createHash('sha256').update(`${VOICE_NAME}|${text.trim()}`, 'utf8').digest('hex').slice(0, 40);
}

// TTS 回傳可能是帶 WAV 檔頭的音訊，或無檔頭的純 PCM；統一轉成 WAV
function toWav(base64Data: string, mimeType: string | undefined): Buffer {
    const bytes = Buffer.from(base64Data, 'base64');
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
        return bytes;
    }

    const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const numChannels = 1;
    const bitsPerSample = 16;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + bytes.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(bytes.length, 40);
    return Buffer.concat([header, bytes]);
}

async function writeCacheDoc(uid: string, key: string, idToken: string, fields: Record<string, any>): Promise<void> {
    const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/artifacts/${APP_ID}/users/${uid}/ttsCache/${key}`;
    const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
    const res = await fetch(`https://firestore.googleapis.com/v1/${docPath}?${mask}`, {
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

    const { idToken, text } = payload || {};
    if (
        typeof idToken !== 'string' || !idToken ||
        typeof text !== 'string' || !text.trim() || text.trim().length > MAX_TEXT_LENGTH
    ) {
        console.error('[語音] 參數不符合規定');
        return new Response(null, { status: 200 });
    }

    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error('[語音] 登入驗證失敗:', authResult.error);
        return new Response(null, { status: 200 });
    }
    const uid = authResult.uid;

    const cleanText = text.trim();
    const key = speechCacheKey(cleanText);
    console.log(`[語音] 開始：${key}`);

    try {
        const response = await callGeminiFreeThenPaid('speech', (ai, model) =>
            ai.models.generateContent({
                model,
                contents: cleanText,
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: VOICE_NAME }
                        }
                    }
                }
            } as any),
            { free: TTS_MODELS, paid: TTS_MODELS }
        );

        const parts = response.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find((p: any) => p?.inlineData?.data);
        if (!audioPart?.inlineData?.data) {
            throw new Error('沒有回傳音訊資料');
        }
        const wav = toWav(audioPart.inlineData.data, audioPart.inlineData.mimeType);

        const storagePath = `artifacts/${APP_ID}/users/${uid}/ttsAudio/${key}.wav`;
        const uploadRes = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`, {
            method: 'POST',
            headers: {
                'Authorization': `Firebase ${idToken}`,
                'Content-Type': 'audio/wav'
            },
            body: wav
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
        console.error('[語音] 產生失敗:', err?.message || err);
        await writeCacheDoc(uid, key, idToken, {
            text: { stringValue: cleanText },
            status: { stringValue: 'error' },
            error: { stringValue: String(err?.message || '語音產生失敗').slice(0, 300) },
            updatedAt: { integerValue: String(Date.now()) }
        });
    }

    return new Response(null, { status: 200 });
};
