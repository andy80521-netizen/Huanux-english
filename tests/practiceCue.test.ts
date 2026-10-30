import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CUE_VERSION, needsNewCue, cueDisplay, buildWordBank, createVerifiedCue, applyCueToSentence, canAccumulateWithHint,
} from '../src/utils/practiceCue';
import { buildPracticeCuePrompt, buildPracticeCueCheckPrompt } from '../netlify/shared/prompts';
import { sanitizePracticeCue, sanitizeCueCheckAnswer, validCuePayload, validCueCheckPayload } from '../netlify/shared/practiceCue';
import { compareWords } from '../src/utils/scoring';
import type { PatternExampleSentence } from '../src/types';

// 規劃：docs/plans/practice-prompt-design.md（驗收條件 1～9）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const OWNER = 'All that she wrote will be published.';

describe('出題提示詞（驗收 1）', () => {
  const p = buildPracticeCuePrompt(OWNER, 'all that ...');
  it('要求繁體中文、涵蓋所有資訊、不可換主詞', () => {
    expect(p).toContain(OWNER);
    expect(p).toContain('繁體中文');
    for (const w of ['主詞', '時態', '否定', '數量']) expect(p).toContain(w);
    expect(p).toMatch(/不可(更換|換掉|改變)主詞/);
  });
  it('附上擁有者案例當反例（把「她寫的」換成「一本書」）', () => {
    expect(p).toContain('一本書');
  });
  it('只要求 situationZh、meaningZh 兩個欄位', () => {
    expect(p).toContain('"situationZh"');
    expect(p).toContain('"meaningZh"');
    expect(p).not.toContain('qaQuestion');
  });
  it('品質檢查提示詞不含原句', () => {
    const c = buildPracticeCueCheckPrompt({ situationZh: '朋友問起作家的手稿', meaningZh: '她寫的所有東西都將會出版', patternText: 'all that ...' });
    expect(c).toContain('她寫的所有東西都將會出版');
    expect(c).toContain('all that ...');
    expect(c).not.toContain('published');
  });
});

describe('後端輸入檢查與輸出整理（驗收 2）', () => {
  it('practiceCue 輸入', () => {
    expect(validCuePayload({ sentenceText: OWNER, patternText: 'all that' })).toBe(true);
    expect(validCuePayload({ sentenceText: '', patternText: 'all that' })).toBe(false);
    expect(validCuePayload({ sentenceText: OWNER })).toBe(false);
    expect(validCuePayload({ sentenceText: 'x'.repeat(501), patternText: 'a' })).toBe(false);
    expect(validCuePayload(null)).toBe(false);
  });
  it('practiceCueCheck 輸入', () => {
    expect(validCueCheckPayload({ situationZh: '情境', meaningZh: '意思', patternText: 'all that' })).toBe(true);
    expect(validCueCheckPayload({ situationZh: '情境', meaningZh: '', patternText: 'all that' })).toBe(false);
    expect(validCueCheckPayload({ situationZh: 1, meaningZh: '意思', patternText: 'all that' })).toBe(false);
  });
  it('practiceCue 輸出：修剪、截斷 500 字；缺欄位回傳 null', () => {
    expect(sanitizePracticeCue({ situationZh: ' 情境 ', meaningZh: ' 意思 ' })).toEqual({ situationZh: '情境', meaningZh: '意思' });
    expect(sanitizePracticeCue({ situationZh: 'a'.repeat(900), meaningZh: '意思' })?.situationZh.length).toBe(500);
    expect(sanitizePracticeCue({ situationZh: '情境' })).toBeNull();
    expect(sanitizePracticeCue({ situationZh: '情境', meaningZh: '  ' })).toBeNull();
    expect(sanitizePracticeCue(null)).toBeNull();
  });
  it('品質檢查輸出：取第一行英文、去掉引號', () => {
    expect(sanitizeCueCheckAnswer('"All that she wrote will be published."\n說明…')).toBe('All that she wrote will be published.');
    expect(sanitizeCueCheckAnswer('')).toBe('');
  });
});

describe('產生流程與品質檢查（驗收 3）', () => {
  const cue = { situationZh: '朋友問起作家的手稿', meaningZh: '她寫的所有東西都將會出版' };
  const run = (answers: Array<string | Error>, gens: Array<typeof cue | Error> = [cue, cue]) => {
    let g = 0; let c = 0;
    const calls = { generate: 0, check: 0 };
    const p = createVerifiedCue({
      sentenceText: OWNER,
      generate: async () => { calls.generate++; const v = gens[g++]; if (v instanceof Error) throw v; return v; },
      check: async () => { calls.check++; const v = answers[c++]; if (v instanceof Error) throw v; return v; },
    });
    return { p, calls };
  };

  it('檢查一次就通過 → verified', async () => {
    const { p, calls } = run([OWNER]);
    expect(await p).toEqual({ ...cue, cueVerified: true });
    expect(calls).toEqual({ generate: 1, check: 1 });
  });
  it('第一次不通過、第二次通過 → verified', async () => {
    const { p, calls } = run(['Everything she wrote will be published.', OWNER]);
    expect((await p).cueVerified).toBe(true);
    expect(calls).toEqual({ generate: 2, check: 2 });
  });
  it('兩次都不通過 → 仍回傳題目、unverified（最多 2 輪）', async () => {
    const { p, calls } = run(['Everything she wrote will be published.', 'All she wrote is going to be published.']);
    const r = await p;
    expect(r.cueVerified).toBe(false);
    expect(r.meaningZh).toBe(cue.meaningZh);
    expect(calls).toEqual({ generate: 2, check: 2 });
  });
  it('檢查呼叫失敗 → 存題目、unverified，不再重試', async () => {
    const { p, calls } = run([new Error('503')]);
    expect(await p).toEqual({ ...cue, cueVerified: false });
    expect(calls).toEqual({ generate: 1, check: 1 });
  });
  it('第一次產生失敗 → 拋錯', async () => {
    const { p } = run([], [new Error('down')]);
    await expect(p).rejects.toThrow('down');
  });
  it('第二輪產生失敗 → 用第一輪題目、unverified', async () => {
    const { p } = run(['Everything she wrote will be published.'], [cue, new Error('down')]);
    expect(await p).toEqual({ ...cue, cueVerified: false });
  });
  it('比對標準與評分一致（一字不差，忽略大小寫與標點）', async () => {
    const { p } = run(['all that she wrote will be published']);
    expect((await p).cueVerified).toBe(true);
    expect(compareWords('all that she wrote will be published', OWNER).errors).toBe(0);
  });
});

describe('依熟練度顯示（驗收 4）', () => {
  it.each([
    [0, { situation: true, pattern: true }],
    [399, { situation: true, pattern: true }],
    [400, { situation: false, pattern: true }],
    [699, { situation: false, pattern: true }],
    [700, { situation: false, pattern: false }],
    [1000, { situation: false, pattern: false }],
  ])('熟練度 %i', (m, expected) => {
    expect(cueDisplay(m)).toEqual({ meaning: true, ...expected });
  });
});

describe('舊題目要換新（驗收 5）', () => {
  it('沒有 cueVersion 或版本較舊 → 需要重新產生', () => {
    expect(needsNewCue({ qaQuestion: '舊問題', situationalPrompt: '舊情境' } as Partial<PatternExampleSentence>)).toBe(true);
    expect(needsNewCue({ cueVersion: 1, meaningZh: '意思' } as Partial<PatternExampleSentence>)).toBe(true);
    expect(needsNewCue({ cueVersion: CUE_VERSION, meaningZh: '' } as Partial<PatternExampleSentence>)).toBe(true);
    expect(needsNewCue({ cueVersion: CUE_VERSION, meaningZh: '意思', situationZh: '情境' } as Partial<PatternExampleSentence>)).toBe(false);
  });
});

describe('單字提示（驗收 6）', () => {
  it('包含原句每個單字（去掉標點），順序和原句不同', () => {
    const bank = buildWordBank(OWNER);
    expect([...bank].sort()).toEqual(['All', 'be', 'published', 'she', 'that', 'will', 'wrote'].sort());
    expect(bank.join(' ')).not.toBe('All that she wrote will be published');
  });
  it('保留縮寫的撇號、去掉引號與逗號', () => {
    const bank = buildWordBank('“Well,” I don’t know.');
    expect([...bank].sort()).toEqual(['I', 'Well', 'don’t', 'know'].sort());
  });
  it('同一句每次結果相同；空句子回傳空陣列', () => {
    expect(buildWordBank(OWNER)).toEqual(buildWordBank(OWNER));
    expect(buildWordBank('')).toEqual([]);
    expect(buildWordBank('Hi.')).toEqual(['Hi']);
  });
});

describe('看過單字提示不加熟練度（驗收 7）', () => {
  it('一字不差但看過提示 → 不累加', () => {
    expect(canAccumulateWithHint({ errors: 0 }, false)).toBe(true);
    expect(canAccumulateWithHint({ errors: 0 }, true)).toBe(false);
    expect(canAccumulateWithHint({ errors: 1 }, false)).toBe(false);
  });
  it('練習畫面用這個判斷，維持複習回報的 isExact 也一樣', () => {
    const view = read('src/components/PatternPracticeSessionView.tsx');
    expect(view).toMatch(/canAccumulateWithHint\(scores, usedWordHintRef\.current\)/);
    expect(view).not.toMatch(/canAccumulatePattern\(scores\)/);
    expect(view).toContain('看單字提示');
    expect(view).toContain('看過單字提示，這次熟練度不增加');
  });
});

describe('寫入新題目（驗收 8）', () => {
  it('保留其他欄位、移除舊題目欄位', () => {
    const old: PatternExampleSentence = {
      id: 's1', text: OWNER, checked: true, groupIndex: 0, mastery: 640, attemptCount: 5,
      nextAvailableAt: 123, imageUrl: 'https://x/y.jpg', checkFeedback: { natural: true, grammar: true, spelling: true, comment: '' },
      qaQuestion: '如果一本書…', situationalPrompt: '舊情境',
    };
    const next = applyCueToSentence(old, { situationZh: '情境', meaningZh: '意思', cueVerified: true });
    expect(next).toEqual({
      id: 's1', text: OWNER, checked: true, groupIndex: 0, mastery: 640, attemptCount: 5,
      nextAvailableAt: 123, imageUrl: 'https://x/y.jpg', checkFeedback: { natural: true, grammar: true, spelling: true, comment: '' },
      situationZh: '情境', meaningZh: '意思', cueVerified: true, cueVersion: CUE_VERSION,
    });
    expect('qaQuestion' in next).toBe(false);
    expect('situationalPrompt' in next).toBe(false);
  });
});

describe('畫面不再使用舊題目欄位（驗收 9）', () => {
  for (const f of ['src/components/PatternPracticeSessionView.tsx', 'src/components/GroupDetailView.tsx', 'src/components/TodayReviewView.tsx', 'src/components/LanguageModelPracticeView.tsx', 'src/services/practicePrompts.ts']) {
    it(f, () => {
      const src = read(f);
      expect(src).not.toMatch(/qaQuestion|situationalPrompt/);
    });
  }
  it('後端不再有舊的出題工作', () => {
    expect(read('netlify/functions/ai-text.ts')).not.toContain("'practicePrompts'");
    expect(read('netlify/shared/prompts.ts')).not.toContain('buildPracticePromptsPrompt');
  });
  it('型別有新欄位', () => {
    const t = read('src/types.ts');
    for (const f of ['cueVersion?: number', 'situationZh?: string', 'meaningZh?: string', 'cueVerified?: boolean']) expect(t).toContain(f);
  });
});
