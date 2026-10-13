import { GoogleGenAI } from '@google/genai';
import { callWithModelFallback } from '../shared/geminiFallback';

export const config = { background: true };

const APP_ID = 'huan-power-english';
const PROJECT_ID = 'huanux-english';
const BUCKET = 'huanux-english.firebasestorage.app';

const IMAGE_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'];

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

async function updateFirestore(
    uid: string,
    materialId: string,
    idToken: string,
    isSuccess: boolean,
    data: { coverUrl?: string; coverPath?: string; errorMsg?: string }
): Promise<Response> {
    const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/artifacts/${APP_ID}/users/${uid}/materials/${materialId}`;
    
    let url: string;
    let body: any;

    if (isSuccess) {
        url = `https://firestore.googleapis.com/v1/${docPath}?currentDocument.exists=true&updateMask.fieldPaths=coverUrl&updateMask.fieldPaths=coverPath&updateMask.fieldPaths=coverStatus&updateMask.fieldPaths=coverError`;
        body = {
            fields: {
                coverUrl: { stringValue: data.coverUrl || '' },
                coverPath: { stringValue: data.coverPath || '' },
                coverStatus: { stringValue: 'done' }
            }
        };
    } else {
        url = `https://firestore.googleapis.com/v1/${docPath}?currentDocument.exists=true&updateMask.fieldPaths=coverStatus&updateMask.fieldPaths=coverError`;
        body = {
            fields: {
                coverStatus: { stringValue: 'error' },
                coverError: { stringValue: data.errorMsg || '產生封面失敗' }
            }
        };
    }

    return await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(body)
    });
}

export default async (req: Request) => {
    // Background Function 一律回傳 200
    if (req.method !== 'POST') {
        return new Response(null, { status: 200 });
    }

    let payload: any;
    try {
        payload = await req.json();
    } catch (e) {
        console.error('[封面] 解析 JSON 失敗:', e);
        return new Response(null, { status: 200 });
    }

    const { idToken, materialId, style, title, excerpt } = payload || {};

    if (!idToken || typeof idToken !== 'string') {
        console.error('[封面] 缺少或無效的 idToken');
        return new Response(null, { status: 200 });
    }

    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) {
        console.error('[封面] idToken 驗證失敗');
        return new Response(null, { status: 200 });
    }

    if (
        typeof materialId !== 'string' ||
        !/^[A-Za-z0-9]+$/.test(materialId) ||
        (style !== 'photo' && style !== 'anime') ||
        typeof title !== 'string' ||
        typeof excerpt !== 'string'
    ) {
        console.error('[封面] 參數不符合規定:', { materialId, style });
        return new Response(null, { status: 200 });
    }

    const truncatedExcerpt = excerpt.slice(0, 1000);
    const storagePath = `artifacts/${APP_ID}/users/${uid}/materialCovers/${materialId}`;

    console.log(`[封面] 開始為教材 ${materialId} 產生封面，風格: ${style}，使用者: ${uid}`);

    // 金鑰檢查
    const geminiPaidKey = process.env.GEMINI_PAID_API_KEY;
    if (!geminiPaidKey) {
        console.error('[封面] 缺少 GEMINI_PAID_API_KEY');
        await updateFirestore(uid, materialId, idToken, false, { errorMsg: '伺服器缺少 GEMINI_PAID_API_KEY' });
        return new Response(null, { status: 200 });
    }

    // 組提示詞
    const basePrompt = `Create a cover image for an English listening lesson. Illustrate the main topic or scene of the lesson.
Lesson title: ${title}
Lesson excerpt: ${truncatedExcerpt}
Do not include any text, letters, captions, logos, or watermarks.
Do not depict any real, identifiable person; if people are needed, show generic anonymous people.
Wide 16:9 composition.`;

    const stylePrompt = style === 'photo'
        ? "Style: realistic editorial news photograph, natural lighting, documentary feel."
        : "Style: Japanese anime illustration, clean line art, cel shading, vibrant colors.";

    const fullPrompt = `${basePrompt}\n${stylePrompt}`;

    const ai = new GoogleGenAI({ apiKey: geminiPaidKey });

    let imageBase64 = '';
    let mimeType = 'image/png';

    try {
        const response = await callWithModelFallback(IMAGE_MODELS, async (model) => {
            console.log(`[封面] 使用模型: ${model}`);
            return await ai.models.generateContent({
                model,
                contents: fullPrompt,
                config: {
                    imageConfig: {
                        aspectRatio: '16:9'
                    }
                }
            });
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const inlinePart = parts.find((p: any) => p?.inlineData?.data);
        if (!inlinePart || !inlinePart.inlineData?.data) {
            throw new Error('模型未回傳圖片資料');
        }

        imageBase64 = inlinePart.inlineData.data;
        mimeType = inlinePart.inlineData.mimeType || 'image/png';
    } catch (genErr: any) {
        console.error('[封面] 圖片生成失敗:', genErr?.message || genErr);
        await updateFirestore(uid, materialId, idToken, false, {
            errorMsg: `圖片生成失敗: ${genErr?.message || '模型忙碌或失敗'}`
        });
        return new Response(null, { status: 200 });
    }

    // 上傳 Firebase Storage
    let coverUrl = '';
    try {
        const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Firebase ${idToken}`,
                'Content-Type': mimeType
            },
            body: imageBuffer
        });

        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`Storage 上傳失敗 (${uploadRes.status}): ${errText}`);
        }

        const uploadData = await uploadRes.json();
        const downloadTokens = uploadData?.downloadTokens || '';
        const token = downloadTokens.split(',')[0].trim();
        coverUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    } catch (upErr: any) {
        console.error('[封面] Storage 上傳出錯:', upErr?.message || upErr);
        await updateFirestore(uid, materialId, idToken, false, {
            errorMsg: `圖片上傳失敗: ${upErr?.message || upErr}`
        });
        return new Response(null, { status: 200 });
    }

    // 寫回 Firestore
    try {
        const patchRes = await updateFirestore(uid, materialId, idToken, true, {
            coverUrl,
            coverPath: storagePath
        });

        if (!patchRes.ok) {
            const patchErrText = await patchRes.text();
            console.warn(`[封面] Firestore 更新回傳狀態 ${patchRes.status}:`, patchErrText);
            // 404 或 FAILED_PRECONDITION 代表教材文件不存在或已刪除
            if (patchRes.status === 404 || patchErrText.includes('FAILED_PRECONDITION') || patchErrText.includes('NOT_FOUND')) {
                console.log(`[封面] 教材已不存在，刪除剛上傳的封面檔案: ${storagePath}`);
                const deleteUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}`;
                await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Firebase ${idToken}` }
                }).catch(delErr => console.warn('[封面] 刪除孤兒圖片失敗:', delErr));
            }
            return new Response(null, { status: 200 });
        }

        console.log(`[封面] 完成為教材 ${materialId} 建立封面`);
    } catch (dbErr: any) {
        console.error('[封面] 寫回 Firestore 失敗:', dbErr?.message || dbErr);
    }

    return new Response(null, { status: 200 });
};
