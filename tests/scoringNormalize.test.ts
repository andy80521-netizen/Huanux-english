import { describe, it, expect } from 'vitest';
import { compareWords, canAccumulatePattern } from '../src/utils/scoring';
import { computeMaintenanceOutcome, FAILED_MASTERY } from '../src/utils/maintenanceLogic';
import { addSydneyCalendarDays } from '../src/utils/sydneyTime';
import type { LanguagePattern } from '../src/types';

// 規劃：docs/plans/scoring-normalize-fix.md（驗收條件 1～7）
const errs = (user: string, target: string) => compareWords(user, target).errors;

describe('縮寫：不同展開念法互相算對（驗收 1、2、3b）', () => {
  it("'d 念 had 或 would 都算對", () => {
    expect(errs('I had already left', "I'd already left")).toBe(0);
    expect(errs('I would like tea', "I'd like tea")).toBe(0);
    expect(errs("I'd like tea", 'I would like tea')).toBe(0);
    expect(errs('I’d like tea', 'I would like tea')).toBe(0);
  });

  it("代名詞後的 's 念 is 或 has 都算對", () => {
    expect(errs('He has been here', "He's been here")).toBe(0);
    expect(errs('He is here', "He's here")).toBe(0);
    expect(errs('It has gone', "It's gone")).toBe(0);
  });

  it("'m 與 am 互相算對", () => {
    expect(errs('I am here', "I'm here")).toBe(0);
    expect(errs("I'm here", 'I am here')).toBe(0);
  });

  it("疑問詞後的 'd 也接受 did，其他位置不接受", () => {
    expect(errs('How did you do that', "How'd you do that")).toBe(0);
    expect(errs('I did like tea', "I'd like tea")).toBeGreaterThanOrEqual(1);
  });

  it('所有格不展開，必須照念', () => {
    expect(errs('This is John is book', "This is John's book")).toBeGreaterThanOrEqual(1);
    expect(errs("This is John's book", "This is John's book")).toBe(0);
  });
});

describe('數字：負號、小數點要念出來（驗收 1、3）', () => {
  it('漏念負號或小數點算錯', () => {
    expect(errs('The value is five', 'The value is -5')).toBeGreaterThanOrEqual(1);
    expect(errs('It costs three fourteen dollars', 'It costs 3.14 dollars')).toBeGreaterThanOrEqual(1);
  });

  it('負號念 minus 或 negative 都算對（含 Unicode 負號）', () => {
    expect(errs('The value is minus five', 'The value is -5')).toBe(0);
    expect(errs('The value is negative five', 'The value is −5')).toBe(0);
    expect(errs('The value is -5', 'The value is -5')).toBe(0);
  });

  it('小數念 point 加逐位數字', () => {
    expect(errs('It costs three point one four dollars', 'It costs 3.14 dollars')).toBe(0);
  });

  it('千分位、無逗號、英文念法（含 and）雙向都算對', () => {
    const variants = ['1,250 people', '1250 people', 'one thousand two hundred fifty people', 'one thousand two hundred and fifty people'];
    for (const t of variants) {
      for (const u of variants) {
        expect(errs(u, t), `${u} ／ ${t}`).toBe(0);
      }
    }
  });

  it('大數字正確展開', () => {
    expect(errs('nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine', '999999999')).toBe(0);
    expect(errs('two thousand twenty six', '2026')).toBe(0);
    expect(errs('I have twenty five cats', 'I have 25 cats')).toBe(0);
  });

  it('一般句子漏念 and 仍算錯', () => {
    expect(errs('I like tea milk', 'I like tea and milk')).toBe(1);
  });
});

describe('口頭禪（驗收 4）', () => {
  it('只有使用者有 → 不算錯', () => {
    expect(errs('I um think so', 'I think so')).toBe(0);
    expect(errs('Uh I think so', 'I think so')).toBe(0);
  });

  it('兩邊都有 → 不算錯', () => {
    expect(errs('Um, I think so.', 'Um, I think so.')).toBe(0);
  });

  it('只有原句有 → 算 1 錯', () => {
    expect(errs('I think so', 'Um, I think so.')).toBe(1);
  });
});

describe('其他符號', () => {
  it('& 與 and、% 與 percent', () => {
    expect(errs('you and me', 'you & me')).toBe(0);
    expect(errs('fifty percent', '50%')).toBe(0);
  });
});

describe('逐字比對顯示原句寫法（驗收 5）', () => {
  it('全對時顯示原句的字', () => {
    expect(compareWords('I am twenty five', "I'm 25").diff).toEqual([
      { word: "I'm", type: 'ok' },
      { word: '25', type: 'ok' },
    ]);
  });

  it('念錯時以原字為單位標錯，括號內是使用者念的', () => {
    const diff = compareWords('I am twenty six', "I'm 25").diff;
    expect(diff[0]).toEqual({ word: "I'm", type: 'ok' });
    expect(diff[1]).toEqual({ word: '25', type: 'wrong', said: 'twenty six' });
  });

  it('漏念整個原字', () => {
    const diff = compareWords('I am', "I'm 25").diff;
    expect(diff[1]).toEqual({ word: '25', type: 'missing' });
  });

  it('多念的字單獨顯示，免費的口頭禪不顯示', () => {
    const diff = compareWords('I um really think so', 'I think so').diff;
    expect(diff.map(d => `${d.type}:${d.word}`)).toEqual(['ok:I', 'extra:really', 'ok:think', 'ok:so']);
  });
});

describe('異常長的語音辨識結果', () => {
  it('不會卡住，且判為錯', () => {
    const start = Date.now();
    const r = compareWords('blah '.repeat(20000), 'I think so');
    expect(r.errors).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('句型練習：一字不差才累加（驗收 7）', () => {
  it('canAccumulatePattern', () => {
    expect(canAccumulatePattern({ errors: 0 })).toBe(true);
    expect(canAccumulatePattern({ errors: 1 })).toBe(false);
  });
});

describe('維持複習判斷（驗收 6）', () => {
  const now = Date.UTC(2026, 9, 27, 0, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  const pattern = (dueAt: number | null): LanguagePattern => ({
    id: 'p1',
    ...(dueAt === null ? {} : { maintenance: { level: 1, dueAt } }),
    exampleSentences: [
      { id: 's1', text: 'a', mastery: 1000, checked: true },
      { id: 's2', text: 'b', mastery: 1000, checked: true },
      { id: 's3', text: 'c', mastery: 1000, checked: true, nextAvailableAt: now + DAY },
      { id: 's4', text: 'd', mastery: 1000, checked: true },
    ],
  } as unknown as LanguagePattern);

  it('3 句中 2 句全對 → 通過、level +1；沒全對的句子降為 750 並移除等待時間', () => {
    const r = computeMaintenanceOutcome(pattern(now - DAY), { s1: true, s2: true, s3: false }, now)!;
    expect(r.passed).toBe(true);
    expect(r.passCount).toBe(2);
    expect(r.failedCount).toBe(1);
    expect(r.level).toBe(2);
    expect(r.dueAt).toBe(addSydneyCalendarDays(now, 180));
    const byId = Object.fromEntries(r.exampleSentences.map(s => [s.id, s]));
    expect(byId.s1.mastery).toBe(1000);
    expect(byId.s2.mastery).toBe(1000);
    expect(byId.s3.mastery).toBe(FAILED_MASTERY);
    expect(FAILED_MASTERY).toBe(750);
    expect('nextAvailableAt' in byId.s3).toBe(false);
    expect(byId.s4.mastery).toBe(1000);
    expect(r.maintenance).toEqual({ level: 2, dueAt: r.dueAt, lastReviewedAt: now });
  });

  it('只有 1 句全對 → 不通過、level 歸 0、30 天後再考', () => {
    const r = computeMaintenanceOutcome(pattern(now - DAY), { s1: true, s2: false, s3: false }, now)!;
    expect(r.passed).toBe(false);
    expect(r.level).toBe(0);
    expect(r.dueAt).toBe(addSydneyCalendarDays(now, 30));
    const byId = Object.fromEntries(r.exampleSentences.map(s => [s.id, s]));
    expect(byId.s1.mastery).toBe(1000);
    expect(byId.s2.mastery).toBe(750);
    expect(byId.s3.mastery).toBe(750);
  });

  it('還沒到期或沒有維持排程 → null（不重複套用）', () => {
    expect(computeMaintenanceOutcome(pattern(now + 3 * DAY), { s1: true, s2: true, s3: true }, now)).toBeNull();
    expect(computeMaintenanceOutcome(pattern(null), { s1: true, s2: true, s3: true }, now)).toBeNull();
  });
});
