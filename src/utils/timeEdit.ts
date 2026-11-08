// 時間軸修正的共用邏輯（校對畫面與教材詳情頁共用）
// 規劃：docs/plans/import-timestamp-accuracy.md（PR-G）

import type { MaterialSentence } from '../types';

/** 微調按鈕一次加減的秒數（擁有者 2026-11-08 決定，取代 0.5） */
export const TIME_STEP = 0.2;
/** 聽句尾：從句尾前幾秒播到句尾後幾秒 */
export const TAIL_BEFORE_SEC = 1.5;
export const TAIL_AFTER_SEC = 0.5;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const isValidRange = (start: number, end: number) =>
    Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end;

export type AdjustResult =
    | { ok: true; startTime: number; endTime: number }
    | { ok: false; warning: string };

/** 微調開始或結束時間；調整後仍不合理、且沒有比原本改善時擋下（原本合理、調整後變不合理也屬於這種情況） */
export function adjustTime(range: { startTime: number; endTime: number }, field: 'startTime' | 'endTime', delta: number): AdjustResult {
    const newVal = round2(Math.max(0, range[field] + delta));
    const startTime = field === 'startTime' ? newVal : range.startTime;
    const endTime = field === 'endTime' ? newVal : range.endTime;
    if (startTime >= endTime && startTime - endTime >= range.startTime - range.endTime) {
        return { ok: false, warning: '此調整會使開始時間大於或等於結束時間，已取消' };
    }
    return { ok: true, startTime, endTime };
}

/** 聽句尾的播放範圍 */
export function tailRange(endTime: number): { start: number; end: number } {
    return { start: round2(Math.max(0, endTime - TAIL_BEFORE_SEC)), end: round2(endTime + TAIL_AFTER_SEC) };
}

export interface EditableSentence {
    text: string;
    translation?: string;
    startTime: number;
    endTime: number;
    lowConfidence?: boolean;
}

/** 把 cur 合併到上一句 prev：文字以空白接、翻譯直接接、時間取聯集、低信心取或 */
export function mergeWithPrevious<T extends EditableSentence>(prev: T, cur: T): T {
    const translation = [prev.translation, cur.translation].filter(t => t && t.trim()).join('');
    return {
        ...prev,
        text: `${prev.text.trim()} ${cur.text.trim()}`.trim(),
        translation,
        startTime: Math.min(prev.startTime, cur.startTime),
        endTime: Math.max(prev.endTime, cur.endTime),
        lowConfidence: !!(prev.lowConfidence || cur.lowConfidence),
    };
}

/**
 * 以游標位置把一句拆成兩句。時間無法從文字推得，先放在中點、兩句都標低信心，由使用者聽過後調整
 * （委員會：不用字元比例假裝準）；有翻譯時兩句的翻譯都清空。游標在開頭、結尾或任一邊沒有文字 → null
 */
export function splitSentenceAt<T extends EditableSentence>(s: T, caret: number): [T, T] | null {
    const before = s.text.slice(0, caret).trim();
    const after = s.text.slice(caret).trim();
    if (!before || !after) return null;
    const mid = round2((s.startTime + s.endTime) / 2);
    // 原本的翻譯是整句的，不可複製給拆開的兩句（Codex）；清空後由使用者補上
    const tr = s.translation === undefined ? {} : { translation: '' };
    return [
        { ...s, ...tr, text: before, endTime: mid, lowConfidence: true },
        { ...s, ...tr, text: after, startTime: mid, lowConfidence: true },
    ];
}

/**
 * 已存教材：只修改指定那一句的時間。第一次修改時另存原始時間（之後的修改保留第一次的值），
 * 改回原始時間時移除原始時間欄位。時間不合理或找不到句子 → null（不寫入）
 */
export function applySentenceTime(sentences: MaterialSentence[], id: string, startTime: number, endTime: number): MaterialSentence[] | null {
    const start = round2(startTime);
    const end = round2(endTime);
    if (!isValidRange(start, end)) return null;
    const idx = sentences.findIndex(s => s.id === id);
    if (idx < 0) return null;
    const cur = sentences[idx];
    const origStart = cur.originalStartTime ?? cur.startTime;
    const origEnd = cur.originalEndTime ?? cur.endTime;
    const { originalStartTime: _os, originalEndTime: _oe, ...rest } = cur;
    const next: MaterialSentence = start === origStart && end === origEnd
        ? { ...rest, startTime: start, endTime: end }
        : { ...rest, startTime: start, endTime: end, originalStartTime: origStart, originalEndTime: origEnd };
    return sentences.map((s, i) => (i === idx ? next : s));
}

/** 已存教材：還原那一句的原始時間並移除原始時間欄位；沒有修改過 → null */
export function restoreSentenceTime(sentences: MaterialSentence[], id: string): MaterialSentence[] | null {
    const idx = sentences.findIndex(s => s.id === id);
    if (idx < 0) return null;
    const cur = sentences[idx];
    if (typeof cur.originalStartTime !== 'number' || typeof cur.originalEndTime !== 'number') return null;
    const { originalStartTime, originalEndTime, ...rest } = cur;
    const next: MaterialSentence = { ...rest, startTime: originalStartTime, endTime: originalEndTime };
    return sentences.map((s, i) => (i === idx ? next : s));
}
