// 方案 D：用 Whisper 每個字的時間切句（只供離線對照，不接正式匯入流程）
// 規劃：docs/plans/timestamp-baseline.md（擁有者 2026-11-12 核准；規格附錄 B 列為已放棄的 word 顆粒度，只做離線比較）

export interface WordColumns {
    w: string[];
    s: number[];
    e: number[];
}

export interface WordSentence {
    text: string;
    startTime: number;
    endTime: number;
    lowConfidence?: boolean;
}

const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'jr', 'sr', 'prof', 'vs', 'etc', 'no']);
/** 和正式切句相同：起點往前 0.1 秒 */
const START_BUFFER_SEC = 0.1;
/** 字長上限：max(MIN_CAP, CAP_FACTOR × 中位數字長)；超過視為把停頓算進去了 */
const MIN_CAP_SEC = 0.6;
const CAP_FACTOR = 2.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

function isSentenceEnd(word: string): boolean {
    const t = word.trim();
    if (!/[.!?]["”')\]]*$/.test(t)) return false;
    const bare = t.replace(/[.!?]["”')\]]*$/, '').replace(/^["“'(\[]+/, '').toLowerCase();
    if (ABBREVIATIONS.has(bare)) return false;
    if (/^[a-z]$/i.test(bare)) return false;            // 單一字母縮寫（U.S. 的片段）
    if (/^\d+$/.test(bare) && t.endsWith('.')) return false; // 數字後的句點多半是小數或編號，保守不切
    return true;
}

function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 依字的時間切句：句末標點的字結束一句。
 * 起點＝第一個字起點 − 0.1；終點＝最後一個字終點，但字長異常（涵蓋停頓）時以「字的起點＋上限」截斷並標低可信度。
 * 不用下一個字的起點修正句尾（停頓之後才開始，會放大誤差，Codex）。
 */
export function buildSentencesFromWords(words: WordColumns): WordSentence[] {
    const n = Math.min(words.w.length, words.s.length, words.e.length);
    const durations: number[] = [];
    for (let i = 0; i < n; i++) {
        const d = words.e[i] - words.s[i];
        if (Number.isFinite(d) && d > 0) durations.push(d);
    }
    const cap = Math.max(MIN_CAP_SEC, CAP_FACTOR * median(durations));

    const out: WordSentence[] = [];
    let parts: string[] = [];
    let start = 0;
    let lastEnd = 0;
    let low = false;
    let prevEnd = -Infinity;

    const flush = () => {
        if (parts.length === 0) return;
        const s = Math.max(0, start - START_BUFFER_SEC);
        let e = lastEnd;
        if (!(e > s)) { e = s + 0.1; low = true; }
        out.push({ text: parts.join(' '), startTime: round2(s), endTime: round2(e), ...(low ? { lowConfidence: true } : {}) });
        parts = [];
        low = false;
    };

    for (let i = 0; i < n; i++) {
        const text = String(words.w[i] ?? '').trim();
        const ws = Number(words.s[i]);
        const we = Number(words.e[i]);
        if (!text || !Number.isFinite(ws) || !Number.isFinite(we)) continue;
        if (parts.length === 0) start = ws;
        if (we <= ws || ws < prevEnd - 0.05) low = true;      // 零長度或時間倒退
        prevEnd = Math.max(prevEnd, we);
        let end = we;
        if (we - ws > cap) { end = ws + cap; low = true; }    // 拉長的字：截斷
        lastEnd = Math.max(parts.length === 0 ? end : lastEnd, end);
        parts.push(text);
        if (isSentenceEnd(text)) flush();
    }
    flush();
    return out;
}
