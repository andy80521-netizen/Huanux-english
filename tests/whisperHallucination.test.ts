import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  chooseReferencedTranscript, runReferencedTranscribe, referenceOverlap, SUSPECT_OVERLAP_RATIO,
} from '../netlify/shared/transcribe';

// Bug（擁有者 2026-11-07 回報影片）：使用者念完整句約 21 秒，帶原句的 Whisper 卻吐出無關的幻覺文字，
// 舊防呆只檢查「帶原句那次多補字」，沒檢查「帶原句那次少很多字／亂寫」→ 內容 2 分

const REF = "Investigators believe the incident followed an argument O'Rian's father and brother aged 77 and 47 were airlifted to hospital with life-threatening injuries and remain in intensive care His mother aged 74 was transported to hospital with critical injuries but is in a stable condition";
const HALLUCINATION = 'In the following video, we will discuss the case of the family of the deceased.';
const SPOKEN = "Investigators believe the incident followed an argument O'Brien's father and brother aged 77 and 47 were airlifted to hospital with life threatening injuries and remain in intensive care his mother aged 74 was transported to hospital with critical injuries but is in a stable condition";
const ok = (text: string) => ({ ok: true as const, text, model: 'whisper-large-v3' });
const fail = { ok: false as const, status: 502, error: 'down' };

describe('referenceOverlap', () => {
  it('每個原句字只算一次、不分大小寫與標點', () => {
    expect(referenceOverlap('The the THE cat.', 'the cat sat')).toBeCloseTo(2 / 4);
  });
  it('幻覺句與原句幾乎不重疊（< 門檻）；念對的句子幾乎全重疊', () => {
    expect(referenceOverlap(HALLUCINATION, REF)).toBeLessThan(SUSPECT_OVERLAP_RATIO);
    expect(referenceOverlap(SPOKEN, REF)).toBeGreaterThan(0.9);
  });
  it('空字串 → 0', () => {
    expect(referenceOverlap('', REF)).toBe(0);
  });
});

describe('帶原句那次少很多字／亂寫 → 不採用（驗收 1：影片的情況）', () => {
  it('不帶原句念出整句、帶原句是幻覺 → 用不帶原句的結果', () => {
    const r = chooseReferencedTranscript(ok(HALLUCINATION), ok(SPOKEN), REF);
    expect(r).toMatchObject({ ok: true, referenced: false });
    expect((r as any).text).toBe(SPOKEN);
  });
  it('只看字數也要擋：帶原句字數 < 不帶原句的 60% → 用不帶原句（沒傳原句時也成立）', () => {
    const r = chooseReferencedTranscript(ok('All that she'), ok('All that she wrote will be published.'));
    expect(r).toMatchObject({ ok: true, text: 'All that she wrote will be published.', referenced: false, check: 'short' });
  });
  it('字數相近但帶原句那次與原句的重疊比不帶原句還少 → 用不帶原句', () => {
    const plain = 'Investigators believe the incident followed an argument';
    const r = chooseReferencedTranscript(ok('In the following video we will discuss the case'), ok(plain), REF);
    expect(r).toMatchObject({ ok: true, text: plain, referenced: false, check: 'worse' });
  });
});

describe('只有帶原句那次成功、而且像幻覺 → 失敗讓前端改用 Gemini（驗收 2）', () => {
  it('重疊 < 門檻 → ok:false', () => {
    expect(chooseReferencedTranscript(ok(HALLUCINATION), fail, REF)).toMatchObject({ ok: false });
  });
  it('重疊正常 → 照用（unchecked）', () => {
    expect(chooseReferencedTranscript(ok(SPOKEN), fail, REF)).toMatchObject({ ok: true, text: SPOKEN, check: 'unchecked' });
  });
  it('很短的回答（2 個字以下）不判定幻覺', () => {
    expect(chooseReferencedTranscript(ok('Yes indeed'), fail, REF)).toMatchObject({ ok: true, text: 'Yes indeed' });
  });
});

describe('既有行為不變（驗收 3）', () => {
  it('正常情況仍用帶原句的結果', () => {
    const r = chooseReferencedTranscript(ok(REF), ok(SPOKEN), REF);
    expect(r).toMatchObject({ ok: true, text: REF, referenced: true, check: 'ok' });
  });
  it('補字防呆仍有效', () => {
    expect(chooseReferencedTranscript(ok('All that she wrote will be published.'), ok('All that she'), 'All that she wrote will be published.'))
      .toMatchObject({ ok: true, text: 'All that she', check: 'padded' });
  });
  it('兩次都沒人聲 → 空字串', () => {
    expect(chooseReferencedTranscript(ok(''), ok(''), REF)).toMatchObject({ ok: true, text: '' });
  });
});

describe('runReferencedTranscribe 把原句交給判斷（驗收 4）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('帶 prompt 那次回傳幻覺 → 最後用不帶 prompt 的結果', async () => {
    const GROQ = { name: 'Groq', url: 'https://groq.test/t', model: 'whisper-large-v3', key: 'g' };
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const f = init?.body as FormData;
      return new Response(JSON.stringify({ text: f.has('prompt') ? HALLUCINATION : SPOKEN }), { status: 200 });
    });
    const r = await runReferencedTranscribe({ audio: new Uint8Array(5000), mimeType: 'audio/mp4', providers: [GROQ], fetchImpl, now: () => Date.now(), reference: REF });
    expect(r).toMatchObject({ ok: true, text: SPOKEN, referenced: false });
  });
});
