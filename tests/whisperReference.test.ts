import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeReference, chooseReferencedTranscript, runReferencedTranscribe, runTranscribeChain,
  REFERENCE_MAX_CHARS, PADDED_WORD_RATIO,
} from '../netlify/shared/transcribe';
import {
  canAccumulatePattern, calculateFinalScores, compareWords, PATTERN_PASS_MAX_ERRORS, PATTERN_STRICT_MAX_WORDS,
} from '../src/utils/scoring';
import { canAccumulateWithHint } from '../src/utils/practiceCue';

// 規劃：docs/plans/whisper-reference.md
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('normalizeReference（驗收 1）', () => {
  it('非字串、空白 → 不帶；前後空白去掉', () => {
    expect(normalizeReference(undefined)).toBe('');
    expect(normalizeReference(123)).toBe('');
    expect(normalizeReference('   ')).toBe('');
    expect(normalizeReference('  I used to walk.  ')).toBe('I used to walk.');
  });
  it('超長保留尾端', () => {
    const long = 'a'.repeat(REFERENCE_MAX_CHARS) + ' Tasmania and Victoria';
    const r = normalizeReference(long);
    expect(r.length).toBeLessThanOrEqual(REFERENCE_MAX_CHARS);
    expect(r.endsWith('Tasmania and Victoria')).toBe(true);
  });
});

describe('chooseReferencedTranscript（驗收 2）', () => {
  const ok = (text: string) => ({ ok: true as const, text, model: 'whisper-large-v3' });
  const fail = { ok: false as const, status: 502, error: 'down' };
  it('門檻 60%', () => {
    expect(PADDED_WORD_RATIO).toBe(0.6);
  });
  it('字數相近 → 用帶原句的結果', () => {
    const r = chooseReferencedTranscript(
      ok('Elsewhere the Australian and New Zealand council has warned below-average rainfall increased bushfire potential across Tasmania'),
      ok('Australia\'s and New Zealand\'s council has warned the average rainfall increased supply potential across Australia'),
    );
    expect(r).toMatchObject({ ok: true, referenced: true, check: 'ok' });
    expect((r as any).text).toContain('bushfire');
  });
  it('不帶原句的字數 < 60% → 判定補字，用不帶原句的結果', () => {
    const r = chooseReferencedTranscript(ok('All that she wrote will be published.'), ok('All that she'));
    expect(r).toMatchObject({ ok: true, text: 'All that she', referenced: false, check: 'padded' });
  });
  it('不帶原句是空字串（沒有人聲）→ 空字串', () => {
    const r = chooseReferencedTranscript(ok('All that she wrote will be published.'), ok(''));
    expect(r).toMatchObject({ ok: true, text: '', check: 'padded' });
  });
  it('兩次都是空字串 → 空字串', () => {
    expect(chooseReferencedTranscript(ok(''), ok(''))).toMatchObject({ ok: true, text: '' });
  });
  it('只有帶原句的成功 → 用它，標記 unchecked', () => {
    expect(chooseReferencedTranscript(ok('All that she wrote.'), fail)).toMatchObject({ ok: true, text: 'All that she wrote.', referenced: true, check: 'unchecked' });
  });
  it('只有不帶原句的成功 → 用它', () => {
    expect(chooseReferencedTranscript(fail, ok('All that she wrote.'))).toMatchObject({ ok: true, text: 'All that she wrote.', referenced: false });
  });
  it('都失敗 → 失敗（前端改用 Gemini）', () => {
    expect(chooseReferencedTranscript(fail, fail)).toMatchObject({ ok: false });
  });
});

describe('runReferencedTranscribe（驗收 3）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const GROQ = { name: 'Groq', url: 'https://groq.test/t', model: 'whisper-large-v3', key: 'g' };
  const audio = new Uint8Array(5000);
  it('同時送兩次：一次帶 prompt、一次不帶', async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const f = init?.body as FormData;
      const text = f.has('prompt') ? 'All that she wrote will be published.' : 'All that she wrote will be published.';
      return new Response(JSON.stringify({ text }), { status: 200 });
    });
    const r = await runReferencedTranscribe({ audio, mimeType: 'audio/webm', providers: [GROQ], fetchImpl, now: () => Date.now(), reference: 'All that she wrote will be published.' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const prompts = fetchImpl.mock.calls.map(c => (c[1]?.body as FormData).get('prompt'));
    expect(prompts).toContain('All that she wrote will be published.');
    expect(prompts).toContain(null);
    expect(r).toMatchObject({ ok: true, referenced: true, check: 'ok' });
  });
  it('沒有原句時的轉錄鏈照舊不帶 prompt', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'hi there' }), { status: 200 }));
    await runTranscribeChain({ audio, mimeType: 'audio/webm', providers: [GROQ], fetchImpl, now: () => Date.now() });
    expect((fetchImpl.mock.calls[0][1]?.body as FormData).has('prompt')).toBe(false);
  });
});

describe('前端接線（驗收 4）', () => {
  it('transcribe-recording 收 reference，有值時跑兩次', () => {
    const fn = read('netlify/functions/transcribe-recording.ts');
    expect(fn).toMatch(/normalizeReference\(/);
    expect(fn).toMatch(/runReferencedTranscribe\(/);
  });
  it('gemini.ts：傳 reference、有開關、Gemini 備援不帶原句', () => {
    const g = read('src/services/gemini.ts');
    expect(g).toMatch(/transcribeRecordingDetailed\(audioFile: File, opts\?: \{ reference\?: string \}\)/);
    expect(g).toContain('huanux_no_reference');
    const geminiCall = g.slice(g.indexOf("callAiText<{ text: string; model?: string }>('transcribe'"));
    expect(geminiCall.slice(0, 120)).not.toContain('reference');
  });
  it('影子跟讀與語言模型練習傳原句，複述不傳', () => {
    expect(read('src/components/ShadowingPracticeView.tsx')).toMatch(/transcribeRecordingDetailed\(file, \{ reference: /);
    expect(read('src/components/PatternPracticeSessionView.tsx')).toMatch(/transcribeRecordingDetailed\(file, \{ reference: /);
    expect(read('src/components/RetellView.tsx')).not.toMatch(/reference:/);
  });
});

describe('錯 1 個字以內算通過（驗收 5）', () => {
  it('常數', () => {
    expect(PATTERN_PASS_MAX_ERRORS).toBe(1);
    expect(PATTERN_STRICT_MAX_WORDS).toBe(3);
  });
  it('4 字以上：錯 0、1 個字通過；2 個字不過', () => {
    expect(canAccumulatePattern({ errors: 0, targetCount: 7 })).toBe(true);
    expect(canAccumulatePattern({ errors: 1, targetCount: 7 })).toBe(true);
    expect(canAccumulatePattern({ errors: 1, targetCount: 4 })).toBe(true);
    expect(canAccumulatePattern({ errors: 2, targetCount: 7 })).toBe(false);
  });
  it('3 個字以內要全對', () => {
    expect(canAccumulatePattern({ errors: 1, targetCount: 3 })).toBe(false);
    expect(canAccumulatePattern({ errors: 0, targetCount: 3 })).toBe(true);
  });
  it('沒說話不可通過（含 1 字句）', () => {
    expect(canAccumulatePattern(calculateFinalScores('', 'Absolutely.', 2))).toBe(false);
    expect(canAccumulatePattern(calculateFinalScores('', 'All that she wrote will be published.', 2))).toBe(false);
    expect(canAccumulatePattern(calculateFinalScores('um uh', 'All that she wrote will be published.', 2))).toBe(false);
  });
  it('實際句子：漏 1 個字通過、漏 2 個字不過', () => {
    expect(canAccumulatePattern(compareWords('All that she wrote will published', 'All that she wrote will be published.'))).toBe(true);
    expect(canAccumulatePattern(compareWords('All that she wrote published', 'All that she wrote will be published.'))).toBe(false);
  });
  it('縮寫展開後的字數為準', () => {
    // I'm＝i am（3 字以上才放寬）
    expect(canAccumulatePattern(compareWords("I'm", "I'm here."))).toBe(false);
  });
  it('看過單字提示仍不加；沒有 targetCount 時要全對（相容舊呼叫）', () => {
    expect(canAccumulateWithHint({ errors: 1, targetCount: 7 }, true)).toBe(false);
    expect(canAccumulateWithHint({ errors: 1, targetCount: 7 }, false)).toBe(true);
    expect(canAccumulatePattern({ errors: 1 })).toBe(false);
  });
});

describe('畫面文案（驗收 6）', () => {
  const v = read('src/components/PatternPracticeSessionView.tsx');
  it('提示與結果文案', () => {
    for (const w of ['說出你造的那句話，錯 1 個字以內算通過', '這句較短，要一字不差', '差 1 個字，算通過', '總分・一字不差']) expect(v).toContain(w);
  });
  it('影子跟讀與練習的辨識標籤顯示「參考原句」', () => {
    expect(read('src/utils/transcriber.ts')).toContain('（參考原句）');
  });
});

describe('規則文件（驗收 7）', () => {
  it('CLAUDE.md 與 AGENTS.md 都更新為新規則', () => {
    for (const f of ['CLAUDE.md', 'AGENTS.md']) {
      const s = read(f);
      expect(s).not.toContain('不放寬相似度');
      expect(s).not.toContain('不可放寬相似度');
      expect(s).toContain('錯 1 個字以內算通過');
    }
  });
});
