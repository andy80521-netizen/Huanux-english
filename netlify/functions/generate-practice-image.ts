import { verifyRealUserToken } from '../shared/auth';
import { callGeminiFreeThenPaid } from '../shared/aiKeys';
import { generateCloudflareImage } from '../shared/cloudflareImage';

export const config = { background: true };

const APP_ID = 'huan-power-english';
const PROJECT_ID = 'huanux-english';
const BUCKET = 'huanux-english.firebasestorage.app';

const PHOTO_LEAD = 'A photorealistic documentary photograph, shot on a full-frame DSLR camera with a 35mm lens, natural daylight, realistic lighting and textures, sharp focus, high detail.';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function buildSentenceScene(sentenceText: string): Promise<string> {
    const prompt = `You write prompts for an image generator.
Describe ONE concrete visual scene that clearly shows the situation in this English sentence, so a learner can recall the sentence by looking at the picture.
Rules:
- One sentence in English, 20 to 40 words.
- Describe only visible things: place, objects, actions, expressions, mood.
- Any people must be generic and anonymous; never name real people.
- Do not mention text, words, signs, speech bubbles, screens, or logos.
- Output only the sentence, nothing else.

Sentence: ${sentenceText}`;

    const response = await callGeminiFreeThenPaid('practiceImageScene', (ai, model) =>
        ai.models.generateContent({ model, contents: prompt })
    );
    const scene = (response.text || '').replace(/\s+/g, ' ').trim();
    if (!scene) {
        throw new Error('沒有取得場景描述');
    }
    return scene.slice(0, 400);
}

async function deleteStorageFile(storagePath: string, idToken: string): Promise<void> {
    await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Firebase ${idToken}` }
    }).catch(err => console.warn('[看圖題] 刪除圖片失敗:', err));
}

type WriteResult = 'saved' | 'skip' | 'conflict';

async function writeImageUrl(
    uid: string,
    patternId: string,
    sentenceId: string,
    sentenceText: string,
    imageUrl: string,
    idToken: string
): Promise<WriteResult> {
    const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/artifacts/${APP_ID}/users/${uid}/languagePatterns/${patternId}`;

    const getRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}?mask.fieldPaths=exampleSentences`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!getRes.ok) {
        console.warn(`[看圖題] 讀取句型失敗 (${getRes.status})`);
        return 'skip';
    }

    const docData = await getRes.json();
    const updateTime = docData?.updateTime;
    const values = docData?.fields?.exampleSentences?.arrayValue?.values || [];
    const target = values.find((v: any) => v?.mapValue?.fields?.id?.stringValue === sentenceId);
    const fields = target?.mapValue?.fields;

    if (!updateTime || !fields) {
        return 'skip';
    }
    if ((fields.text?.stringValue || '').trim() !== sentenceText.trim()) {
        return 'skip';
    }
    if (fields.imageUrl?.stringValue) {
        return 'skip';
    }

    fields.imageUrl = { stringValue: imageUrl };

    const patchUrl = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=exampleSentences&currentDocument.updateTime=${encodeURIComponent(updateTime)}`;
    const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ fields: { exampleSentences: { arrayValue: { values } } } })
    });

    if (patchRes.ok) {
        return 'saved';
    }

    const errText = await patchRes.text();
    if ([409, 412].includes(patchRes.status) || /FAILED_PRECONDITION|ABORTED/.test(errText)) {
        return 'conflict';
    }
    console.warn(`[看圖題] 寫回失敗 (${patchRes.status}):`, errText.slice(0, 300));
    return 'skip';
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
        console.error('[看圖題] 解析 JSON 失敗');
        return new Response(null, { status: 200 });
    }

    const { idToken, patternId, sentenceId, sentenceText } = payload || {};

    if (
        typeof idToken !== 'string' || !idToken ||
        typeof patternId !== 'string' || !ID_PATTERN.test(patternId) ||
        typeof sentenceId !== 'string' || !ID_PATTERN.test(sentenceId) ||
        typeof sentenceText !== 'string' || !sentenceText.trim() || sentenceText.length > 500
    ) {
        console.error('[看圖題] 參數不符合規定');
        return new Response(null, { status: 200 });
    }

    const authResult = await verifyRealUserToken(idToken);
    if ('error' in authResult) {
        console.error('[看圖題] 登入驗證失敗:', authResult.error);
        return new Response(null, { status: 200 });
    }
    const uid = authResult.uid;

    console.log(`[看圖題] 開始：句型 ${patternId}，句子 ${sentenceId}`);

    let scene = '';
    try {
        scene = await buildSentenceScene(sentenceText);
        console.log(`[看圖題] 場景描述：${scene}`);
    } catch (sceneErr: any) {
        console.warn('[看圖題] 場景描述失敗，改用原句:', sceneErr?.message || sceneErr);
        scene = sentenceText.trim();
    }

    let imageBuffer: Buffer;
    try {
        const cf = await generateCloudflareImage(`${PHOTO_LEAD}\n${scene}\nThe main subject is centered in the frame.`, 4);
        imageBuffer = cf.data;
    } catch (cfErr: any) {
        console.warn('[看圖題] Cloudflare 產圖失敗（可能是今日免費額度已用完），下次練習時再補產:', cfErr?.message || cfErr);
        return new Response(null, { status: 200 });
    }

    const storagePath = `artifacts/${APP_ID}/users/${uid}/patternImages/${patternId}_${sentenceId}_${Date.now()}.jpg`;
    let imageUrl = '';
    try {
        const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Firebase ${idToken}`,
                'Content-Type': 'image/jpeg'
            },
            body: imageBuffer
        });
        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`Storage 上傳失敗 (${uploadRes.status}): ${errText.slice(0, 300)}`);
        }
        const uploadData = await uploadRes.json();
        const token = String(uploadData?.downloadTokens || '').split(',')[0].trim();
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    } catch (upErr: any) {
        console.error('[看圖題] 上傳圖片失敗:', upErr?.message || upErr);
        return new Response(null, { status: 200 });
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        let result: WriteResult = 'skip';
        try {
            result = await writeImageUrl(uid, patternId, sentenceId, sentenceText, imageUrl, idToken);
        } catch (wErr: any) {
            console.error('[看圖題] 寫回出錯:', wErr?.message || wErr);
        }
        if (result === 'saved') {
            console.log(`[看圖題] 完成：句型 ${patternId}，句子 ${sentenceId}`);
            return new Response(null, { status: 200 });
        }
        if (result === 'skip') {
            break;
        }
        await sleep(300 * attempt);
    }

    console.log('[看圖題] 未寫回（句子已變更、已有圖片或寫入衝突），刪除剛上傳的圖片');
    await deleteStorageFile(storagePath, idToken);
    return new Response(null, { status: 200 });
};
