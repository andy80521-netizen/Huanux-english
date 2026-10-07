// 錄音轉文字的第三層備援：Gemini 主要與備用模型都忙碌時，改用 OpenAI Whisper
// 必須驗證 Firebase 登入權杖，避免 OpenAI 金鑰被任何人拿來使用

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

// 依錄音格式決定副檔名（Whisper 依副檔名判斷格式）
function extensionFor(mimeType: string): string {
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('aac')) return 'm4a';
    return 'webm';
}

export default async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const authHeader = req.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return json(401, { error: '未登入' });

    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) return json(401, { error: '登入驗證失敗，請重新登入' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { error: 'Server configuration error' });

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
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const ext = extensionFor(mimeType);
        const formData = new FormData();
        formData.append('file', new Blob([audioBuffer], { type: mimeType.split(';')[0] }), `recording.${ext}`);
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');
        formData.append('response_format', 'json');

        const openAiResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });
        const data = await openAiResponse.json();
        if (!openAiResponse.ok) {
            console.error('Whisper API error:', openAiResponse.status, data?.error?.message);
            return json(502, { error: `Whisper 轉錄失敗 (${openAiResponse.status})` });
        }
        return json(200, { text: typeof data?.text === 'string' ? data.text : '' });
    } catch (err: any) {
        console.error('transcribe-recording error:', err?.message);
        return json(500, { error: 'Whisper 轉錄過程發生錯誤' });
    }
};
