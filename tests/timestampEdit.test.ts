import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TIME_STEP, adjustTime, tailRange, mergeWithPrevious, splitSentenceAt, applySentenceTime, restoreSentenceTime, isValidRange,
} from '../src/utils/timeEdit';
import type { MaterialSentence } from '../src/types';

// 規劃：docs/plans/import-timestamp-accuracy.md（PR-G）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('微調一次 0.2 秒（驗收 1，擁有者決定）', () => {
  it('步距', () => {
    expect(TIME_STEP).toBe(0.2);
  });
  it('加減後四捨五入到兩位、不小於 0', () => {
    expect(adjustTime({ startTime: 1.1, endTime: 3 }, 'startTime', TIME_STEP)).toEqual({ ok: true, startTime: 1.3, endTime: 3 });
    expect(adjustTime({ startTime: 0.1, endTime: 3 }, 'startTime', -TIME_STEP)).toEqual({ ok: true, startTime: 0, endTime: 3 });
    expect(adjustTime({ startTime: 1, endTime: 2.9 }, 'endTime', TIME_STEP)).toEqual({ ok: true, startTime: 1, endTime: 3.1 });
  });
  it('會讓開始 ≥ 結束 → 擋下並提示；原本就不合理但調整後有改善 → 允許', () => {
    const r = adjustTime({ startTime: 2.9, endTime: 3 }, 'startTime', TIME_STEP);
    expect(r.ok).toBe(false);
    expect(adjustTime({ startTime: 3, endTime: 2 }, 'endTime', TIME_STEP).ok).toBe(true);
  });
  it('isValidRange', () => {
    expect(isValidRange(1, 2)).toBe(true);
    expect(isValidRange(2, 2)).toBe(false);
    expect(isValidRange(-1, 2)).toBe(false);
    expect(isValidRange(NaN, 2)).toBe(false);
  });
});

describe('聽句尾（驗收 2）', () => {
  it('句尾前 1.5 秒播到句尾後 0.5 秒；不小於 0', () => {
    expect(tailRange(10)).toEqual({ start: 8.5, end: 10.5 });
    expect(tailRange(1)).toEqual({ start: 0, end: 1.5 });
  });
});

describe('校對：合併與拆句（驗收 3）', () => {
  const a = { text: 'Hello there.', translation: '你好。', startTime: 1, endTime: 2.5, lowConfidence: false };
  const b = { text: 'How are you?', translation: '你好嗎？', startTime: 2.4, endTime: 4, lowConfidence: true };
  it('合併到上一句：文字以空白接、時間取聯集、低信心取或', () => {
    expect(mergeWithPrevious(a, b)).toEqual({ text: 'Hello there. How are you?', translation: '你好。你好嗎？', startTime: 1, endTime: 4, lowConfidence: true });
  });
  it('沒有翻譯時不產生翻譯欄位內容', () => {
    const m = mergeWithPrevious({ ...a, translation: undefined }, { ...b, translation: undefined });
    expect(m.translation ?? '').toBe('');
  });
  it('拆成兩句：以游標位置拆文字，時間先放中點，兩句都標低信心', () => {
    const s = { text: 'Hello there. How are you?', startTime: 1, endTime: 4, lowConfidence: false };
    const r = splitSentenceAt(s, 12);
    expect(r).not.toBeNull();
    const [x, y] = r!;
    expect(x).toMatchObject({ text: 'Hello there.', startTime: 1, endTime: 2.5, lowConfidence: true });
    expect(y).toMatchObject({ text: 'How are you?', startTime: 2.5, endTime: 4, lowConfidence: true });
  });
  it('游標在開頭、結尾或只剩空白 → 不拆', () => {
    const s = { text: 'Hello there.', startTime: 1, endTime: 4 };
    expect(splitSentenceAt(s, 0)).toBeNull();
    expect(splitSentenceAt(s, s.text.length)).toBeNull();
    expect(splitSentenceAt({ ...s, text: 'Hello   ' }, 5)).toBeNull();
  });
});

const sent = (id: string, startTime: number, endTime: number, extra: Partial<MaterialSentence> = {}): MaterialSentence =>
  ({ id, text: id, startTime, endTime, mastery: 300, ...extra });

describe('已存教材修正時間（驗收 4，擁有者決定）', () => {
  const list = [sent('s1', 0, 2), sent('s2', 2, 4.5, { lastScores: { fluency: 80, total: 75 } }), sent('s3', 4.5, 7)];
  it('只改那一句；第一次修改另存原始時間；熟練度與分數不變', () => {
    const r = applySentenceTime(list, 's2', 2.2, 4.7)!;
    expect(r[0]).toBe(list[0]);
    expect(r[2]).toBe(list[2]);
    expect(r[1]).toMatchObject({ startTime: 2.2, endTime: 4.7, originalStartTime: 2, originalEndTime: 4.5, mastery: 300, lastScores: { fluency: 80, total: 75 } });
  });
  it('第二次修改保留第一次記下的原始時間', () => {
    const once = applySentenceTime(list, 's2', 2.2, 4.7)!;
    const twice = applySentenceTime(once, 's2', 2.4, 4.9)!;
    expect(twice[1]).toMatchObject({ startTime: 2.4, endTime: 4.9, originalStartTime: 2, originalEndTime: 4.5 });
  });
  it('改回原始時間 → 不留原始時間欄位', () => {
    const once = applySentenceTime(list, 's2', 2.2, 4.7)!;
    const back = applySentenceTime(once, 's2', 2, 4.5)!;
    expect(back[1]).not.toHaveProperty('originalStartTime');
    expect(back[1]).not.toHaveProperty('originalEndTime');
  });
  it('時間不合理或找不到句子 → null（不寫入）', () => {
    expect(applySentenceTime(list, 's2', 5, 4)).toBeNull();
    expect(applySentenceTime(list, 'nope', 1, 2)).toBeNull();
  });
  it('還原原始時間：時間回到原值、移除原始時間欄位；沒改過 → null', () => {
    const once = applySentenceTime(list, 's2', 2.2, 4.7)!;
    const restored = restoreSentenceTime(once, 's2')!;
    expect(restored[1]).toMatchObject({ startTime: 2, endTime: 4.5, mastery: 300 });
    expect(restored[1]).not.toHaveProperty('originalStartTime');
    expect(restoreSentenceTime(list, 's2')).toBeNull();
  });
  it('舊資料（沒有原始時間欄位）照常讀取', () => {
    const old = [sent('s1', 0, 2)];
    expect(applySentenceTime(old, 's1', 0.1, 2)![0]).toMatchObject({ originalStartTime: 0, originalEndTime: 2 });
  });
});

describe('接線（驗收 5～7）', () => {
  it('型別：原始時間為選填欄位', () => {
    const t = read('src/types.ts');
    expect(t).toMatch(/originalStartTime\?: number/);
    expect(t).toMatch(/originalEndTime\?: number/);
  });
  it('校對畫面：用 0.2 步距的共用欄位；有聽句尾、合併到上一句、拆成兩句；不再有 ±0.5', () => {
    const p = read('src/components/MaterialReviewPanel.tsx');
    expect(p).toContain('TimeStepperField');
    expect(p).not.toMatch(/[-−+]0\.5/);
    for (const w of ['聽句尾', '合併到上一句', '拆成兩句']) expect(p).toContain(w);
    expect(read('src/components/ui/TimeStepperField.tsx')).toMatch(/TIME_STEP/);
  });
  it('教材詳情頁：每句可調整時間，用同一個欄位元件，有聽句尾、儲存、還原原始時間', () => {
    const d = read('src/components/MaterialDetailView.tsx') + read('src/components/SentenceTimeEditor.tsx');
    expect(d).toContain('調整時間');
    expect(d).toContain('TimeStepperField');
    for (const w of ['聽句尾', '儲存', '還原原始時間']) expect(d).toContain(w);
  });
  it('儲存：交易寫入、只套用那一句，並同步更新重逢紀錄的時間副本', () => {
    const s = read('src/services/materialTimeEdit.ts');
    expect(s).toMatch(/runTransaction\(/);
    expect(s).toMatch(/applySentenceTime\(/);
    expect(s).toMatch(/restoreSentenceTime\(/);
    expect(s).toMatch(/materialSightings/);
    expect(s).toMatch(/sightings`?, `\$\{materialId\}_\$\{sentenceId\}`/);
  });
  it('轉錄：固定英文；沒有句子時寫入錯誤', () => {
    const w = read('netlify/functions/whisper-transcribe.ts');
    expect(w).toMatch(/append\("language", "en"\)/);
    expect(w).toContain('沒有辨識到英文句子');
  });
});
