// 錄音轉文字（PR B，2026-10-30 起為主力）：Groq Whisper large-v3 → OpenAI whisper-1；都失敗回 502，前端再改用 Gemini
// 必須驗證 Firebase 登入權杖，避免金鑰被任何人拿來使用
import { runTranscribeChain, GROQ_TRANSCRIBE_MODEL, GROQ_TRANSCRIBE_URL, OPENAI_TRANSCRIBE_URL } from '../shared/transcribe';

const MAX_BASE64_LENGTH = 4_000_000; // 約 3MB 音檔，跟讀錄音通常遠小於此

const json = (status: number, body: Record<string, any>) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 用 Firebase 官方「查詢使用者」端點驗證權杖：有效則回傳 uid，無效回傳 null
async function verifyFirebaseIdToken(idToken: string): Promise<string | null> {
    const apiKey = process.env.VITE_FB_API_KEY;
    if (!apiKey) return null;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.users?.[0]?.localId || null;
}

export default async (req: Request) => {
    // 整條轉錄鏈的時間預算從收到請求開始算（含驗證登入）
    const startedAt = Date.now();
    if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const authHeader = req.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return json(401, { error: '未登入' });

    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) return json(401, { error: '登入驗證失敗，請重新登入' });

    if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) return json(500, { error: 'Server configuration error' });

    let body: any;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: 'Invalid JSON' });
    }

    const { audioBase64, mimeType } = body || {};
    if (typeof audioBase64 !== 'string' || !audioBase64 || typeof mimeType !== 'string') {
        return json(400, { error: 'Missing audio data' });
    }
    if (audioBase64.length > MAX_BASE64_LENGTH) {
        return json(413, { error: '錄音檔過大' });
    }

    try {
        const audio = new Uint8Array(Buffer.from(audioBase64, 'base64'));
        const result = await runTranscribeChain({
            audio,
            mimeType,
            providers: [
                { name: 'Groq', url: GROQ_TRANSCRIBE_URL, model: GROQ_TRANSCRIBE_MODEL, key: process.env.GROQ_API_KEY },
                { name: 'OpenAI', url: OPENAI_TRANSCRIBE_URL, model: 'whisper-1', key: process.env.OPENAI_API_KEY },
            ],
            fetchImpl: (url, init) => fetch(url, init),
            now: () => Date.now(),
            startedAt,
        });
        if (result.ok === false) return json(result.status, { error: result.error });
        // 空字串是合法結果（沒有人聲）
        return json(200, { text: result.text, model: result.model });
    } catch (err: any) {
        console.error('transcribe-recording error:', err?.message);
        return json(500, { error: '語音轉文字過程發生錯誤' });
    }
};
