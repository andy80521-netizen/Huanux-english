// 句子全面解析（前端純函式）：快取新舊、前後句、文件 ID、寫入前檢查、刪除計畫
// 規劃：docs/plans/sentence-analysis.md（擁有者 2026-11-13 核准）

/** 解析格式版本：必須與 netlify/shared/sentenceAnalysis.ts 相同（測試比對，docs/plans/review-fixes-50-51.md #7） */
export const ANALYSIS_VERSION = 1;

/** 與 netlify/shared/sentenceAnalysis.ts 的 SentenceAnalysis 相同（前後端分開建置，各自宣告） */
export interface SentenceAnalysis {
    overview: string;
    chunks: string[];
    structure: { main: string; parts: Array<{ text: string; role: string }> } | null;
    grammar: Array<{ point: string; explanation: string }>;
    vocabulary: Array<{ word: string; pos: string; meaning: string; collocation: string }>;
    patterns: Array<{ category: 'structural' | 'phrase' | 'collocation'; text: string; meaningZh: string; usage: string; examples: Array<{ en: string; zh: string }> }>;
    pronunciation: string[];
}

/** 存在 sentenceAnalyses 的一筆：除了解析，也記下解析當下的輸入（判斷要不要重新解析） */
export interface SentenceAnalysisRecord {
    materialId: string;
    sentenceId: string;
    text: string;
    translation: string;
    prevText: string;
    nextText: string;
    version: number;
    model: string;
    createdAt: number;
    analysis: SentenceAnalysis;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 意群保留完整的原句切片：不逐段截斷（審查第 1 輪 Codex）；非字串項目丟掉；總長超過原句上限 → 整段不顯示 */
function sanitizeChunks(v: unknown): string[] {
    const list = arr(v).filter((c): c is string => typeof c === 'string' && c.trim() !== '').slice(0, 8);
    const total = list.reduce((n, c) => n + c.length + 1, 0);
    return total <= 1001 ? list : [];
}

/**
 * 讀出存檔後先整理成安全格式（docs/plans/review-fixes-50-51.md #2）：
 * 非陣列當空、字串截斷、不合格的項目丟掉；保留已存的意群（不重新切）。沒有「一句話看懂」→ null（當作沒有解析）
 */
export function sanitizeStoredAnalysis(raw: unknown): SentenceAnalysis | null {
    if (!isObj(raw)) return null;
    const overview = str(raw.overview, 400);
    if (!overview) return null;
    let structure: SentenceAnalysis['structure'] = null;
    if (isObj(raw.structure) && str(raw.structure.main, 300)) {
        structure = {
            main: str(raw.structure.main, 300),
            parts: arr(raw.structure.parts).filter(isObj).map(p => ({ text: str(p.text, 200), role: str(p.role, 200) })).filter(p => p.text && p.role).slice(0, 3),
        };
    }
    return {
        overview,
        chunks: sanitizeChunks(raw.chunks),
        structure,
        grammar: arr(raw.grammar).filter(isObj).map(g => ({ point: str(g.point, 80), explanation: str(g.explanation, 300) })).filter(g => g.point && g.explanation).slice(0, 3),
        vocabulary: arr(raw.vocabulary).filter(isObj)
            .map(v => ({ word: str(v.word, 60), pos: str(v.pos, 20), meaning: str(v.meaning, 120), collocation: str(v.collocation, 120) }))
            .filter(v => v.word && v.meaning).slice(0, 4),
        patterns: arr(raw.patterns).filter(isObj)
            .filter(p => p.category === 'structural' || p.category === 'phrase' || p.category === 'collocation')
            .map(p => ({
                category: p.category as 'structural' | 'phrase' | 'collocation',
                text: str(p.text, 200),
                meaningZh: str(p.meaningZh, 200),
                usage: str(p.usage, 300),
                examples: arr(p.examples).filter(isObj).map(e => ({ en: str(e.en, 300), zh: str(e.zh, 300) })).filter(e => e.en && e.zh).slice(0, 2),
            }))
            .filter(p => p.text && p.meaningZh).slice(0, 3),
        pronunciation: arr(raw.pronunciation).map(x => str(x, 200)).filter(Boolean).slice(0, 3),
    };
}

export type AnalysisInput = Pick<SentenceAnalysisRecord, 'text' | 'translation' | 'prevText' | 'nextText'>;

/**
 * stale：原句不同或格式版本較舊（仍顯示舊內容＋「重新解析」）；
 * contextChanged：只有翻譯或前後句不同（小字「可重新解析」）；fresh：都相同
 */
export function analysisFreshness(
    rec: Pick<SentenceAnalysisRecord, 'text' | 'translation' | 'prevText' | 'nextText' | 'version'>,
    cur: AnalysisInput,
    currentVersion: number,
): 'fresh' | 'stale' | 'contextChanged' {
    if (rec.text !== cur.text || !(Number(rec.version) >= currentVersion)) return 'stale';
    if ((rec.translation ?? '') !== (cur.translation ?? '') || (rec.prevText ?? '') !== (cur.prevText ?? '') || (rec.nextText ?? '') !== (cur.nextText ?? '')) {
        return 'contextChanged';
    }
    return 'fresh';
}

/** 前後最近的未刪除句子（只給 AI 理解代名詞與省略） */
export function neighborTexts(sentences: Array<{ text: string; deleted?: boolean }>, index: number): { prevText: string; nextText: string } {
    let prevText = '';
    let nextText = '';
    for (let i = index - 1; i >= 0; i--) if (!sentences[i]?.deleted) { prevText = sentences[i].text || ''; break; }
    for (let i = index + 1; i < sentences.length; i++) if (!sentences[i]?.deleted) { nextText = sentences[i].text || ''; break; }
    return { prevText, nextText };
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

/** 文件 ID：{materialId}__{sentenceId}；教材 ID 不可含 __（避免撞車），兩者都不可含 / */
export function analysisDocId(materialId: string, sentenceId: string): string {
    if (!ID_RE.test(materialId || '') || materialId.includes('__') || !ID_RE.test(sentenceId || '')) {
        throw new Error('教材或句子編號格式不正確');
    }
    return `${materialId}__${sentenceId}`;
}

/** 交易內讀到的教材 → 能不能寫入解析（擋住「解析中教材被刪、句子被刪或改字」的晚到寫入） */
export function decideAnalysisWrite(
    material: { sentences?: Array<{ id: string; text: string; deleted?: boolean }> } | null | undefined,
    sentenceId: string,
    text: string,
): 'ok' | 'missing-material' | 'missing-sentence' | 'changed' {
    if (!material) return 'missing-material';
    const s = (material.sentences || []).find(x => x.id === sentenceId);
    if (!s || s.deleted) return 'missing-sentence';
    if (s.text !== text) return 'changed';
    return 'ok';
}

/** 同一筆交易最多刪幾份解析（加上教材本身；保守低於 Firestore 單次寫入上限 500） */
export const ANALYSIS_TX_MAX = 450;

/** 刪除教材：句數不多時教材與每句的解析在同一筆交易刪除；太多時教材刪除成功後再分批刪 */
export function planMaterialDelete(materialId: string, sentenceIds: string[]): { inTransaction: boolean; analysisIds: string[] } {
    const analysisIds = [...new Set(sentenceIds)].filter(id => ID_RE.test(id || '')).map(id => analysisDocId(materialId, id));
    return { inTransaction: analysisIds.length <= ANALYSIS_TX_MAX, analysisIds };
}
