// 語言模型練習的題目（v2）：中文情境＋完整中文意思＋句型，依熟練度漸進撤除提示
// 規劃：docs/plans/practice-prompt-design.md

import { compareWords, canAccumulatePattern } from './scoring';
import type { PatternExampleSentence } from '../types';

export const CUE_VERSION = 2;

export interface PracticeCue {
    situationZh: string;
    meaningZh: string;
    partnerLineEn?: string;   // 熟練度 500 以上：對方用英文說的一句話（你的回答就是原句）
    meaningEn?: string;       // 熟練度 500 以上：英文改寫的意思（不用原句的用字與句型）
}

// 沒有新版題目（舊題目、或欄位不完整）→ 練習前要重新產生
export const needsNewCue = (s: Partial<PatternExampleSentence> | undefined): boolean =>
    !s || (s.cueVersion ?? 0) < CUE_VERSION || !s.meaningZh?.trim();

// 依熟練度決定顯示哪些提示（擁有者 2026-10-31 定案）：
// < 400 中文情境＋中文意思＋句型；400～499 中文意思＋句型；500～699 英文（對方的話＋英文改寫）＋句型；≥ 700 英文，句型藏在「看提示」
// 沒有可用的英文題目時，500 以上仍用中文
export const cueDisplay = (mastery: number, hasEnglish: boolean): { lang: 'zh' | 'en'; situation: boolean; pattern: boolean } => ({
    lang: hasEnglish && mastery >= 500 ? 'en' : 'zh',
    situation: mastery < 400,
    pattern: mastery < 700,
});

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

// 句型拆成有順序的片段：佔位（...、[someone]、sb／sth、+ V 等）是片段之間的間隔
// 例：so ... that ... → [so] [that]；not only ... but also → [not only] [but also]
const PLACEHOLDER = new Set(['sb', 'sth', 'somebody', 'something', 'someone', "one's", 'do', 'doing', 'v', 'ving', 'n', 'adj', 'adv', 'noun', 'verb', 'clause']);
const patternSegments = (patternText: string): string[][] => {
    const marked = (patternText || '').toLowerCase()
        .replace(/\[[^\]]*\]|\([^)]*\)|\.{2,}|…|\+|\/|=/g, ' | ');
    const segments: string[][] = [];
    let cur: string[] = [];
    for (const tok of marked.split(/\s+/)) {
        const w = tok.replace(/[^a-z'|]/g, '');
        if (!w) continue;
        if (w === '|' || PLACEHOLDER.has(w)) {
            if (cur.length) segments.push(cur);
            cur = [];
        } else {
            cur.push(w);
        }
    }
    if (cur.length) segments.push(cur);
    return segments;
};

// 句子是否依序用到句型的每個片段（片段內要連續，片段之間可以隔其他字）
const usesPattern = (text: string, patternText: string): boolean => {
    const segments = patternSegments(patternText);
    if (segments.length === 0) return false;
    const words = text.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
    let from = 0;
    for (const seg of segments) {
        let found = -1;
        for (let i = from; i + seg.length <= words.length; i++) {
            if (seg.every((w, k) => words[i + k] === w)) { found = i; break; }
        }
        if (found < 0) return false;
        from = found + seg.length;
    }
    return true;
};

// 英文題目可不可用：要有對方的話與英文改寫、都是英文、改寫和原句差夠多、沒有直接用句型
export const englishCueUsable = (cue: PracticeCue, sentenceText: string, patternText: string): boolean => {
    const partner = cue.partnerLineEn?.trim() || '';
    const meaning = cue.meaningEn?.trim() || '';
    if (!partner || !meaning || CJK.test(partner) || CJK.test(meaning)) return false;
    const cmp = compareWords(meaning, sentenceText);
    if (cmp.errors < Math.max(2, Math.ceil(cmp.targetCount * 0.4))) return false;   // 太接近原句，等於給答案
    if (usesPattern(meaning, patternText)) return false;   // 直接用了句型
    return true;
};

// 看過單字提示時，這次作答不加熟練度（也不算維持複習背出）
export const canAccumulateWithHint = (scores: { errors: number }, usedWordHint: boolean) =>
    canAccumulatePattern(scores) && !usedWordHint;

// 單字提示：原句的單字（去掉前後標點，保留撇號），以固定方式打亂，確保和原句順序不同
export const buildWordBank = (text: string): string[] => {
    const words = (text || '').split(/\s+/)
        .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean);
    if (words.length < 2) return words;
    // 以句子內容當種子的簡單亂數，同一句每次結果相同
    let seed = 0;
    for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    const out = [...words];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.join(' ') === words.join(' ')) out.push(out.shift() as string);   // 剛好和原句一樣時轉一格
    return out;
};

// 產生題目＋品質檢查：另一個 AI 只看題目說出英文，和原句一字不差才算通過；最多 2 輪，仍不通過照樣使用
export const createVerifiedCue = async (opts: {
    sentenceText: string;
    generate: () => Promise<PracticeCue>;
    check: (cue: PracticeCue) => Promise<string>;
    maxRounds?: number;
}): Promise<PracticeCue & { cueVerified: boolean }> => {
    const { sentenceText, generate, check, maxRounds = 2 } = opts;
    let best: PracticeCue | null = null;
    for (let round = 0; round < maxRounds; round++) {
        let cue: PracticeCue;
        try {
            cue = await generate();
        } catch (e) {
            if (!best) throw e;   // 第一輪就失敗 → 交給呼叫端顯示錯誤
            break;                // 之後失敗 → 用上一輪的題目
        }
        best = cue;
        let answer: string;
        try {
            answer = await check(cue);
        } catch {
            break;                // 檢查失敗 → 題目照樣使用，標成未驗證
        }
        if (answer && compareWords(answer, sentenceText).errors === 0) return { ...cue, cueVerified: true };
    }
    return { ...(best as PracticeCue), cueVerified: false };
};

// 寫入新題目：保留其他欄位，移除舊版題目欄位；沒有可用的英文題目時不存英文欄位
export const applyCueToSentence = (
    s: PatternExampleSentence,
    cue: PracticeCue & { cueVerified: boolean }
): PatternExampleSentence => {
    const { qaQuestion: _q, situationalPrompt: _p, partnerLineEn: _pl, meaningEn: _me, ...rest } = s;
    const next: PatternExampleSentence = { ...rest, situationZh: cue.situationZh, meaningZh: cue.meaningZh, cueVerified: cue.cueVerified, cueVersion: CUE_VERSION };
    if (cue.partnerLineEn && cue.meaningEn) {
        next.partnerLineEn = cue.partnerLineEn;
        next.meaningEn = cue.meaningEn;
    }
    return next;
};
