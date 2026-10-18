import { ThinkingLevel } from '@google/genai';
import { verifyRealUser } from '../shared/auth';
import { callGeminiFreeThenPaid } from '../shared/aiKeys';
import {
    buildCheckSentencePrompt,
    buildPracticePromptsPrompt,
    buildRegenerateSeedsPrompt,
    buildExtractFromSentencePrompt,
    buildExtractFromTextPrompt,
    normalizePrimaryCategories,
    TRANSCRIBE_PROMPT,
    cleanAndParseJSON
} from '../shared/prompts';

const json = (status: number, body: Record<string, any>) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' });

    const authResult = await verifyRealUser(req);
    if ('error' in authResult) {
        return json(authResult.status, { error: authResult.error });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: '輸入格式不正確' });
    }

    const { task, payload } = body || {};
    const ALLOWED_TASKS = [
        'checkSentence',
        'practicePrompts',
        'regenerateSeeds',
        'extractFromSentence',
        'extractFromText',
        'transcribe'
    ];
    if (!task || typeof task !== 'string' || !ALLOWED_TASKS.includes(task)) {
        return json(400, { error: '不支援的工作' });
    }

    const startTime = Date.now();
    try {
        let result: any;
        if (task === 'checkSentence') {
            if (
                !payload ||
                typeof payload.patternText !== 'string' ||
                typeof payload.userSentence !== 'string' ||
                payload.patternText.length < 1 ||
                payload.patternText.length > 500 ||
                payload.userSentence.length < 1 ||
                payload.userSentence.length > 500
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildCheckSentencePrompt(payload.patternText, payload.userSentence);
            const config = { temperature: 0.2 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            result = cleanAndParseJSON(text);
        } else if (task === 'practicePrompts') {
            if (
                !payload ||
                typeof payload.sentenceText !== 'string' ||
                typeof payload.patternText !== 'string' ||
                payload.sentenceText.length < 1 ||
                payload.sentenceText.length > 500 ||
                payload.patternText.length < 1 ||
                payload.patternText.length > 500
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildPracticePromptsPrompt(payload.sentenceText, payload.patternText);
            const config = { temperature: 0.3 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            result = cleanAndParseJSON(text);
        } else if (task === 'regenerateSeeds') {
            const pattern = payload?.pattern;
            const avoidSentences = payload?.avoidSentences;
            if (
                !pattern ||
                typeof pattern.text !== 'string' ||
                typeof pattern.meaningZh !== 'string' ||
                typeof pattern.usageContext !== 'string' ||
                typeof pattern.category !== 'string' ||
                pattern.text.length > 1000 ||
                pattern.meaningZh.length > 1000 ||
                pattern.usageContext.length > 1000 ||
                pattern.category.length > 1000 ||
                !Array.isArray(avoidSentences) ||
                avoidSentences.length > 300 ||
                !avoidSentences.every((s: any) => typeof s === 'string' && s.length <= 500)
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildRegenerateSeedsPrompt(pattern, avoidSentences);
            const config = { temperature: 0.8 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            const parsed = cleanAndParseJSON(text);
            if (!Array.isArray(parsed)) {
                throw new Error('產生的例句格式不正確，請再試一次');
            }
            const validExamples = parsed
                .filter(
                    (item: any) =>
                        item &&
                        typeof item.en === 'string' &&
                        typeof item.zh === 'string' &&
                        item.en.trim() !== '' &&
                        item.zh.trim() !== ''
                )
                .map((item: any) => ({
                    en: item.en.trim(),
                    zh: item.zh.trim()
                }));
            if (validExamples.length < 3) {
                throw new Error('產生的例句格式不正確，請再試一次');
            }
            result = { examples: validExamples };
        } else if (task === 'extractFromSentence') {
            if (
                !payload ||
                typeof payload.sentenceText !== 'string' ||
                typeof payload.sentenceTranslation !== 'string' ||
                payload.sentenceText.length < 1 ||
                payload.sentenceText.length > 1000 ||
                payload.sentenceTranslation.length > 1000
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildExtractFromSentencePrompt(payload.sentenceText, payload.sentenceTranslation);
            const config = { temperature: 0.2 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            try {
                const patterns = normalizePrimaryCategories(cleanAndParseJSON(text));
                result = { patterns };
            } catch (e: any) {
                throw new Error('解析語言模型句型失敗：' + e.message);
            }
        } else if (task === 'extractFromText') {
            if (
                !payload ||
                typeof payload.sourceText !== 'string' ||
                payload.sourceText.length < 1 ||
                payload.sourceText.length > 30000
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildExtractFromTextPrompt(payload.sourceText);
            const config = { temperature: 0.2 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            try {
                const patterns = normalizePrimaryCategories(cleanAndParseJSON(text));
                result = { patterns };
            } catch (e: any) {
                throw new Error('解析語言模型句型失敗：' + e.message);
            }
        } else if (task === 'transcribe') {
            if (
                !payload ||
                typeof payload.audioBase64 !== 'string' ||
                typeof payload.mimeType !== 'string' ||
                payload.audioBase64.length < 1 ||
                payload.audioBase64.length > 4000000 ||
                payload.mimeType.length < 1 ||
                payload.mimeType.length > 100
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const contents = [
                TRANSCRIBE_PROMPT,
                { inlineData: { mimeType: payload.mimeType.split(';')[0], data: payload.audioBase64 } }
            ];
            const config = {
                temperature: 0.1,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
            };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents, config })
            );
            if (!response.text) {
                throw new Error('Gemini API 回傳空內容');
            }
            result = { text: response.text.trim() };
        }

        return json(200, result);
    } catch (err: any) {
        const status = err?.status === 503 ? 503 : 500;
        return json(status, { error: err?.message || '未知錯誤' });
    } finally {
        console.log(`[ai-text] ${task} 總耗時 ${Date.now() - startTime}ms`);
    }
};
