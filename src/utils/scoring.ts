import { expandContractions } from '../utils';

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

export const compareWords = (userText: string, targetText: string): WordComparison => {
    const t = normalizeForCompare(targetText);
    const u = normalizeForCompare(userText);
    const n = t.length;
    const m = u.length;

    // dp[i][j]：原句前 i 字與使用者前 j 字的最少錯誤數
    const dp: number[][] = [];
    for (let i = 0; i <= n; i++) {
        dp.push(new Array(m + 1).fill(0));
        dp[i][0] = i;
    }
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (t[i - 1] === u[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
            }
        }
    }

    // 回溯產生逐字結果（依原句順序）
    const diff: WordDiff[] = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && t[i - 1] === u[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
            diff.push({ word: t[i - 1], type: 'ok' });
            i--; j--;
        } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
            diff.push({ word: t[i - 1], type: 'wrong', said: u[j - 1] });
            i--; j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            diff.push({ word: t[i - 1], type: 'missing' });
            i--;
        } else {
            diff.push({ word: u[j - 1], type: 'extra' });
            j--;
        }
    }
    diff.reverse();

    const errors = dp[n][m];
    const contentScore = n === 0
        ? (m === 0 ? 100 : 0)
        : Math.max(0, Math.round(((n - errors) / n) * 100));
    return { targetCount: n, errors, contentScore, diff };
};

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
