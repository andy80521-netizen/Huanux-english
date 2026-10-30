// 練習題目（v2）的後端輸入檢查與輸出整理
// 規劃：docs/plans/practice-prompt-design.md

const MAX = 500;
const okText = (v: unknown, max = MAX) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export const validCuePayload = (p: any): boolean =>
    !!p && okText(p.sentenceText) && okText(p.patternText);

export const validCueCheckPayload = (p: any): boolean =>
    !!p && typeof p.situationZh === 'string' && p.situationZh.length <= 1000
    && okText(p.meaningZh, 1000) && okText(p.patternText);

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const englishField = (v: unknown) => (typeof v === 'string' && !CJK.test(v) ? v.trim().slice(0, MAX) : '');

export const sanitizePracticeCue = (parsed: any): { situationZh: string; meaningZh: string; partnerLineEn?: string; meaningEn?: string } | null => {
    const situationZh = typeof parsed?.situationZh === 'string' ? parsed.situationZh.trim().slice(0, MAX) : '';
    const meaningZh = typeof parsed?.meaningZh === 'string' ? parsed.meaningZh.trim().slice(0, MAX) : '';
    if (!situationZh || !meaningZh) return null;
    if (parsed?.partnerLineEn === undefined && parsed?.meaningEn === undefined) return { situationZh, meaningZh };
    return { situationZh, meaningZh, partnerLineEn: englishField(parsed?.partnerLineEn), meaningEn: englishField(parsed?.meaningEn) };
};

// 品質檢查的回答：只取第一行、去掉前後引號
export const sanitizeCueCheckAnswer = (text: string): string => {
    const first = (text || '').trim().split(/\r?\n/)[0] || '';
    return first.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim().slice(0, MAX);
};
