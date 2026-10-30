import { expandContractions } from '../utils';
import { canonicalSpelling, COMPOUND_SPLITS } from './spellingVariants';

const levenshteinDistance = (a: string, b: string) => {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

export const calculateSimilarity = (str1: string, str2: string) => {
    if (!str1 || !str2) return 0;
    
    // Normalize: lowercase and remove special characters
    const s1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const s2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 100;

    // Use Levenshtein distance for better accuracy on short words
    const distance = levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    // Calculate similarity percentage
    const similarity = ((maxLength - distance) / maxLength) * 100;
    
    return Math.max(0, Math.min(100, Math.round(similarity)));
};

// ===== 【v3.11】單字比對（跟讀與句型練習共用）=====

export interface WordDiff {
    word: string;                                   // 原句的字（extra 時為使用者多念的字）
    type: 'ok' | 'missing' | 'wrong' | 'extra';
    said?: string;                                  // wrong 時使用者實際念的字
}

export interface WordComparison {
    targetCount: number;   // 原句正規化後的字數
    errors: number;        // 替換、漏念、多念各算 1 個錯
    contentScore: number;  // 依句子長短比例扣分，0～100
    diff: WordDiff[];
}

export interface PracticeScores {
    content: number;
    fluency: number;
    total: number;
    errors: number;
    targetCount: number;
    diff: WordDiff[];
}

const FILLER_WORDS = new Set(['um', 'uh', 'uhm', 'er', 'erm', 'hmm', 'mm']);
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const numberToWords = (n: number): string[] => {
    if (n < 20) return [ONES[n]];
    const words = [TENS[Math.floor(n / 10)]];
    if (n % 10) words.push(ONES[n % 10]);
    return words;
};

// 正規化：彎引號 → 縮寫展開（含轉小寫）→ 標點換成空白 → 0～99 數字轉英文 → 去掉口頭禪
export const normalizeForCompare = (text: string): string[] => {
    if (!text) return [];
    const expanded = expandContractions(text.replace(/[‘’]/g, "'"));
    const cleaned = expanded.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const words: string[] = [];
    for (const raw of cleaned.split(/\s+/)) {
        if (!raw) continue;
        if (/^\d{1,2}$/.test(raw)) {
            words.push(...numberToWords(parseInt(raw, 10)));
            continue;
        }
        if (FILLER_WORDS.has(raw)) continue;
        words.push(raw);
    }
    return words;
};

// ===== 【v3.11 補強】token 化：每個字是一組「可接受的寫法」，兩邊有交集就算相同 =====
// 規劃：docs/plans/scoring-normalize-fix.md

interface Token {
    alts: string[];          // 可接受的寫法（全小寫）
    src: number;             // 來自原文第幾個字（以空白切分）
    kind?: 'filler' | 'numAnd';
}

const NUMBER_WORDS = new Set([...ONES, ...TENS.filter(Boolean), 'hundred', 'thousand', 'million']);
// 's 後面接 is／has 的字（其他名詞後的 's 視為所有格）
const S_CONTRACTION_STEMS = new Set(['he', 'she', 'it', 'that', 'there', 'here', 'what', 'who', 'where', 'when', 'why', 'how',
    'this', 'everyone', 'everybody', 'everything', 'someone', 'somebody', 'something', 'nobody', 'nothing', 'no one']);
const DID_STEMS = new Set(['how', 'where', 'what', 'why', 'who', 'when']);
// 用 Map 查詢，避免 constructor、toString 等一般單字撞到物件內建屬性
const SPECIAL_CONTRACTIONS = new Map<string, string[][]>([
    ["won't", [['will'], ['not']]], ["can't", [['can'], ['not']]], ['cannot', [['can'], ['not']]],
    ["shan't", [['shall'], ['not']]], ["let's", [['let'], ['us']]],
]);
const SUFFIX_ALTS = new Map<string, string[]>([
    ["n't", ['not']], ["'m", ['am']], ["'re", ['are']], ["'ll", ['will']], ["'ve", ['have']],
]);

// 把一個字展開成「可接受寫法」的序列；複合縮寫（I'd've、wouldn't've）會對詞幹繼續展開
const expandWord = (w: string): string[][] => {
    const special = SPECIAL_CONTRACTIONS.get(w);
    if (special) return special;
    const m = w.match(/^(.+?)(n't|'m|'re|'ll|'ve|'d|'s)$/);
    if (!m) return [[w.replace(/'/g, '')]];
    const [, stem, suf] = m;
    if (suf === "'s") {
        if (!S_CONTRACTION_STEMS.has(stem)) return [[stem.replace(/'/g, '') + 's']];   // 所有格：照念（john's ＝ johns）
        return [...expandWord(stem), ['is', 'has']];
    }
    if (suf === "'d") return [...expandWord(stem), DID_STEMS.has(stem) ? ['would', 'had', 'did'] : ['would', 'had']];
    return [...expandWord(stem), SUFFIX_ALTS.get(suf) as string[]];
};
const MAX_INT = 999_999_999;
// 完整數值：可帶負號（前面不能緊接字母數字）、千分位或無逗號整數、小數；後面不能緊接數字或字母
const NUMBER_RE = /(?<![\w.,])(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d\w])/g;

const under1000 = (n: number): string[] => {
    const out: string[] = [];
    if (n >= 100) {
        out.push(ONES[Math.floor(n / 100)], 'hundred');
        n %= 100;
    }
    if (n > 0) out.push(...numberToWords(n));
    return out;
};

const integerToWords = (n: number): string[] => {
    if (n === 0) return ['zero'];
    const out: string[] = [];
    const millions = Math.floor(n / 1_000_000);
    const thousands = Math.floor((n % 1_000_000) / 1000);
    const rest = n % 1000;
    if (millions) out.push(...under1000(millions), 'million');
    if (thousands) out.push(...under1000(thousands), 'thousand');
    if (rest) out.push(...under1000(rest));
    return out;
};

const numberTokens = (neg: string | undefined, intPart: string, frac: string | undefined, src: number): Token[] => {
    const tokens: Token[] = [];
    if (neg) tokens.push({ alts: ['minus', 'negative'], src });
    const n = parseInt(intPart.replace(/,/g, ''), 10);
    const words = n <= MAX_INT ? integerToWords(n) : intPart.replace(/,/g, '').split('').map(d => ONES[+d]);
    tokens.push(...words.map(w => ({ alts: [w], src })));
    if (frac) {
        tokens.push({ alts: ['point'], src });
        tokens.push(...frac.slice(1).split('').map(d => ({ alts: [ONES[+d]], src })));
    }
    return tokens;
};

// 一般文字片段（不含數字）：處理縮寫、所有格、符號
const wordTokens = (segment: string, src: number, side: 'target' | 'user'): Token[] => {
    const tokens: Token[] = [];
    const cleaned = segment.replace(/&/g, ' and ').replace(/%/g, ' percent ').replace(/\be-mail/g, 'email');
    for (const raw of cleaned.split(/[^a-z0-9']+/)) {
        const w = raw.replace(/^'+|'+$/g, '');
        if (!w) continue;
        if (/\d/.test(w)) {
            tokens.push({ alts: [w.replace(/'/g, '')], src });   // 英數混合字（B12、1st、1990s）保留原樣比對
            continue;
        }
        const split = COMPOUND_SPLITS.get(w);
        if (split) {
            split.forEach(x => tokens.push({ alts: [x], src }));   // 合寫字（alright → all right）
            continue;
        }
        // 英美拼字換成同一種寫法（colour → color），原句與辨識結果兩邊都換
        const parts = expandWord(w).map(alts => alts.map(canonicalSpelling));
        if (parts.length === 1 && side === 'user' && FILLER_WORDS.has(parts[0][0])) {
            tokens.push({ alts: parts[0], src, kind: 'filler' });
            continue;
        }
        parts.forEach(alts => tokens.push({ alts, src }));
    }
    return tokens;
};

export const tokenizeForCompare = (text: string, side: 'target' | 'user'): { tokens: Token[]; words: string[] } => {
    const words = (text || '').replace(/[‘’ʼ`]/g, "'").replace(/[−–—\u2010\u2011]/g, '-').split(/\s+/).filter(Boolean);
    const tokens: Token[] = [];
    words.forEach((word, src) => {
        const lower = word.toLowerCase();
        let last = 0;
        for (const m of lower.matchAll(NUMBER_RE)) {
            tokens.push(...wordTokens(lower.slice(last, m.index), src, side));
            tokens.push(...numberTokens(m[1], m[2], m[3], src));
            last = (m.index ?? 0) + m[0].length;
        }
        tokens.push(...wordTokens(lower.slice(last), src, side));
    });
    // 數字念法中 hundred／thousand／million 之後、下一個數字字之前的 and 可有可無
    tokens.forEach((t, i) => {
        if (t.alts.length === 1 && t.alts[0] === 'and' && i > 0 && i < tokens.length - 1
            && ['hundred', 'thousand', 'million'].includes(tokens[i - 1].alts[0])
            && NUMBER_WORDS.has(tokens[i + 1].alts[0])) {
            t.kind = 'numAnd';
        }
    });
    return { tokens, words };
};

const same = (a: Token, b: Token) => a.alts.some(x => b.alts.includes(x));
const missingCost = (t: Token) => (t.kind === 'numAnd' ? 0 : 1);
const extraCost = (u: Token) => (u.kind ? 0 : 1);   // 使用者多念的口頭禪、數字中的 and 不算錯
const displayWord = (w: string) => w.replace(/^[(\[“"]+/, '').replace(/[)\]”".,!?;:]+$/, '') || w;

export const compareWords = (userText: string, targetText: string): WordComparison => {
    const target = tokenizeForCompare(targetText, 'target');
    const user = tokenizeForCompare(userText, 'user');
    const t = target.tokens;
    // 語音辨識異常輸出（例如重複幻覺）時截斷，避免大量計算；被截掉的部分本來就是錯的
    const u = user.tokens.slice(0, t.length * 3 + 20);
    const n = t.length;
    const m = u.length;

    // dp[i][j]：原句前 i 個 token 與使用者前 j 個 token 的最少錯誤數
    const dp: number[][] = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) dp[i][0] = dp[i - 1][0] + missingCost(t[i - 1]);
    for (let j = 1; j <= m; j++) dp[0][j] = dp[0][j - 1] + extraCost(u[j - 1]);
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j - 1] + (same(t[i - 1], u[j - 1]) ? 0 : 1),
                dp[i - 1][j] + missingCost(t[i - 1]),
                dp[i][j - 1] + extraCost(u[j - 1])
            );
        }
    }

    // 回溯：token 層級的結果（依原句順序）
    type Op = { kind: 'ok' | 'wrong' | 'missing'; ti: number; uj?: number } | { kind: 'extra'; uj: number };
    const ops: Op[] = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && same(t[i - 1], u[j - 1]) && dp[i][j] === dp[i - 1][j - 1]) {
            ops.push({ kind: 'ok', ti: i - 1, uj: j - 1 }); i--; j--;
        } else if (i > 0 && j > 0 && !same(t[i - 1], u[j - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) {
            ops.push({ kind: 'wrong', ti: i - 1, uj: j - 1 }); i--; j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + missingCost(t[i - 1])) {
            if (t[i - 1].kind !== 'numAnd') ops.push({ kind: 'missing', ti: i - 1 });
            i--;
        } else {
            if (!u[j - 1].kind) ops.push({ kind: 'extra', uj: j - 1 });
            j--;
        }
    }
    ops.reverse();

    // 以原句的字為單位顯示（一個原字展開成多個 token 時，任一 token 錯就整個原字標錯）
    const diff: WordDiff[] = [];
    const userWordsOf = (ujs: number[]) => [...new Set(ujs.map(x => u[x].src))].map(s => displayWord(user.words[s])).join(' ');
    let k = 0;
    while (k < ops.length) {
        const op = ops[k];
        if (op.kind === 'extra') {
            const ujs = [op.uj];
            while (k + 1 < ops.length && ops[k + 1].kind === 'extra' && u[(ops[k + 1] as { uj: number }).uj].src === u[op.uj].src) {
                ujs.push((ops[++k] as { uj: number }).uj);
            }
            diff.push({ word: userWordsOf(ujs), type: 'extra' });
            k++;
            continue;
        }
        const src = t[op.ti].src;
        const group: Op[] = [];
        // 同一個原字的 token，以及夾在其中的多念字
        while (k < ops.length) {
            const o = ops[k];
            if (o.kind !== 'extra' && t[o.ti].src !== src) break;
            if (o.kind === 'extra') {
                const nextTarget = ops.slice(k + 1).find(x => x.kind !== 'extra') as { ti: number } | undefined;
                if (!nextTarget || t[nextTarget.ti].src !== src) break;
            }
            group.push(o);
            k++;
        }
        const word = displayWord(targetText.replace(/[‘’ʼ`]/g, "'").split(/\s+/).filter(Boolean)[src] ?? '');
        if (group.every(g => g.kind === 'ok')) {
            diff.push({ word, type: 'ok' });
        } else {
            const said = group.filter(g => g.uj !== undefined).map(g => g.uj as number);
            diff.push(said.length ? { word, type: 'wrong', said: userWordsOf(said) } : { word, type: 'missing' });
        }
    }

    const errors = dp[n][m];
    const counted = t.filter(x => x.kind !== 'numAnd').length;
    const contentScore = counted === 0
        ? (m === 0 || errors === 0 ? 100 : 0)
        : Math.max(0, Math.round(((counted - errors) / counted) * 100));
    return { targetCount: counted, errors, contentScore, diff };
};

// 句型練習（精準背出原句）：一字不差才累加熟練度
export const canAccumulatePattern = (scores: { errors: number }) => scores.errors === 0;

const combineTotal = (content: number, fluency: number) => Math.round(content * 0.7 + fluency * 0.3);

// 語言模型句型練習：精準背出原句（errors === 0 才累加熟練度，判斷在呼叫端）
export const calculateFinalScores = (userText: string, targetText: string, durationSec: number): PracticeScores => {
    const cmp = compareWords(userText || '', targetText);
    const base = { errors: cmp.errors, targetCount: cmp.targetCount, diff: cmp.diff };
    if (!userText || userText.trim().length === 0) {
        return { content: 0, fluency: 0, total: 0, ...base };
    }
    const content = cmp.contentScore;

    const targetWordCount = targetText.split(/\s+/).length;
    const userWordCount = userText.split(/\s+/).length;

    let fluencyScore = 100;
    if (targetWordCount <= 1) {
        fluencyScore = content > 60 ? 100 : 50;
    } else {
        const idealMinTime = targetWordCount * 0.4;
        const idealMaxTime = targetWordCount * 0.8 + 1.5;
        if (durationSec > idealMaxTime) fluencyScore -= (durationSec - idealMaxTime) * 10;
        else if (durationSec < idealMinTime) fluencyScore -= (idealMinTime - durationSec) * 20;
        fluencyScore = Math.round(fluencyScore * Math.min(1, userWordCount / targetWordCount));
    }
    fluencyScore = Math.max(0, Math.min(100, fluencyScore));

    return { content, fluency: fluencyScore, total: combineTotal(content, fluencyScore), ...base };
};

// 影子跟讀：內容 ≥ 70 且總分 ≥ 70 才累加熟練度（判斷在呼叫端，見 isShadowingPass）
export const calculateShadowingScores = (userText: string, targetText: string, userSpeechSec: number, originalSec: number): PracticeScores => {
    const cmp = compareWords(userText || '', targetText);
    const base = { errors: cmp.errors, targetCount: cmp.targetCount, diff: cmp.diff };
    if (!userText || userText.trim().length === 0) {
        return { content: 0, fluency: 0, total: 0, ...base };
    }
    const content = cmp.contentScore;

    const targetWordCount = targetText.split(/\s+/).length;
    const userWordCount = userText.split(/\s+/).length;

    let fluencyScore = 100;
    if (targetWordCount <= 1 || originalSec <= 0) {
        fluencyScore = content > 60 ? 100 : 50;
    } else {
        // 跟讀流暢度：使用者實際講話時間 ÷ 原音長度，90%～130% 為滿分
        const ratio = userSpeechSec / originalSec;
        if (ratio < 0.9) fluencyScore = 100 - (0.9 - ratio) * 200;
        else if (ratio > 1.3) fluencyScore = 100 - (ratio - 1.3) * 150;
        fluencyScore = Math.round(fluencyScore * Math.min(1, userWordCount / targetWordCount));
    }
    fluencyScore = Math.max(0, Math.min(100, fluencyScore));

    return { content, fluency: fluencyScore, total: combineTotal(content, fluencyScore), ...base };
};

export const SHADOWING_PASS_CONTENT = 70;
export const SHADOWING_PASS_TOTAL = 70;

export const isShadowingPass = (scores: { content: number; total: number }) =>
    scores.content >= SHADOWING_PASS_CONTENT && scores.total >= SHADOWING_PASS_TOTAL;
