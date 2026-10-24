import { ThinkingLevel } from '@google/genai';
import { verifyRealUser } from '../shared/auth';
import { callGeminiFreeThenPaid, callQualityText } from '../shared/aiKeys';
import {
    buildCheckSentencePrompt,
    buildPracticePromptsPrompt,
    buildRegenerateSeedsPrompt,
    buildExtractFromSentencePrompt,
    buildExtractFromTextPrompt,
    buildClassifyPatternsPrompt,
    buildSegmentMaterialPrompt,
    buildReviewRetellPrompt,
    normalizePrimaryCategories,
    TRANSCRIBE_PROMPT,
    cleanAndParseJSON
} from '../shared/prompts';

const json = (status: number, body: Record<string, any>) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 造句檢查用：把句子拆成小寫單字（忽略標點）
const toWords = (s: string): string[] =>
    s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);

const sameWords = (a: string, b: string): boolean => toWords(a).join(' ') === toWords(b).join(' ');

// 修改範圍：建議句與原句相同的單字（依順序）佔一半以上＝部分調整，否則＝整句重寫
function revisionScope(original: string, revised: string): 'partial' | 'whole' {
    const a = toWords(original);
    const b = toWords(revised);
    if (a.length === 0 || b.length === 0) return 'whole';
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length] / Math.max(a.length, b.length) >= 0.5 ? 'partial' : 'whole';
}

// 萃取結果整理：只保留格式正確的項目，最多 max 個；沒有值得萃取的句型時回傳空陣列
function normalizeExtractedPatterns(parsed: any, max: number): any[] {
    if (!Array.isArray(parsed)) {
        throw new Error('回傳格式不是陣列');
    }
    const strList = (v: any, maxLen: number) => (Array.isArray(v) ? v : [])
        .filter((x: any) => typeof x === 'string' && x.trim())
        .map((x: string) => x.trim().slice(0, maxLen));
    const items = parsed
        .filter((p: any) => p && ['structural', 'phrase', 'collocation'].includes(p.category) && typeof p.text === 'string' && p.text.trim())
        .slice(0, max)
        .map((p: any) => ({
            category: p.category,
            text: p.text.trim().slice(0, 300),
            meaningZh: String(p.meaningZh || '').trim().slice(0, 500),
            usageContext: String(p.usageContext || '').trim().slice(0, 1000),
            primaryCategory: p.primaryCategory,
            situationTags: strList(p.situationTags, 30).slice(0, 8),
            seedExamples: (Array.isArray(p.seedExamples) ? p.seedExamples : [])
                .filter((e: any) => e && typeof e.en === 'string' && e.en.trim() && typeof e.zh === 'string')
                .map((e: any) => ({ en: e.en.trim().slice(0, 500), zh: e.zh.trim().slice(0, 500) }))
                .slice(0, 10)
        }));
    return normalizePrimaryCategories(items);
}

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
        'transcribe',
        'classifyPatterns',
        'segmentMaterial',
        'reviewRetell'
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
            const text = await callQualityText(task, prompt, config.temperature);
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            const parsed = cleanAndParseJSON(text);
            // 整理格式：三項判斷一律是布林值；沒有建議時不回傳建議欄位（不可出現 undefined 或空字串）
            let revision = typeof parsed?.suggestedRevision === 'string' ? parsed.suggestedRevision.trim().slice(0, 500) : '';
            // 建議跟原句只差標點或大小寫時，視為沒有建議
            if (revision && sameWords(revision, payload.userSentence)) {
                revision = '';
            }
            const revisionNotes = (Array.isArray(parsed?.revisionNotes) ? parsed.revisionNotes : [])
                .filter((n: any) => typeof n === 'string' && n.trim())
                .map((n: string) => n.trim().slice(0, 300))
                .slice(0, 3);
            result = {
                natural: parsed?.natural === true,
                grammar: parsed?.grammar === true,
                spelling: parsed?.spelling === true,
                comment: String(parsed?.comment || '').trim().slice(0, 1000),
                ...(revision ? {
                    suggestedRevision: revision,
                    // 修改範圍由程式依單字差異判斷，不採用 AI 的判斷
                    suggestedRevisionScope: revisionScope(payload.userSentence, revision),
                    ...(revisionNotes.length > 0 ? { revisionNotes } : {})
                } : {})
            };
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
            const text = await callQualityText(task, prompt, config.temperature);
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
            const text = await callQualityText(task, prompt, config.temperature);
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
                payload.sentenceTranslation.length > 1000 ||
                (payload.existingPatterns !== undefined && (
                    !Array.isArray(payload.existingPatterns) ||
                    payload.existingPatterns.length > 20 ||
                    !payload.existingPatterns.every((t: any) => typeof t === 'string' && t.length >= 1 && t.length <= 300)
                ))
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildExtractFromSentencePrompt(payload.sentenceText, payload.sentenceTranslation, payload.existingPatterns || []);
            const config = { temperature: 0.2 };
            const text = await callQualityText(task, prompt, config.temperature);
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            try {
                const patterns = normalizeExtractedPatterns(cleanAndParseJSON(text), 3);
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
                const patterns = normalizeExtractedPatterns(cleanAndParseJSON(text), 12);
                result = { patterns };
            } catch (e: any) {
                throw new Error('解析語言模型句型失敗：' + e.message);
            }
        } else if (task === 'classifyPatterns') {
            const candidates = payload?.candidates;
            const existing = payload?.existing;
            if (
                !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 50 ||
                !Array.isArray(existing) || existing.length > 2000 ||
                !candidates.every((c: any) => c && typeof c.text === 'string' && c.text.length >= 1 && c.text.length <= 300 && typeof c.meaningZh === 'string' && c.meaningZh.length <= 500) ||
                !existing.every((e: any) => e && typeof e.id === 'string' && e.id.length >= 1 && e.id.length <= 100 && typeof e.text === 'string' && e.text.length <= 300 && typeof e.meaningZh === 'string' && e.meaningZh.length <= 500)
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildClassifyPatternsPrompt(candidates, existing);
            const config = { temperature: 0.1 };
            const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                ai.models.generateContent({ model, contents: prompt, config })
            );
            const text = response.text;
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            const parsed = cleanAndParseJSON(text);
            const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
            const existingIds = new Set(existing.map((e: any) => e.id));
            // 逐筆檢查 AI 回傳的關係，對不上的一律視為新的
            const results = candidates.map((_: any, i: number) => {
                const r = rawResults.find((x: any) => x && x.index === i);
                const relation = r?.relation;
                if ((relation === 'duplicate' || relation === 'variant' || relation === 'synonym') && typeof r.matchId === 'string' && existingIds.has(r.matchId)) {
                    return { index: i, relation, matchId: r.matchId };
                }
                if (relation === 'duplicate' && Number.isInteger(r.matchCandidateIndex) && r.matchCandidateIndex >= 0 && r.matchCandidateIndex < i) {
                    return { index: i, relation, matchCandidateIndex: r.matchCandidateIndex };
                }
                return { index: i, relation: 'new' };
            });
            result = { results };
        } else if (task === 'segmentMaterial') {
            const sentences = payload?.sentences;
            if (
                !Array.isArray(sentences) || sentences.length < 1 || sentences.length > 400 ||
                !sentences.every((s: any) => typeof s === 'string' && s.length >= 1 && s.length <= 1000)
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const n = sentences.length;
            // AI 結果不合規則時，改為每 8 句一段
            const fallbackSegments = () => {
                const segs: { title: string; start: number; end: number }[] = [];
                for (let s = 0; s < n; s += 8) {
                    segs.push({ title: `第 ${segs.length + 1} 段`, start: s, end: Math.min(n - 1, s + 7) });
                }
                return segs;
            };
            let segments = fallbackSegments();
            if (n >= 3) {
                const prompt = buildSegmentMaterialPrompt(sentences);
                const config = { temperature: 0.2 };
                const response = await callGeminiFreeThenPaid(task, (ai, model) =>
                    ai.models.generateContent({ model, contents: prompt, config })
                );
                const text = response.text;
                if (!text) {
                    throw new Error('無法從 Gemini 取得內容');
                }
                const parsed = cleanAndParseJSON(text);
                const raw = (Array.isArray(parsed?.segments) ? parsed.segments : [])
                    .filter((x: any) => x && Number.isInteger(x.start) && Number.isInteger(x.end))
                    .map((x: any) => ({ title: String(x.title || '').trim().slice(0, 30), start: x.start, end: x.end }))
                    .sort((a: any, b: any) => a.start - b.start);
                let expected = 0;
                let valid = raw.length > 0;
                for (const seg of raw) {
                    if (seg.start !== expected || seg.end < seg.start || seg.end >= n) {
                        valid = false;
                        break;
                    }
                    expected = seg.end + 1;
                }
                if (valid && expected === n) {
                    segments = raw.map((seg: any, i: number) => ({ ...seg, title: seg.title || `第 ${i + 1} 段` }));
                }
            } else {
                segments = [{ title: '第 1 段', start: 0, end: n - 1 }];
            }
            result = { segments };
        } else if (task === 'reviewRetell') {
            const segmentText = payload?.segmentText;
            const transcript = payload?.transcript;
            const targetPatterns = payload?.targetPatterns;
            if (
                typeof segmentText !== 'string' || segmentText.length < 1 || segmentText.length > 8000 ||
                typeof transcript !== 'string' || transcript.trim().length < 1 || transcript.length > 5000 ||
                !Array.isArray(targetPatterns) || targetPatterns.length > 5 ||
                !targetPatterns.every((p: any) => p && typeof p.id === 'string' && p.id.length >= 1 && p.id.length <= 100 && typeof p.text === 'string' && p.text.length <= 300 && typeof p.meaningZh === 'string' && p.meaningZh.length <= 500)
            ) {
                return json(400, { error: '輸入格式不正確' });
            }
            const prompt = buildReviewRetellPrompt(segmentText, transcript, targetPatterns);
            const config = { temperature: 0.3 };
            const text = await callQualityText(task, prompt, config.temperature);
            if (!text) {
                throw new Error('無法從 Gemini 取得內容');
            }
            const parsed = cleanAndParseJSON(text);
            const strList = (v: any, max: number) => (Array.isArray(v) ? v : [])
                .filter((x: any) => typeof x === 'string' && x.trim())
                .map((x: string) => x.trim().slice(0, 300))
                .slice(0, max);
            const clampScore = (v: any) => {
                const num = Math.round(Number(v));
                return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0;
            };
            const corrections = (Array.isArray(parsed?.corrections) ? parsed.corrections : [])
                .filter((c: any) => c && typeof c.original === 'string' && typeof c.better === 'string' && c.better.trim())
                .map((c: any) => ({
                    original: c.original.trim().slice(0, 300),
                    better: c.better.trim().slice(0, 300),
                    note: String(c.note || '').trim().slice(0, 300)
                }))
                .slice(0, 5);
            // 每個建議句型都要有一筆；AI 沒回或狀態不合法的一律視為沒用到
            const rawUsage = Array.isArray(parsed?.patternUsage) ? parsed.patternUsage : [];
            const patternUsage = targetPatterns.map((p: any) => {
                const u = rawUsage.find((x: any) => x && x.id === p.id);
                const status = ['correct', 'incorrect', 'unused'].includes(u?.status) ? u.status : 'unused';
                return { id: p.id, status, note: String(u?.note || '').trim().slice(0, 300) };
            });
            result = {
                coverage: {
                    covered: strList(parsed?.coverage?.covered, 8),
                    missed: strList(parsed?.coverage?.missed, 4)
                },
                corrections,
                patternUsage,
                modelAnswer: String(parsed?.modelAnswer || '').trim().slice(0, 600),
                comment: String(parsed?.comment || '').trim().slice(0, 600),
                contentScore: clampScore(parsed?.contentScore),
                languageScore: clampScore(parsed?.languageScore)
            };
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
